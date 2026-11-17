# Cấp quyền cho bot (OAuth2 URL Generator)

Trang bạn đang mở: **Developer Portal → OAuth2 → URL Generator** (bản tiếng Việt: "Công cụ tạo URL OAuth2").
Đây là nơi tạo link mời bot vào server. Chọn **đúng 2 phạm vi** và **4 quyền** dưới đây là đủ.

## 1. Phạm vi (Scopes) — tick đúng 2 ô

| Ô | Cần? | Vì sao |
|---|---|---|
| ✅ `bot` | **Bắt buộc** | Để bot tham gia server bằng token |
| ✅ `applications.commands` | **Bắt buộc** | Để đăng ký lệnh slash `/whois`, `/taikhoan`, `/help` và menu chuột phải |
| ⬜ `identify`, `email`, `connections`, `guilds`, `guilds.join`, `gdm.join`, `rpc.*`, `messages.read`, `webhook.incoming`, `applications.*`, `openid`, `role_connections.write` | **Không cần** | Đây là scope cho **đăng nhập OAuth2 của người dùng** (user login). Bot này không dùng. Tick thừa = xin quyền không cần thiết, dễ bị Discord/người dùng cảnh báo |

> `applications.commands.permissions.update` cũng **không cần** — nó dùng để bot tự sửa quyền của lệnh slash trong server, dự án này không dùng.

## 2. Quyền của bot (Bot Permissions) — tick đúng 4 ô

Sau khi tick `bot`, danh sách quyền hiện ra bên dưới. Chỉ cần:

| Quyền | Bit | Dùng để |
|---|---|---|
| **View Channels** (Xem kênh) | 1024 | Bot thấy kênh để nhận tin nhắn mention |
| **Send Messages** (Gửi tin nhắn) | 2048 | Gửi câu trả lời |
| **Embed Links** (Nhúng liên kết) | 16384 | Gửi thẻ hồ sơ dạng **embed** — thiếu quyền này bot sẽ không gửi được gì |
| **Read Message History** (Đọc lịch sử tin nhắn) | 65536 | Trả lời (reply) và hiển thị ngữ cảnh ổn định |

**Tổng bit = `84992`.**

❌ **Không** tick: `Administrator`, `Manage Server`, `Manage Roles`, `Manage Messages`, `Mention @everyone/Here`, `Attach Files`, `Connect`/`Speak` (voice), `Kick/Ban Members`. Bot này không cần bất kỳ quyền quản trị nào — cấp thừa chỉ tăng rủi ro.

## 3. Link mời sẵn

Với `client_id` trong ảnh của bạn (`1572129077446578218`):

```
https://discord.com/api/oauth2/authorize?client_id=1572129077446578218&permissions=84992&scope=bot%20applications.commands
```

Mẫu chung (thay `YOUR_APP_ID` bằng **Application ID** ở đầu trang OAuth2):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=84992&scope=bot%20applications.commands
```

Mở link → chọn server → **Authorize** → nhập captcha nếu có. Sau khi thêm, bot hiện trong danh sách thành viên với trạng thái offline cho tới khi bạn chạy `python bot.py`.

## 4. Việc quan trọng hơn cả: 2 Intent ở tab **Bot**

Link mời **không** bật intent. Thiếu bước này bot online nhưng **im lặng hoàn toàn**.

Vào tab **Bot** → mục **Privileged Gateway Intents**:

| Intent | Trạng thái | Nếu thiếu |
|---|---|---|
| **MESSAGE CONTENT INTENT** | ✅ BẬT | Bot **không đọc được nội dung tin nhắn** → không thấy `@user` để trả lời (đây là lỗi phổ biến nhất) |
| **SERVER MEMBERS INTENT** | ✅ BẬT | Không lấy được vai trò, ngày vào server → thẻ hồ sơ thiếu nửa dữ liệu |
| **PRESENCE INTENT** | ⬜ tuỳ chọn | Chỉ ảnh hưởng hiển thị online/đang chơi gì; bật thì đặt `PRESENCE_INTENT=true` trong `.env` |

Cùng tab **Bot**, kiểm tra thêm:

- **Reset Token** → copy vào `DISCORD_TOKEN` trong `.env` (token chỉ hiện **một lần**).
- **Requires OAuth2 Code Grant** → phải **TẮT**. Bật thì `bot.py` sẽ không đăng nhập được bằng token và báo `DISCORD_TOKEN không hợp lệ`.
- **Public Bot** → bật/tắt đều được. Nếu chỉ dùng trong server của bạn thì **tắt** cho gọn.
- **Client Secret** ở trang OAuth2: **không cần** cho bot và **không** đặt ở đâu trong dự án này. Đừng dán vào chat hay commit.

## 5. Checklist chạy được

```
[ ] tick scope: bot + applications.commands
[ ] quyền: View Channels, Send Messages, Embed Links, Read Message History  (= 84992)
[ ] tab Bot: MESSAGE CONTENT INTENT = ON
[ ] tab Bot: SERVER MEMBERS INTENT = ON
[ ] tab Bot: Requires OAuth2 Code Grant = OFF
[ ] mời bot vào server bằng link ở mục 3
[ ] .env có DISCORD_TOKEN (và GUILD_ID để lệnh slash hiện ngay)
[ ] python bot.py  → log "Đã đồng bộ N lệnh vào guild ..."
[ ] thử: @Bot @một_người  hoặc  /whois
```

## 6. Lỗi thường gặp sau khi mời

| Hiện tượng | Nguyên nhân |
|---|---|
| Bot online, mention không trả lời | Chưa bật **MESSAGE CONTENT INTENT** (mục 4) |
| Lệnh `/` không hiện | Thiếu scope `applications.commands` khi mời → mời lại bằng link mục 3; hoặc chưa điền `GUILD_ID` (lệnh toàn cục mất tới 1 giờ) |
| Log báo `DISCORD_TOKEN không hợp lệ hoặc đã bị thu hồi` | Token sai/đã Reset, hoặc **Requires OAuth2 Code Grant** đang bật |
| Bot không gửi được gì | Thiếu **Embed Links** / **Send Messages** ở kênh đó (log có WARNING) |
| Có embed nhưng thiếu vai trò/ngày tham gia | Chưa bật **SERVER MEMBERS INTENT** hoặc bot không có quyền xem thành viên |
| Cấp thừa quyền (Administrator) | Không cần thiết. Vào Server Settings → Integrations → bot → sửa lại cho đúng 4 quyền |

## 7. Nhãn tiếng Việt trong portal (bản dịch của Discord)

Portal của Discord dùng chữ **"máy khách"** cho *client*. Bảng dưới để đối chiếu khi giao diện đang là tiếng Việt.

### 7.1 Phạm vi (Scopes)

| Nhãn trong portal | Tiếng Việt | Cần? |
|---|---|---|
| `bot` | Bot | ✅ bắt buộc |
| `applications.commands` | Lệnh ứng dụng | ✅ bắt buộc |
| `identify` | Nhận diện người dùng | ❌ scope đăng nhập người dùng |
| `email` | Email | ❌ |
| `connections` | Kết nối (tài khoản liên kết) | ❌ |
| `guilds` / `guilds.join` / `guilds.members.read` | Máy chủ / Tham gia máy chủ / Đọc thành viên máy chủ | ❌ |
| `gdm.join` | Tham gia tin nhắn nhóm | ❌ |
| `rpc`, `rpc.voice.read/write`, `rpc.video.*`, `rpc.screenshare.*`, `rpc.activities.write` | RPC, đọc/ghi thoại, video, chia sẻ màn hình, hoạt động | ❌ |
| `messages.read` | Đọc tin nhắn | ❌ |
| `webhook.incoming` | Webhook đến | ❌ |
| `applications.builds.read` / `applications.store.update` / `applications.entitlements` | Đọc bản dựng ứng dụng / cập nhật cửa hàng / quyền lợi | ❌ |
| `openid` | OpenID | ❌ |
| `role_connections.write` | Ghi kết nối vai trò | ❌ |
| `applications.commands.permissions.update` | Cập nhật quyền lệnh ứng dụng | ❌ |

### 7.2 Quyền của bot (4 ô cần tick)

| Nhãn trong portal | Tiếng Việt | Bit | Dùng để |
|---|---|---|---|
| View Channels | **Xem kênh** | 1024 | Thấy kênh, nhận tin nhắn mention |
| Send Messages | **Gửi tin nhắn** | 2048 | Gửi câu trả lời |
| Embed Links | **Nhúng liên kết** | 16384 | Gửi embed hồ sơ (thiếu là không trả lời được) |
| Read Message History | **Đọc lịch sử tin nhắn** | 65536 | Reply, giữ ngữ cảnh |

Tổng bit: **84992**.

### 7.3 Quyền KHÔNG tick

| Nhãn trong portal | Tiếng Việt |
|---|---|
| Administrator | Quản trị viên |
| Manage Server | Quản lý máy chủ |
| Manage Roles | Quản lý vai trò |
| Manage Messages | Quản lý tin nhắn |
| Mention @everyone, @here, and All Roles | Đề cập @everyone, @here và tất cả vai trò |
| Attach Files | Đính kèm tệp |
| Connect / Speak | Kết nối / Nói (thoại) |
| Kick Members / Ban Members | Trục xuất thành viên / Cấm thành viên |
| Moderate Members | Quản lý thành viên (timeout) |

### 7.4 Tab Bot

| Nhãn trong portal | Tiếng Việt | Trạng thái |
|---|---|---|
| Message Content Intent | Ý định nội dung tin nhắn | ✅ BẬT (bắt buộc) |
| Server Members Intent | Ý định thành viên máy chủ | ✅ BẬT (bắt buộc) |
| Presence Intent | Ý định hiện diện | ⬜ tuỳ chọn |
| Reset Token | Đặt lại Token | lấy token mới → `.env` |
| Requires OAuth2 Code Grant | Yêu cầu cấp mã OAuth2 | ⬜ phải TẮT |
| Public Bot | Bot công khai | tắt nếu chỉ dùng nội bộ |

### 7.5 Các mục khác ở trang OAuth2

| Nhãn trong portal | Tiếng Việt | Dùng cho bot? |
|---|---|---|
| ID Máy khách | Application ID / Client ID | ✅ dùng trong link mời |
| Secret máy khách | Client Secret | ❌ không cần, không dán vào đâu |
| Đặt lại Secret | Reset Secret | ❌ |
| Máy khách công khai | Public Client | ❌ không ảnh hưởng |
| Chuyển hướng / Thêm Redirect | Redirect URI | ❌ không cần |
| Công cụ tạo URL OAuth2 | OAuth2 URL Generator | ✅ nơi tạo link mời |
| Phạm vi | Scopes | ✅ tick `bot` + `applications.commands` |
| URL được tạo | Generated URL | ✅ dùng để mời bot |
