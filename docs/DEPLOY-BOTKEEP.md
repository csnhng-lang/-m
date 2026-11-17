# Triển khai trên Botkeep (hoặc panel tương tự)

## 0. Lỗi "expects /package.json" và cách xử lý

Panel báo:

```
Server ready — add your code
Your server is available. The startup command expects /package.json,
which is not present yet.
```

**Nguyên nhân:** server đang chạy runtime **Node.js** (`npm start`), mà lúc đó project root **chưa có**
`package.json` (bản Python trước đây không có file này).

**Trạng thái hiện tại:** repo **đã có** `package.json` ở root → chỉ cần chọn đúng nguồn code và startup
command, không phải đổi runtime nữa.

| Nếu panel của bạn | Runtime | Startup command |
|---|---|---|
| Node.js (mặc định, khuyến nghị) | Node 18+ (tốt nhất Node 22) | `npm start` |
| Python | Python 3.11+ | `python main.py` |

## 1. Deploy bản Node.js

1. **Tạo/giữ server kiểu Node.js.** Chọn phiên bản **Node 22** nếu có (tối thiểu 18).
2. **Nguồn code:** *GitHub* → repo `csnhng-lang/-m` → nhánh `main`.
   Hoặc tải ZIP → *Upload files* → giải nén sao cho **`package.json` nằm ngay ở project root**.
3. **Startup command:** đúng một dòng

   ```
   npm start
   ```

   Nếu panel không tự cài dependency (log báo `Cannot find package 'discord.js'`):

   ```
   npm ci && npm start
   ```

4. **Environment / Secrets** (mục này thay cho `.env` — **không upload `.env`**):

   | Biến | Giá trị |
   |---|---|
   | `DISCORD_TOKEN` | token bot (bắt buộc) |
   | `GUILD_ID` | ID server Discord (để lệnh slash hiện ngay) |
   | `MENTION_TRIGGER` | `bot` (mặc định) hoặc `any` |
   | `PRIVACY_ROLE_ID` | ID role được xem dữ liệu nội bộ (tuỳ chọn) |
   | `DATA_PATH` | đường dẫn file dữ liệu trên vùng lưu trữ bền (xem mục 3) |
   | `LOG_LEVEL` | `INFO` |
   | `PRESENCE_INTENT` | `false` (bật `true` nếu đã bật Presence Intent ở Portal) |
   | `GITHUB_ENRICH` / `GITHUB_TOKEN` | tuỳ chọn |

5. Bấm **Start**, mở **Console**. Log đúng sẽ như sau:

   ```
   07:14:27 | INFO    | accountbot | Đã nạp 0 hồ sơ từ data/accounts.json
   07:14:28 | INFO    | accountbot | Đã đăng nhập: TenBot#1234
   07:14:28 | INFO    | accountbot | Đã đồng bộ 4 lệnh vào guild 123456789012345678
   ```

## 2. Deploy bản Python (nếu muốn dùng runtime Python)

1. Server kiểu **Python**, chọn **Python 3.11+**.
2. Nguồn code như trên; project root là thư mục có `main.py`.
3. Startup command: `python main.py`, hoặc `pip install -r requirements.txt && python main.py`.
4. Environment: cùng bảng biến như trên.
5. Bản Python và bản Node dùng **chung** `data/accounts.json` — đổi runtime không mất dữ liệu.

## 3. Dữ liệu sống sót qua lần deploy lại

`data/accounts.json` **không** nằm trong git (đã `.gitignore`). Mỗi lần *Redeploy* từ GitHub, thư mục dự
án có thể bị dựng lại → mất dữ liệu tài khoản đã nhập.

- Nếu panel có **vùng lưu trữ bền**, trỏ `DATA_PATH` vào đó, ví dụ `/home/container/data/accounts.json`.
- Sao lưu định kỳ: tải file JSON về, hoặc `node scripts/manage.mjs list` / `python scripts/manage.py list`.
- Sau mỗi lần deploy, kiểm tra: `node scripts/manage.mjs validate` (hoặc bản Python).

## 4. Đừng quên phía Discord

- Bot đã mời vào server bằng link có scope `bot` + `applications.commands` (xem `docs/INVITE.md`).
- **Developer Portal → Bot:** bật **MESSAGE CONTENT INTENT** và **SERVER MEMBERS INTENT**.
  Thiếu MESSAGE CONTENT là bot chạy mà **không trả lời** khi bị mention.

## 4b. Bot "bật lên rồi tắt ngay" — chẩn đoán 60 giây

Panel chỉ hiện vài dòng log cuối nên rất dễ mất nguyên nhân. Chạy trong Console của panel:

```
npm run doctor -- --login
```

Nó tự kiểm tra và in kết quả từng mục:

```
✅ Phiên bản Node: v22.x
✅ Thư mục làm việc: /home/container
❌ dependency discord.js: CHƯA cài (node_modules không có discord.js)
     → Đặt startup command thành `npm ci && npm start`
❌ DISCORD_TOKEN: CHƯA ĐẶT
     → Panel → Environment/Secrets → thêm DISCORD_TOKEN
✅ Đăng nhập thử: thành công: TenBot#1234 · 1 server
KẾT LUẬN: 2 lỗi chặn khởi động — sửa theo mũi tên ở trên.
```

Ba nguyên nhân theo thứ tự hay gặp:

| # | Nguyên nhân | Dấu hiệu | Cách sửa |
|---|---|---|---|
| 1 | Chưa cài dependency | log `Cannot find package 'discord.js'` | startup command: `npm ci && npm start` |
| 2 | Thiếu `DISCORD_TOKEN` | log `[cấu hình] Thiếu DISCORD_TOKEN…` (mã thoát 2) | thêm secret ở Environment |
| 3 | Token sai / đã Reset | `DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi` (mã thoát 4) | Reset Token → dán lại |

Ngoài ra bot giờ log **từng bước khởi động** `[1/5] … [5/5]`, nên nhìn dòng cuối là biết nó chết ở đâu.
Nếu panel yêu cầu process phải mở cổng, đặt `HEALTH_PORT` (hoặc `PORT`) — bot sẽ mở endpoint `/` trả `{"ok":true}`.

## 5. Sự cố thường gặp trên panel

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `startup command expects /package.json` | Project root chưa có `package.json` → `package.json` phải nằm ngay thư mục gốc được chọn (không nằm trong thư mục con) |
| `Cannot find package 'discord.js'` | Chưa cài dependency → startup `npm ci && npm start` |
| `ERR_REQUIRE_ESM` / lỗi `import` | Node quá cũ → chọn Node 18+, tốt nhất 22 |
| `python: command not found` | Runtime là Node.js → dùng `npm start`, hoặc đổi sang server Python |
| Log dừng ngay, báo `Thiếu DISCORD_TOKEN` | Chưa đặt secret `DISCORD_TOKEN` ở mục Environment |
| `DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi` | Token sai/đã reset, hoặc bật *Requires OAuth2 Code Grant* ở Portal |
| `Used disallowed intents` | Portal chưa bật intent tương ứng (Message Content / Server Members / Presence) |
| Bot online nhưng không trả lời khi @user | Chưa bật **MESSAGE CONTENT INTENT** |
| Không thấy trạng thái online | Chưa đặt `PRESENCE_INTENT=true` (và chưa bật intent ở Portal) |
| OOM / bị kill với 512 MB RAM | Bot rất nhẹ (1 tiến trình, không DB). Kiểm tra `GITHUB_ENRICH`, giảm `LOG_LEVEL` |
