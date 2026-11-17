# Triển khai trên Botkeep (hoặc panel tương tự)

## 0. Lỗi đang gặp và nguyên nhân

Panel báo:

```
Server ready — add your code
Your server is available. The startup command expects /package.json,
which is not present yet.
```

**Nguyên nhân:** server đó đang được tạo với **runtime Node.js**. Panel Node.js mặc định chạy
`npm start`, mà lệnh đó cần `package.json` — dự án này là **Python** nên không có file đó.
Không phải code sai; chỉ là chọn sai loại runtime.

**Cách sửa:** dùng runtime **Python** cho dự án này (Botkeep cho chọn Node.js **hoặc** Python lúc tạo server).

## 1. Hợp đồng deploy của Botkeep (Python)

| Yêu cầu | Repo này đã có |
|---|---|
| `requirements.txt` | ✅ `discord.py>=2.4,<3`, `aiohttp>=3.9` |
| Một entry point `main.py` | ✅ `main.py` (chuyển tiếp sang `bot.main()`) |
| Lệnh khởi động `python main.py` | ✅ chạy được, đã test |
| Secret qua biến môi trường | ✅ đọc `os.environ["DISCORD_TOKEN"]`, **không** cần `.env` |
| Log ra stdout/stderr | ✅ logging ra stdout |
| Không phụ thuộc file ngoài thư mục dự án | ✅ chỉ dùng `data/accounts.json` (tự tạo) |

## 2. Các bước trên panel

1. **Tạo server mới kiểu Python** (hoặc đổi runtime của server hiện tại sang Python nếu panel cho phép).
   Chọn phiên bản Python **3.11 trở lên** (code dùng `datetime.UTC`, `zip(strict=...)`).
2. **Nguồn code:** chọn *GitHub* → repo `csnhng-lang/-m` → nhánh `main`.
   (Hoặc tải ZIP của repo rồi *Upload files*; nhớ **Project root** là thư mục có `main.py`.)
3. **Startup command:** đúng một dòng

   ```
   python main.py
   ```

   Nếu panel không tự cài dependency, dùng:

   ```
   pip install -r requirements.txt && python main.py
   ```

4. **Environment / Secrets** (mục này thay cho file `.env` — **không upload `.env`**):

   | Biến | Giá trị |
   |---|---|
   | `DISCORD_TOKEN` | token bot (bắt buộc) |
   | `GUILD_ID` | ID server Discord (để lệnh slash hiện ngay) |
   | `MENTION_TRIGGER` | `bot` (mặc định) hoặc `any` |
   | `PRIVACY_ROLE_ID` | ID role được xem dữ liệu nội bộ (tuỳ chọn) |
   | `DATA_PATH` | đường dẫn file dữ liệu trên vùng lưu trữ bền (xem mục 4) |
   | `LOG_LEVEL` | `INFO` |
   | `PRESENCE_INTENT` | `false` (bật `true` nếu đã bật Presence Intent ở Portal) |
   | `GITHUB_ENRICH` / `GITHUB_TOKEN` | tuỳ chọn, để tra GitHub công khai |

5. Bấm **Start**, mở **Console** xem log. Khi chạy đúng sẽ thấy:

   ```
   INFO | accountbot | Đã nạp 0 hồ sơ từ data/accounts.json
   INFO | accountbot | Đã đồng bộ 4 lệnh vào guild 123456789012345678
   ```

## 3. Đừng quên phía Discord

- Bot đã được mời vào server bằng link có scope `bot` + `applications.commands` (xem `docs/INVITE.md`).
- **Developer Portal → Bot:** bật **MESSAGE CONTENT INTENT** và **SERVER MEMBERS INTENT**.
  Thiếu MESSAGE CONTENT là bot chạy mà **không trả lời** khi bị mention.

## 4. Dữ liệu sống sót qua lần deploy lại

`data/accounts.json` **không** nằm trong git (đã `.gitignore`). Mỗi lần *Redeploy* từ GitHub, thư mục dự án
có thể bị dựng lại → mất dữ liệu tài khoản đã nhập.

Vì vậy:

- Nếu panel có **vùng lưu trữ bền (persistent storage)**, đặt `DATA_PATH` trỏ vào đó, ví dụ
  `DATA_PATH=/home/container/data/accounts.json`.
- Sao lưu định kỳ: tải file JSON về máy (hoặc `python scripts/manage.py --data <path> list`).
- Sau mỗi lần deploy, kiểm tra bằng `python scripts/manage.py validate --data <path>`.

## 5. Sự cố thường gặp trên panel

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `startup command expects /package.json` | Đang ở runtime **Node.js** → tạo/đổi sang server **Python** |
| `python: command not found` | Runtime vẫn là Node.js, hoặc image Python thiếu alias → dùng `python3 main.py` |
| Log dừng ngay, báo `Thiếu DISCORD_TOKEN` | Chưa đặt secret `DISCORD_TOKEN` ở mục Environment |
| Báo `ModuleNotFoundError: discord` | Chưa cài dependency → startup command `pip install -r requirements.txt && python main.py` |
| `DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi` | Token sai/đã reset, hoặc bật *Requires OAuth2 Code Grant* ở Portal |
| Bot online nhưng không trả lời khi @user | Chưa bật **MESSAGE CONTENT INTENT** ở Portal |
| Lệnh `/` không hiện | Chưa đặt `GUILD_ID`, hoặc mời bot thiếu scope `applications.commands` |
| OOM / bị kill với 512 MB RAM | Bot này rất nhẹ (chỉ 1 tiến trình, không DB). Nếu vẫn bị kill, kiểm tra `GITHUB_ENRICH` (mỗi lần xem gọi API) và giảm `LOG_LEVEL` |

## 6. Nếu panel chỉ cho Node.js

Repo này là Python, nên khi panel **bắt buộc** Node.js thì có hai lựa chọn:

1. Xin/tạo slot server **Python** trên Botkeep (khuyến nghị — code hiện tại chạy được ngay), hoặc
2. Chuyển sang bản Node.js (discord.js v14) với `package.json`, `npm start`. Bản port cần viết lại
   cùng tính năng (mention → embed hồ sơ, kho JSON, phân quyền `restricted`) và sẽ có bộ test riêng.

Nói rõ bạn muốn hướng nào trước khi port để tránh làm hai bản song song không cần thiết.
