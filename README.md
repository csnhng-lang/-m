# Bot Discord — giới thiệu tài khoản khi @user

Bot Discord trả về **thẻ hồ sơ chi tiết** mỗi khi có người mention một thành viên, kèm danh sách
**các tài khoản liên kết** (GitHub, Steam, Riot, email…) do quản trị server tự nhập.

Repo có **hai bản chạy được, dùng chung dữ liệu và chung file `.env`**:

| Bản | Ngôn ngữ | Entry point | Dùng khi nào |
|---|---|---|---|
| **Node.js** (chính) | Node 18+ · discord.js 14 | `npm start` → `src/index.js` | Host mặc định Node.js, hoặc panel báo *"expects /package.json"* |
| Python | Python 3.11+ · discord.py 2.x | `python main.py` | Host runtime Python |

Cả hai đọc/ghi **cùng một** `data/accounts.json` với cùng cấu trúc, nên đổi qua lại không mất dữ liệu.

> Xem trước output thật: [`docs/preview.html`](docs/preview.html) (dựng từ code)
> hoặc `node scripts/preview.mjs` / `python scripts/preview_embed.py`

```
@Bot @user        →  bot trả lời bằng embed hồ sơ (mặc định)
@user             →  bot trả lời (nếu MENTION_TRIGGER=any)
!info @user       →  lệnh chữ
/whois user:@user →  lệnh slash (rieng_tu:true = chỉ mình bạn thấy)
```

---

## 1. Bot hiển thị những gì

**Từ Discord (công khai, ai trong server cũng thấy được):**

| Nhóm | Nội dung |
|---|---|
| Danh tính | ID, username, tên hiển thị, biệt danh trong server, là bot hay người |
| Thời gian | Ngày tạo tài khoản, ngày vào server, ngày boost — kèm "cách đây bao lâu" (tự đổi theo timezone người xem) |
| Vai trò | Vai trò cao nhất + danh sách vai trò, màu embed lấy theo vai trò cao nhất |
| Khác | Huy hiệu (Active Developer, Early Supporter…), banner, trạng thái online, hoạt động (nếu bật presence) |

**Từ kho dữ liệu của server (do admin nhập, không lấy từ đâu khác):**

| Nhóm | Nội dung |
|---|---|
| Tài khoản liên kết | Loại (github/steam/riot/…), handle, nhãn, link, đã xác minh chưa, ngày thêm |
| Ghi chú nội bộ | Chỉ người có quyền xem (xem mục 8) |
| GitHub công khai | Nếu bật `GITHUB_ENRICH`: tên, bio, số repo, follower, ngày tạo tài khoản GitHub |

**Bot KHÔNG làm và không thể làm:** không đọc email/số điện thoại/tin nhắn riêng của ai, không đăng nhập
vào tài khoản của người khác, không lấy dữ liệu từ server mà bot không ở trong, không gửi dữ liệu ra
ngoài (trừ gọi GitHub API công khai khi bạn bật tính năng đó).

---

## 2. Chạy bản Node.js (khuyến nghị)

```bash
git clone https://github.com/csnhng-lang/-m.git
cd ./-m            # tên repo có dấu "-" nên cần ./

npm ci             # hoặc: npm install
cp .env.example .env   # điền DISCORD_TOKEN (+ GUILD_ID)
npm start
```

Log khi chạy đúng:

```
07:14:27 | INFO    | accountbot | Đã nạp 0 hồ sơ từ data/accounts.json
07:14:28 | INFO    | accountbot | Đã đăng nhập: TenBot#1234
07:14:28 | INFO    | accountbot | Đã đồng bộ 4 lệnh vào guild 123456789012345678
```

Lệnh phụ:

```bash
npm test                            # 116 test (node:test), không cần token
npm run doctor                      # chẩn đoán: vì sao bot không chạy
npm run doctor -- --login           # kiểm tra token bằng cách đăng nhập thật
bash start.sh                       # khởi động kiểu panel: tự cài deps nếu thiếu rồi chạy bot
node scripts/preview.mjs            # xem trước embed + độ dài ký tự
node scripts/manage.mjs list        # CLI quản lý dữ liệu
```

## 2b. Deploy lên hosting (Botkeep, Pterodactyl, panel Node.js)

```
Runtime:   Node.js 18+  (Botkeep gợi ý Node 22)
Start:     npm start
Nguồn:     GitHub → csnhng-lang/-m → nhánh main
Secrets:   DISCORD_TOKEN, GUILD_ID … đặt ở mục Environment (KHÔNG upload .env)
```

Chi tiết + bảng sự cố: [`docs/DEPLOY-BOTKEEP.md`](docs/DEPLOY-BOTKEEP.md)

## 3. Chạy bản Python (tuỳ chọn)

```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python main.py                                      # hoặc: python bot.py
```

Trên panel Python, startup command là `python main.py` (hoặc `pip install -r requirements.txt && python main.py`).

## 4. Docker

```bash
docker build -f Dockerfile.node -t account-bot . && docker run --env-file .env -v ./data:/app/data account-bot
docker build -f Dockerfile -t account-bot-py .       # bản Python
```

---

## 5. Tạo bot trên Discord Developer Portal

1. Vào <https://discord.com/developers/applications> → **New Application**.
2. Tab **Bot** → **Reset Token** → copy vào `DISCORD_TOKEN`.
3. Vẫn tab **Bot**, bật **Privileged Gateway Intents**:
   - ✅ **MESSAGE CONTENT INTENT** — bắt buộc để bot đọc được mention.
   - ✅ **SERVER MEMBERS INTENT** — bắt buộc để lấy vai trò/ngày vào server.
   - ⬜ **PRESENCE INTENT** — tuỳ chọn (bật thì đặt `PRESENCE_INTENT=true`).
   - **Requires OAuth2 Code Grant** phải **TẮT**.
4. Tab **OAuth2 → URL Generator**: scope `bot` + `applications.commands`, quyền
   `View Channels`, `Send Messages`, `Embed Links`, `Read Message History` (= **84992**).
5. Mời bot bằng link mẫu (thay `YOUR_APP_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=84992&scope=bot%20applications.commands
```

6. (Khuyến nghị) Điền `GUILD_ID` để lệnh slash hiện ngay thay vì chờ tới 1 giờ.

Chi tiết từng bước + bản dịch nhãn tiếng Việt: [`docs/INVITE.md`](docs/INVITE.md)

---

## 6. Cách dùng

| Cách | Ví dụ | Ai thấy kết quả |
|---|---|---|
| Mention bot + mention người | `@Bot @user` | Cả kênh |
| Mention trực tiếp (nếu `MENTION_TRIGGER=any`) | `@user` | Cả kênh |
| Lệnh chữ | `!info @user` | Cả kênh |
| Lệnh slash | `/whois user:@user` | Cả kênh (hoặc chỉ bạn với `rieng_tu:true`) |
| Menu chuột phải | Chuột phải vào người dùng → Ứng dụng → **Xem tài khoản** | Cả kênh |
| Trợ giúp | `/help` hoặc `@Bot` (không kèm ai) | Chỉ bạn |

Lệnh quản trị (cần quyền **Quản lý server**):

```
/taikhoan add user:@user type:github handle:csnhng-lang label:"GitHub chính" url:https://github.com/csnhng-lang verified:true
/taikhoan remove user:@user type:github handle:csnhng-lang
/taikhoan note user:@user note:"Đã xác minh danh tính"
/taikhoan list user:@user
```

---

## 7. Cấu hình (`.env` hoặc Environment của panel)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DISCORD_TOKEN` | — | **Bắt buộc.** Token bot |
| `GUILD_ID` | *(trống)* | ID server để đồng bộ lệnh slash ngay lập tức |
| `MENTION_TRIGGER` | `bot` | `bot` = phải mention bot rồi mention người; `any` = mention ai cũng trả lời (dễ spam); `off` = chỉ dùng lệnh |
| `COMMAND_PREFIX` | `!info` | Tiền tố lệnh chữ |
| `EPHEMERAL` | `false` | `true` = mọi kết quả `/whois` chỉ người gọi thấy |
| `COOLDOWN_SECONDS` | `8` | Chống spam: số giây tối thiểu giữa 2 lần xem cùng một người (`0` = tắt) |
| `PRIVACY_ROLE_ID` | *(trống)* | Role được xem ghi chú nội bộ + tài khoản `restricted` |
| `DATA_PATH` | `data/accounts.json` | Đường dẫn kho dữ liệu |
| `LOG_LEVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR` |
| `PRESENCE_INTENT` | `false` | Bật hiển thị online/hoạt động (phải bật intent ở Portal) |
| `GITHUB_ENRICH` | `false` | Tra hồ sơ GitHub công khai cho tài khoản `type=github` |
| `GITHUB_TOKEN` | *(trống)* | Token GitHub của bạn để tăng hạn mức API (60 → 5.000 req/giờ). Không bắt buộc |

---

## 8. Riêng tư & an toàn

- **`visibility: public`** — ai xem hồ sơ cũng thấy.
- **`visibility: restricted`** — chỉ hiện với admin/Manage Server/role trong `PRIVACY_ROLE_ID`, **và**
  chỉ trong phản hồi riêng tư (`/whois ... rieng_tu:true` hoặc `EPHEMERAL=true`). Khi staff xem ở kênh
  công khai, mục đó bị ẩn kèm ghi chú "_N tài khoản nội bộ bị ẩn_".
- **Ghi chú nội bộ** theo cùng quy tắc.
- Mọi văn bản người dùng nhập (tên, biệt danh, handle, ghi chú) được **escape markdown** và **bỏ ký tự
  vô hình** trước khi vào embed — chặn `@everyone`, link giả, chữ giả mạo bằng ký tự zero-width.
  Bot luôn gửi với `allowedMentions: { parse: [] }` nên không ping ai.
- `type`, `url`, `visibility` được validate: URL chỉ nhận `http/https` (chặn `javascript:`).
- File dữ liệu ghi **atomic** (tmp + fsync + rename). File hỏng → bot **báo lỗi và dừng**, không tự ghi đè.
- Token chỉ đọc từ biến môi trường; log đã che token (`***abcd`). `.gitignore` chặn `.env`,
  `data/accounts.json`, `node_modules`, `uploads/`.
- Nhật ký thao tác quản trị (ai thêm/xoá tài khoản nào) ghi ra log mức `INFO`.

---

## 9. Dữ liệu

File `data/accounts.json` (tự tạo khi chạy lần đầu). Mẫu: [`data/accounts.example.json`](data/accounts.example.json)

```json
{
  "version": 1,
  "users": {
    "123456789012345678": {
      "display_name": "Tên nội bộ",
      "notes": "Ghi chú chỉ staff thấy",
      "accounts": [
        {
          "type": "github",
          "handle": "csnhng-lang",
          "label": "GitHub chính",
          "url": "https://github.com/csnhng-lang",
          "visibility": "public",
          "verified": true,
          "added_at": "2026-01-01T00:00:00+00:00"
        }
      ]
    }
  }
}
```

Quản lý bằng CLI — **hai bản CLI tương đương, chọn cái nào cũng được**:

```bash
# Node.js
node scripts/manage.mjs list
node scripts/manage.mjs add --user 123456789012345678 --type steam --handle gaben --visibility restricted
node scripts/manage.mjs remove --user 123456789012345678 --type steam --handle gaben
node scripts/manage.mjs note --user 123456789012345678 --text "Đã xác minh"
node scripts/manage.mjs validate

# Python
python scripts/manage.py list
python scripts/manage.py add --user 123456789012345678 --type steam --handle gaben --visibility restricted
```

> Trên hosting, `data/accounts.json` **không** nằm trong git. Mỗi lần redeploy có thể bị dựng lại →
> trỏ `DATA_PATH` vào vùng lưu trữ bền và sao lưu định kỳ.

---

## 10. Kiến trúc

```
# Bản Node.js (chính)
src/index.js         Vòng đời bot: intents, đăng ký lệnh, mention, cooldown, mã thoát
src/commands.js      Định nghĩa lệnh slash + xử lý interaction (whois/help/taikhoan/menu)
src/render.js        Ghép Discord + store + GitHub thành embed; kiểm tra quyền staff
src/snapshot.js      Trích dữ liệu từ discord.js thành object thuần
src/embeds.js        Dựng embed + cắt theo giới hạn Discord (6000/1024/256)
src/store.js         Kho JSON: ghi atomic, validate schema, tuần tự hoá ghi
src/accounts.js      Kiểu dữ liệu + validate tài khoản/hồ sơ
src/text.js          Làm sạch văn bản, escape markdown, humanDelta, timestamp
src/github.js        GitHub API công khai: cache TTL, 404, rate limit
scripts/manage.mjs   CLI quản lý dữ liệu
scripts/preview.mjs  Xem trước embed trong terminal
test/                113 test (node:test)

# Bản Python (thay thế)
main.py              Entry point cho panel Python
bot.py, config.py, models.py, store.py, embeds.py, github_api.py
scripts/manage.py, scripts/preview_embed.py
tests/               137 test (pytest)
```

Kiểm tra chất lượng:

```bash
npm ci && npm test                       # Node
pip install -r requirements-dev.txt
ruff check . && pytest                   # Python
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) chạy cả hai bộ test mỗi lần push.

---

## 11. Sự cố thường gặp

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| **Bật lên rồi tắt ngay** | Chạy `npm run doctor -- --login` trong Console của panel — nó chỉ đúng lỗi. 3 nguyên nhân hay gặp: (1) thiếu `DISCORD_TOKEN` ở Environment, (2) chưa cài dependency → startup `bash start.sh` hoặc `npm ci && npm start`, (3) Node < 18 |
| Panel báo Offline dù đã bấm Start | Xem tab Console: nếu là `[cấu hình] Thiếu DISCORD_TOKEN` → thêm secret; nếu không có dòng nào → startup command/project root sai |
| Log chỉ có `[1/5]…` rồi dừng | Thiếu cấu hình (thường là `DISCORD_TOKEN`) — xem dòng `[cấu hình]` ngay dưới |
| Panel báo `startup command expects /package.json` | Server đang ở runtime Node nhưng thiếu `package.json` ở **project root** → chọn đúng root là thư mục có `package.json`, hoặc dùng bản Python với runtime Python |
| `python: command not found` | Đang ở runtime Node.js → đổi runtime Python, hoặc dùng `npm start` |
| Bot online nhưng mention không phản hồi | Chưa bật **MESSAGE CONTENT INTENT**, hoặc `MENTION_TRIGGER=bot` mà bạn chỉ mention người |
| Lệnh slash không hiện | Chưa điền `GUILD_ID`, hoặc mời bot thiếu scope `applications.commands` |
| `DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi` | Token sai/đã reset → copy lại; kiểm tra *Requires OAuth2 Code Grant* đã tắt |
| `Used disallowed intents` | Portal chưa bật intent tương ứng với cấu hình (ví dụ `PRESENCE_INTENT=true`) |
| Bot không gửi được embed | Thiếu quyền `Embed Links`/`Send Messages` ở kênh đó (log có WARNING) |
| `Không nạp được dữ liệu: ... không phải JSON hợp lệ` | File dữ liệu bị sửa sai — bot dừng để bảo vệ dữ liệu. Chạy `manage.mjs validate` |
| `⚠️ Hết quota GitHub API` | Bật `GITHUB_ENRICH` mà chưa có `GITHUB_TOKEN` |

---

## 12. Push code lên GitHub

```bash
git add -A
git status                 # xác nhận KHÔNG có .env, data/accounts.json, node_modules
git commit -m "mô tả thay đổi"
git push
```

> Nếu bạn từng dán token GitHub ra chat/công cụ khác: vào GitHub → Settings → Developer settings →
> Fine-grained tokens → **Revoke** rồi tạo token mới. Token chỉ nên nằm trong `.env`, không nằm trong code.

---

## 13. Giới hạn đã biết

- Người **không ở trong server** chỉ hiện dữ liệu công khai của tài khoản Discord, không có vai trò/ngày vào server.
- Bot bỏ qua DM để tránh bị dùng làm công cụ tra cứu.
- `MENTION_TRIGGER=any` có thể gây spam ở kênh đông người — nên dùng `bot` (mặc định).
- Dữ liệu tài khoản liên kết do **admin nhập**, bot không tự xác minh quyền sở hữu; `verified` chỉ là nhãn.
- Chưa có web dashboard; mọi thao tác qua Discord hoặc CLI.

---

## 14. Giấy phép

MIT — xem [LICENSE](LICENSE).
