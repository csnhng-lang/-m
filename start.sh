#!/usr/bin/env bash
# Khởi động bot trên panel hosting (Botkeep, Pterodactyl...) một cách "không thể sai".
#
# Dùng làm startup command:  bash start.sh
#
# Nó sẽ: in môi trường -> cài dependency nếu thiếu -> chạy bot ở foreground.
# Mọi bước đều in ra Console để biết chết ở đâu.

set -euo pipefail

cd "$(dirname "$0")"

echo "[start] thư mục: $(pwd)"
echo "[start] node: $(node -v 2>/dev/null || echo 'KHÔNG CÓ NODE')  npm: $(npm -v 2>/dev/null || echo 'KHÔNG CÓ NPM')"

if ! command -v node >/dev/null 2>&1; then
  echo "[start] LỖI: không tìm thấy node trong PATH. Panel đang chạy runtime không phải Node.js."
  exit 127
fi

if [ ! -f package.json ]; then
  echo "[start] LỖI: không thấy package.json ở $(pwd)."
  echo "[start] Trên panel: đặt Project root về thư mục có package.json (không phải thư mục con)."
  exit 1
fi

if [ ! -d node_modules/discord.js ]; then
  echo "[start] thiếu dependency -> chạy npm ci"
  npm ci --omit=dev || npm install --omit=dev
else
  echo "[start] dependency đã có (node_modules/discord.js)"
fi

if [ -z "${DISCORD_TOKEN:-}" ]; then
  echo "[start] CẢNH BÁO: chưa có biến môi trường DISCORD_TOKEN (panel: mục Environment/Secrets)."
fi

echo "[start] khởi động: node src/index.js"
exec node src/index.js
