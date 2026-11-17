#!/usr/bin/env python3
"""Entry point cho hosting (Botkeep, Pterodactyl, Docker...).

Nhiều panel Python mặc định chạy `python main.py` — file này chỉ chuyển tiếp
sang ``bot.main()`` nên logic thật vẫn nằm ở ``bot.py``, không bị trùng lặp.

Chạy trực tiếp:  python main.py
Biến môi trường cần: DISCORD_TOKEN (trên panel đặt ở mục Environment, không cần .env)
"""

from __future__ import annotations

import sys
from pathlib import Path

# Chạy được cả khi panel gọi từ thư mục khác: thêm thư mục chứa file này vào sys.path.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
