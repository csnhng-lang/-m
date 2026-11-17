# Bot Discord — giới thiệu tài khoản khi @user

Bot Discord (Python, `discord.py` 2.x) trả về **thẻ hồ sơ chi tiết** mỗi khi có người mention một thành viên,
kèm danh sách **các tài khoản liên kết** (GitHub, Steam, Riot, email…) do quản trị server tự nhập.

> Xem trước output thật (dựng trực tiếp từ code): mở [`docs/preview.html`](docs/preview.html)
> — tạo lại bằng `python scripts/preview_embed.py --html docs/preview.html`

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
ngoài (trừ gọi GitHub API công khai khi bạn bật tính năng đó). Mọi thứ không có trong bảng trên là
**không có trong code**.

---

## 2. Yêu cầu

- Python **3.11+** (đã kiểm tra trên 3.13)
- Một ứng dụng bot trên Discord Developer Portal
- Server mà bạn có quyền quản lý

---

## 3. Cài đặt nhanh

```bash
git clone https://github.com/csnhng-lang/-m.git
cd ./-m          # tên repo có dấu "-" nên cần ./

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # Windows: copy .env.example .env
# mở .env, điền DISCORD_TOKEN (và GUILD_ID để lệnh slash hiện ngay)
python bot.py
```

Nếu log in được, bạn sẽ thấy:

```
INFO | accountbot | Đã nạp 0 hồ sơ từ data/accounts.json
INFO | accountbot | Đã đồng bộ 4 lệnh vào guild 123456789012345678
```

---

## 4. Tạo bot trên Discord Developer Portal

1. Vào <https://discord.com/developers/applications> → **New Application** → đặt tên.
2. Tab **Bot** → **Reset Token** → copy token vào `DISCORD_TOKEN` trong `.env`.
   (Token chỉ hiện một lần. Không commit, không dán vào chat.)
3. Vẫn ở tab **Bot**, bật **Privileged Gateway Intents**:
   - ✅ **MESSAGE CONTENT INTENT** — bắt buộc để bot đọc được mention.
   - ✅ **SERVER MEMBERS INTENT** — bắt buộc để lấy vai trò/ngày vào server.
   - ⬜ **PRESENCE INTENT** — tuỳ chọn, chỉ bật nếu muốn hiện online/đang chơi gì
     (bật thì đặt `PRESENCE_INTENT=true`).
4. Tab **OAuth2 → URL Generator**: scope `bot` + `applications.commands`,
   quyền tối thiểu: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`.
5. Mở URL vừa tạo để mời bot vào server. Link mẫu (thay `YOUR_APP_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=84992&scope=bot%20applications.commands
```

6. Lấy **Server ID** (bật Developer Mode trong Discord → chuột phải server → Copy Server ID)
   và điền vào `GUILD_ID` trong `.env` để lệnh slash hiện ngay thay vì chờ tới 1 giờ.

---

## 5. Chạy bằng Docker (tuỳ chọn)

```bash
cp .env.example .env    # điền token
docker compose up -d --build
docker compose logs -f
```

Dữ liệu nằm ở `./data` (đã mount ra ngoài container nên không mất khi rebuild).

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

## 7. Cấu hình (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DISCORD_TOKEN` | — | **Bắt buộc.** Token bot |
| `GUILD_ID` | *(trống)* | ID server để đồng bộ lệnh slash ngay lập tức |
| `MENTION_TRIGGER` | `bot` | `bot` = phải mention bot rồi mention người; `any` = mention ai cũng trả lời (dễ spam); `off` = chỉ dùng lệnh |
| `COMMAND_PREFIX` | `!info` | Tiền tố lệnh chữ |
| `EPHEMERAL` | `false` | `true` = mọi kết quả `/whois` chỉ người gọi thấy |
| `COOLDOWN_SECONDS` | `8` | Chống spam: số giây tối thiểu giữa 2 lần xem cùng một người (`0` = tắt) |
| `PRIVACY_ROLE_ID` | *(trống)* | Role được xem ghi chú nội bộ + tài khoản `restricted` (ngoài admin/Manage Server) |
| `DATA_PATH` | `data/accounts.json` | Đường dẫn kho dữ liệu |
| `LOG_LEVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR` |
| `PRESENCE_INTENT` | `false` | Bật hiển thị online/hoạt động (phải bật intent tương ứng ở Portal) |
| `GITHUB_ENRICH` | `false` | Tra hồ sơ GitHub công khai cho tài khoản `type=github` |
| `GITHUB_TOKEN` | *(trống)* | Token GitHub **của bạn** để tăng hạn mức API (60 → 5.000 req/giờ). Không bắt buộc, không commit |

---

## 8. Riêng tư & an toàn

- **`visibility: public`** — ai xem hồ sơ cũng thấy.
- **`visibility: restricted`** — chỉ hiện với admin/Manage Server/role trong `PRIVACY_ROLE_ID`, **và**
  chỉ trong phản hồi riêng tư (`/whois ... rieng_tu:true` hoặc `EPHEMERAL=true`). Nhờ vậy staff xem
  được dữ liệu nội bộ mà người khác trong kênh không thấy. Khi staff xem ở kênh công khai, mục đó bị
  ẩn kèm ghi chú "_N tài khoản nội bộ bị ẩn_".
- **Ghi chú nội bộ** cũng theo quy tắc trên.
- Mọi văn bản do người dùng nhập (tên, biệt danh, handle, ghi chú) đều được **escape markdown** và
  **bỏ ký tự vô hình** trước khi vào embed — chặn `@everyone`, link giả, chữ giả mạo bằng ký tự
  zero-width. Bot luôn gửi với `AllowedMentions.none()` nên không ping ai.
- `type`, `url`, `visibility` được validate: URL chỉ chấp nhận `http/https` (chặn `javascript:`).
- File dữ liệu được ghi **atomic** (tmp + fsync + replace): mất điện giữa lúc ghi cũng không hỏng file.
  Nếu file hỏng, bot **báo lỗi và dừng**, không bao giờ tự ghi đè dữ liệu của bạn.
- Token chỉ đọc từ biến môi trường/file `.env`; log đã che token (`***abcd`). `.gitignore` đã chặn
  `.env` và `data/accounts.json`.
- Nhật ký thao tác quản trị (ai thêm/xoá tài khoản nào) được ghi ra log ở mức `INFO`.

---

## 9. Dữ liệu

File `data/accounts.json` (tự tạo khi chạy lần đầu). Mẫu đầy đủ: [`data/accounts.example.json`](data/accounts.example.json)

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

Quản lý bằng CLI (không cần mở Discord):

```bash
python scripts/manage.py list
python scripts/manage.py show 123456789012345678
python scripts/manage.py add --user 123456789012345678 --type steam --handle gaben --visibility restricted
python scripts/manage.py remove --user 123456789012345678 --type steam --handle gaben
python scripts/manage.py note --user 123456789012345678 --text "Đã xác minh"
python scripts/manage.py validate          # kiểm tra file có hợp lệ không
```

---

## 10. Kiến trúc

```
bot.py               Vòng đời bot, lệnh slash/menu/mention, cooldown, quyền, xử lý lỗi
config.py            Nạp .env + validate cấu hình, che token khi log
models.py            Dataclass thuần + làm sạch văn bản (không import discord.py → test dễ)
store.py             Kho JSON, ghi atomic, validate schema, không ghi đè file hỏng
embeds.py            Dựng embed + cắt ngắn theo giới hạn Discord (6000/1024 ký tự)
github_api.py        Tra GitHub công khai: cache TTL, xử lý 404/rate limit
scripts/manage.py    CLI quản lý dữ liệu
scripts/preview_embed.py  Xem trước embed (terminal / HTML), kiểm tra độ dài
tests/               123 test: models, store, config, embeds, github, logic bot
```

Kiểm tra chất lượng:

```bash
pip install -r requirements-dev.txt
ruff check .
pytest
```

CI (`.github/workflows/ci.yml`) chạy lint + test mỗi lần push.

---

## 11. Sự cố thường gặp

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| Bot online nhưng mention không phản hồi | Chưa bật **MESSAGE CONTENT INTENT** ở Portal, hoặc `MENTION_TRIGGER=bot` mà bạn chỉ mention người (thiếu mention bot) |
| Lệnh slash không hiện | Chưa điền `GUILD_ID` (lệnh toàn cục mất tới 1 giờ) hoặc thiếu scope `applications.commands` khi mời bot |
| `DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi` | Token sai/đã reset → copy lại vào `.env` |
| Bot không gửi được embed | Thiếu quyền `Embed Links`/`Send Messages` ở kênh đó (log có WARNING) |
| `Không nạp được dữ liệu: ... không phải JSON hợp lệ` | `data/accounts.json` bị sửa sai — bot dừng để bảo vệ dữ liệu. Chạy `python scripts/manage.py validate` |
| Không thấy trạng thái online | Chưa bật `PRESENCE_INTENT=true` (và intent ở Portal) |
| `⚠️ Hết quota GitHub API` | Bật `GITHUB_ENRICH` mà chưa có `GITHUB_TOKEN` (60 req/giờ) |

---

## 12. Push code lên GitHub

Repo đích: `https://github.com/csnhng-lang/-m`

```bash
git init -b main
git add .
git status                 # xác nhận KHÔNG có .env và data/accounts.json
git commit -m "feat: bot Discord giới thiệu tài khoản khi mention"
git remote add origin https://github.com/csnhng-lang/-m.git
git push -u origin main
```

> **Quan trọng:** nếu bạn từng dán token GitHub ra chat/công cụ khác, hãy vào
> GitHub → Settings → Developer settings → **Fine-grained tokens** → **Revoke** token đó rồi tạo token mới.
> Token dùng cho bot chỉ cần quyền đọc `Public repositories` và phải nằm trong `.env`, không nằm trong code.

---

## 13. Giới hạn đã biết

- Người **không ở trong server** chỉ hiện được dữ liệu công khai của tài khoản Discord (tên, avatar, ngày tạo), không có vai trò/ngày vào server.
- Bot chỉ trả lời trong server (bỏ qua DM) để tránh bị lạm dụng làm công cụ tra cứu.
- `MENTION_TRIGGER=any` có thể gây spam ở kênh đông người — nên dùng `bot` (mặc định) hoặc đặt `COOLDOWN_SECONDS` cao hơn.
- Dữ liệu tài khoản liên kết là **do admin nhập**, bot không tự xác minh quyền sở hữu. `verified` chỉ là nhãn đánh dấu.
- Chưa có web dashboard; mọi thao tác qua Discord hoặc CLI.

---

## 14. Giấy phép

MIT — dùng, sửa, triển khai thoải mái.
