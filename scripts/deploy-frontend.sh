#!/usr/bin/env bash
# 前端部署：bun build → S3 sync → CloudFront invalidation。
# 需求：aws CLI 已設好憑證；S3 bucket 與 CloudFront distribution 已建好
# （一次性設定見 docs/deployment.md）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

missing=()
[[ -z "${FRONTEND_S3_BUCKET:-}" ]] && missing+=("FRONTEND_S3_BUCKET (S3 bucket 名稱,例: my-app-frontend)")
[[ -z "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]] && missing+=("CLOUDFRONT_DISTRIBUTION_ID (例: E1ABCDEF234567)")
[[ -z "${VITE_API_BASE_URL:-}" ]] && missing+=("VITE_API_BASE_URL (API 對外網域,例: https://api.your-domain.com)")
if ((${#missing[@]})); then
  echo "缺少必要環境變數:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "用法: FRONTEND_S3_BUCKET=... CLOUDFRONT_DISTRIBUTION_ID=... VITE_API_BASE_URL=... make deploy-frontend" >&2
  exit 1
fi

command -v aws >/dev/null || { echo "找不到 aws CLI,請先安裝並設定憑證" >&2; exit 1; }
command -v bun >/dev/null || { echo "找不到 bun" >&2; exit 1; }

cd "$REPO_ROOT/frontend"

echo "==> 安裝依賴並建置 (VITE_API_BASE_URL=$VITE_API_BASE_URL)"
bun install --frozen-lockfile
VITE_API_BASE_URL="$VITE_API_BASE_URL" bun run build

echo "==> 上傳 hashed assets (長快取 immutable)"
aws s3 sync dist/assets "s3://$FRONTEND_S3_BUCKET/assets" \
  --exclude "*.map" \
  --cache-control "public,max-age=31536000,immutable"

echo "==> 上傳其餘檔案 (index.html 等,no-cache;--delete 清掉已移除的檔案)"
aws s3 sync dist "s3://$FRONTEND_S3_BUCKET" \
  --exclude "assets/*" \
  --exclude "*.map" \
  --cache-control "no-cache" \
  --delete

echo "==> CloudFront invalidation"
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table

echo "==> 完成。驗證步驟見 docs/deployment.md 的「部署後驗證」。"
