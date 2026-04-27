#!/usr/bin/env bash
# 链路 B 冒烟测试：上传素材 → 轮询 → 打印视频 URL
# 用法：./scripts/smoke-assets.sh clip1.mp4 img1.jpg
set -euo pipefail

API="${VGS_API:-http://localhost:3005}"
if [[ $# -lt 1 ]]; then
  echo "usage: $0 file1 [file2 ...]"
  exit 1
fi

ORDER=$(printf '%s\n' "$@" | xargs -I{} basename {} | jq -R . | jq -s .)
META=$(jq -n --argjson order "$ORDER" '{order:$order, transition:"fade"}')

CURL_ARGS=()
for f in "$@"; do
  CURL_ARGS+=(-F "files=@$f")
done
CURL_ARGS+=(-F "meta=$META")

echo "==> Uploading to $API"
RESP=$(curl -s -X POST "$API/v1/jobs/assets" \
  -H "Authorization: Bearer ${VGS_API_KEY:-dev-key}" \
  "${CURL_ARGS[@]}")
echo "$RESP" | jq .
JOB_ID=$(echo "$RESP" | jq -r .jobId)

echo "==> Polling job $JOB_ID"
START=$(date +%s)
while true; do
  sleep 3
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  STATUS=$(curl -s -H "Authorization: Bearer ${VGS_API_KEY:-dev-key}" "$API/v1/jobs/$JOB_ID")
  STATE=$(echo "$STATUS" | jq -r .status)
  PCT=$(echo "$STATUS" | jq -r .progress)
  STEP=$(echo "$STATUS" | jq -r .step)
  printf "[%3ds] status=%-10s progress=%s%% step=%s\n" "$ELAPSED" "$STATE" "$PCT" "$STEP"
  if [[ "$STATE" == "succeeded" ]]; then
    echo "==> SUCCESS in ${ELAPSED}s"
    echo "$STATUS" | jq '.result'
    break
  elif [[ "$STATE" == "failed" ]]; then
    echo "==> FAILED"
    echo "$STATUS" | jq .
    exit 1
  fi
  if [[ $ELAPSED -gt 360 ]]; then
    echo "==> TIMEOUT"
    exit 1
  fi
done
