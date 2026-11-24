# TIER LIST NHẠC — NGỌT & THẮNG

Web xếp tier list nhạc Ngọt & Thắng: rút từng bài, nghe, rồi xếp vào 5 hạng KẸO / NGỌT / CUỐN / CŨNG CŨNG / NHẠT.
Mỗi lần xếp được lưu lại, kèm nhật ký từng thao tác.

## 🌐 Web online: https://tierlist-ngot-thang.pages.dev

Mở link là dùng, không cần cài gì. Mọi lần xếp và nhật ký được lưu trên cloud (Cloudflare D1).
Mỗi commit lên nhánh `main` của repo này, Cloudflare tự build và deploy lại sau khoảng 1 phút.

Có 2 cách chạy, cùng một bộ code:

| | Chạy local | Cloudflare Pages |
|---|---|---|
| Cần gì | Node.js 18+ | Tài khoản Cloudflare (miễn phí) |
| Địa chỉ | `http://localhost:5173` | `https://<ten-project>.pages.dev`, không cần mua tên miền |
| Dữ liệu lưu ở | thư mục `data/` | Cloudflare D1 (database miễn phí) |

## 1. Chạy local

```bash
node server.js
```

Mở **http://localhost:5173**. Không cần `npm install`. Đổi cổng: `PORT=8080 node server.js`. Bật mật khẩu: `APP_PASSWORD=matkhau node server.js`.

## 2. Deploy lên Cloudflare Pages (không cần tên miền)

1. Đăng nhập [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Tạo database:** vào **Storage & Databases → D1 SQL Database → Create**, đặt tên `tierlist-nhac`. Không cần tạo bảng, web tự tạo ở lần chạy đầu.
3. **Tạo project:** vào **Workers & Pages → Create → Pages → Connect to Git**, chọn repo này, rồi điền:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `public`

   Bấm **Save and Deploy**.
4. **Gắn database:** đã khai báo sẵn trong `wrangler.toml` (biến `DB` → database `tierlist-nhac`). Nếu bạn deploy vào tài khoản khác, sửa `database_id` trong file đó cho khớp với database của bạn.
5. **Đặt mật khẩu (nên làm):** vào **Settings → Variables and Secrets → Add**, kiểu *Secret*, tên `APP_PASSWORD`, giá trị là mật khẩu bạn muốn.
   Nếu không đặt, ai có link cũng xem và sửa được tier list của bạn.
6. Vào tab **Deployments**, bấm **Retry deployment** (hoặc push một commit mới) để các thiết lập ở bước 4 và 5 có hiệu lực.

Xong. Web chạy ở `https://<ten-project>.pages.dev`. Từ giờ mỗi lần push lên GitHub, Cloudflare tự deploy lại.

**Chuyển các lần xếp cũ trên máy lên cloud** (làm 1 lần), chọn một trong hai cách:
- Mở web online → Menu → **📥 Nhập lần xếp từ file**, chọn các file trong thư mục `data/sessions/` trên máy (chọn được nhiều file cùng lúc).
- Hoặc chạy trong thư mục code trên máy: `node scripts/sync-to-cloud.mjs https://<ten-project>.pages.dev <matkhau>`. Thêm `--list` nếu muốn đẩy luôn tiêu đề và các hạng bạn đã sửa trên máy.

**Xem dữ liệu trên Cloudflare:** trong web vào Menu → Lịch sử / Nhật ký / Xuất kết quả (.md).
Bạn cũng xem được dữ liệu gốc trong D1 → `tierlist-nhac` → **Console**, ví dụ:
`SELECT seq, t, type, json FROM events ORDER BY session_id, seq;`

## Cách chơi

1. Bấm **🎲 Quay**, rồi nhấn Space để dừng.
2. Nghe thử, hoặc mở bài trên Apple Music.
3. Bấm vào một hạng để xếp bài.

Mẹo: kéo bài trên bảng để đổi hạng, chuột phải vào bài để nghe lại, bấm vào tiêu đề hoặc tên hạng để sửa chữ.

**Ngẫu nhiên (nút 🔀 bật):** bấm để quay, nhấn Space để dừng, bài dừng lại tự phát nghe thử. Xếp xong một bài thì vòng quay tự chạy tiếp.
**Theo album (nút 🔀 tắt):** rút lần lượt từng album, thứ tự album ngẫu nhiên, bài trong album đúng thứ tự.
Bấm đúp vào khung bài (hoặc phím `L`) để chọn album, EP hoặc bài muốn xếp trước.

Phím tắt: `Space` quay / dừng · `S` bật/tắt ngẫu nhiên · `1`–`5` xếp hạng · `X` bỏ bài · `Z` hoàn tác · `P` nghe thử · `O` mở Apple Music · `T` vote · `L` chọn bài xếp trước · `M` menu.

## Danh sách bài

83 bài phòng thu, lấy từ Apple Music theo các album và single bạn chọn:

- **Ngọt (54 bài):**
  - Album *Ngọt*, *Ng'bthg*, *3*, *Gieo*.
  - EP *Suýt 1*, *Suýt 2*.
  - Single *để quên*, *Đốt*, *Tìm Người Nhà*.
- **Thắng (24 bài):** album *Cái Đầu Tiên*, *Cái Thứ Hai* và EP *Giấy Trắng*. Trong *Cái Thứ Hai* có bài *Sáng Ra Chỉ Cần* được Apple ghi là Kế Phúc hát.
- **Single (5 bài):** *Để Nó Đến*, *Hướng Dương*, *Nó*, *Người Yêu Có Bạn Gái* (Đồng Lan & Thắng), *An Thần* (Low G & Thắng).

Những bản bỏ qua để tránh trùng:
- Single đã nằm trong album: Mấy Khi, Thấy Chưa, Em Trang Trí, LẦN CUỐI, CHUYỂN KÊNH, Khóc Đấy, Bút Chì Bạc, Đồng Ý, Gội Đầu.
- EP *Cñgđc*: thu lại các bài trong Ng'bthg.
- *Ở Đài Truyền Hình*: bản thu live.
- Mọi bản demo và bản live khác.

**Sửa danh sách:** sửa `data/lists/ngot-thang.json`, rồi chạy `npm run build` để cập nhật `lib/seed-data.js`. Cloudflare cũng tự chạy lệnh này khi deploy.
Lưu ý: trên Cloudflare, nếu bạn đã thêm bài bằng phím `A` thì danh sách được lưu riêng trong D1 (bảng `lists`) và sẽ được dùng thay cho file. Muốn quay về danh sách trong file, xoá dòng đó trong bảng `lists`.

## Cấu trúc code

```
public/              giao diện (HTML, CSS, JS, hoa văn nền)
lib/core.js          logic chung: chống trùng, tra Apple Music, xuất Markdown
lib/api.js           API /api/* (chuẩn Request/Response, dùng chung Node & Cloudflare)
lib/store-fs.js      lưu vào thư mục data/ (chạy local)
lib/store-d1.js      lưu vào Cloudflare D1 (tự tạo bảng)
lib/seed-data.js     danh sách bài + dữ liệu Apple Music đóng gói sẵn (tự sinh, đừng sửa tay)
functions/api/       Cloudflare Pages Function
server.js            server Node cho chạy local
data/lists/          danh sách bài gốc
data/apple-cache.json  link, năm, ảnh bìa, bản nghe thử từ Apple Music
```

Khi chạy local, mỗi lần xếp lưu ở `data/sessions/<id>.json` (kèm bản `.md` dễ đọc) và nhật ký ở `data/logs/<id>.jsonl`. Các file này không được đưa lên Git.
