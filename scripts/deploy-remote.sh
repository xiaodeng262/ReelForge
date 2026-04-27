#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

deploy_path="${1:-}"
release_tgz="${2:-}"
incoming_env_file="${3:-}"

[ -n "$deploy_path" ] || fail "Usage: deploy-remote.sh <deploy-path> <release-tarball> [env-file]"
[ -n "$release_tgz" ] || fail "Missing release tarball path"
[ -f "$release_tgz" ] || fail "Release tarball does not exist: $release_tgz"

require_command bash
require_command docker
require_command tar

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required. Install the docker compose plugin."

release_id="${REELFORGE_RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
project_name="${REELFORGE_COMPOSE_PROJECT:-reelforge}"
compose_profiles="${REELFORGE_COMPOSE_PROFILES:-app}"
healthcheck_url="${REELFORGE_HEALTHCHECK_URL:-http://127.0.0.1:3005/health}"
skip_healthcheck="${REELFORGE_SKIP_HEALTHCHECK:-false}"
releases_retain="${REELFORGE_RELEASES_RETAIN:-5}"
prune_images="${REELFORGE_PRUNE_IMAGES:-false}"

case "$releases_retain" in
  ''|*[!0-9]*) releases_retain=5 ;;
esac

releases_dir="$deploy_path/releases"
shared_dir="$deploy_path/shared"
release_dir="$releases_dir/$release_id"

log "Preparing release $release_id in $deploy_path"
mkdir -p "$releases_dir" "$shared_dir"
rm -rf "$release_dir"
mkdir -p "$release_dir"
tar -xzf "$release_tgz" -C "$release_dir"

if [ -n "$incoming_env_file" ] && [ -f "$incoming_env_file" ]; then
  log "Updating shared production environment file"
  cp "$incoming_env_file" "$shared_dir/.env"
  chmod 600 "$shared_dir/.env"
fi

if [ -f "$shared_dir/.env" ]; then
  cp "$shared_dir/.env" "$release_dir/.env"
elif [ -f "$deploy_path/current/.env" ]; then
  cp "$deploy_path/current/.env" "$release_dir/.env"
else
  fail "No production .env found. Set the DEPLOY_ENV GitHub secret or create $shared_dir/.env on the server."
fi

cd "$release_dir"

log "Building and starting Docker Compose services"
docker compose -p "$project_name" --profile "$compose_profiles" up -d --build --remove-orphans

if [ "$skip_healthcheck" != "true" ]; then
  if command -v curl >/dev/null 2>&1; then
    log "Waiting for API healthcheck: $healthcheck_url"
    ok=0
    for _ in $(seq 1 30); do
      if curl -fsS "$healthcheck_url" >/dev/null; then
        ok=1
        break
      fi
      sleep 2
    done
    [ "$ok" -eq 1 ] || fail "Healthcheck failed: $healthcheck_url"
  else
    log "curl is not installed; skipping HTTP healthcheck"
  fi
else
  log "Healthcheck skipped by REELFORGE_SKIP_HEALTHCHECK=true"
fi

ln -sfn "$release_dir" "$deploy_path/current"

log "Compose status"
docker compose -p "$project_name" --profile "$compose_profiles" ps

if [ "$prune_images" = "true" ]; then
  log "Pruning dangling Docker images"
  docker image prune -f
fi

mapfile -t releases < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d | sort)
if [ "${#releases[@]}" -gt "$releases_retain" ]; then
  remove_count=$((${#releases[@]} - releases_retain))
  log "Removing $remove_count old release(s)"
  for old_release in "${releases[@]:0:$remove_count}"; do
    rm -rf "$old_release"
  done
fi

log "Deployment finished: $release_id"
