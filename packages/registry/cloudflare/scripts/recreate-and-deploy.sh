#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm이 필요합니다." >&2
  exit 1
fi

WORKER_NAME="${WORKER_NAME:-goondan-registry}"
COMPAT_DATE="${COMPAT_DATE:-2026-02-12}"
PUBLIC_REGISTRY_URL="${PUBLIC_REGISTRY_URL:-}"
TOKEN_LIST="${REGISTRY_AUTH_TOKENS:-}"

stamp="$(date +%Y%m%d%H%M%S)"
KV_TITLE="${KV_TITLE:-${WORKER_NAME}-kv-${stamp}}"
R2_BUCKET="${R2_BUCKET:-${WORKER_NAME}-tarballs-${stamp}}"

cd "${PROJECT_DIR}"
WRANGLER=(pnpm dlx wrangler)

echo "[1/4] KV namespace 생성: ${KV_TITLE}"
kv_output="$("${WRANGLER[@]}" kv namespace create "${KV_TITLE}")"
printf '%s\n' "${kv_output}"
kv_id="$(printf '%s\n' "${kv_output}" | sed -n 's/.*"id": "\([^"]*\)".*/\1/p' | head -n 1)"

if [[ -z "${kv_id}" ]]; then
  echo "KV namespace id 파싱에 실패했습니다." >&2
  exit 1
fi

echo "[2/4] R2 bucket 생성: ${R2_BUCKET}"
"${WRANGLER[@]}" r2 bucket create "${R2_BUCKET}"

echo "[3/4] wrangler.toml 생성"
cat > wrangler.toml <<TOML
name = "${WORKER_NAME}"
main = "src/worker.ts"
compatibility_date = "${COMPAT_DATE}"
workers_dev = true

[[kv_namespaces]]
binding = "REGISTRY_KV"
id = "${kv_id}"

[[r2_buckets]]
binding = "REGISTRY_R2"
bucket_name = "${R2_BUCKET}"

[observability.logs]
enabled = true
TOML

if [[ -n "${PUBLIC_REGISTRY_URL}" ]]; then
  cat >> wrangler.toml <<TOML

[vars]
PUBLIC_REGISTRY_URL = "${PUBLIC_REGISTRY_URL}"
TOML
fi

if [[ -n "${TOKEN_LIST}" ]]; then
  echo "[3.5/4] 인증 토큰 시크릿 설정"
  printf '%s' "${TOKEN_LIST}" | "${WRANGLER[@]}" secret put REGISTRY_AUTH_TOKENS
fi

echo "[4/4] Worker 배포"
"${WRANGLER[@]}" deploy

echo "완료: kv=${kv_id}, r2=${R2_BUCKET}, worker=${WORKER_NAME}"
