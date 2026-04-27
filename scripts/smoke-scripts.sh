#!/usr/bin/env bash
# 冒烟：同步脚本三件套（terms / titles / topics）
# 前置：api 在运行，LLM 配置好
set -euo pipefail

API="${VGS_API:-http://localhost:3005}"
KEY="${VGS_API_KEY:-dev-key}"
SUBJECT="${1:-手冲咖啡}"

auth_curl() { curl -s -H "Authorization: Bearer $KEY" "$@"; }

echo "==> /v1/scripts/terms"
auth_curl -X POST "$API/v1/scripts/terms" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"videoSubject":%s,"amount":5}' "$(printf '%s' "$SUBJECT" | jq -Rs .)")" | jq .

echo "==> /v1/scripts/titles"
auth_curl -X POST "$API/v1/scripts/titles" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"videoSubject":%s,"videoLanguage":"zh-CN","amount":5}' "$(printf '%s' "$SUBJECT" | jq -Rs .)")" | jq .

echo "==> /v1/scripts/topics"
auth_curl -X POST "$API/v1/scripts/topics" \
  -H 'Content-Type: application/json' \
  -d "$(printf '{"videoSubject":%s,"amount":8}' "$(printf '%s' "$SUBJECT" | jq -Rs .)")" | jq .
