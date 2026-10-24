# App Soạn Giáo Án — Bản độc lập (chạy ngoài Muse)

Bản này được dựng lại đầy đủ tính năng của App Soạn Giáo Án bản đầy đủ trong Muse,
để đưa lên hosting riêng và gắn tên miền phụ `soangiaoan.nguyenvanquan.io.vn`,
cho giáo viên bên ngoài dùng thử mà không phụ thuộc Muse.

## Điểm khác biệt so với bản trong Muse

- Chỉ dùng Node.js chuẩn, **không npm install, không dependency ngoài**.
- Dữ liệu lưu bằng file JSON (`data/db.json`) — dễ sao lưu, dễ dời máy.
- Khách dùng thử được định danh bằng cookie ngẫu nhiên phía máy chủ
  (cookie `HttpOnly`), không cần tạo tài khoản.
- Soạn bằng mẫu thông minh phía máy chủ. Nếu máy chủ có biến môi trường
  `OPENAI_API_KEY` thì phần “sửa từng mục” mới gọi AI; không có key vẫn chạy tốt
  bằng mẫu (không bao giờ chặn tính năng vì thiếu key).

## Chạy local

Yêu cầu: Node.js 20 trở lên (đã kiểm tra với Node v24).

```bash
cd standalone
node server.js
# Mở http://localhost:3000
# Đổi cổng: PORT=8080 node server.js
```

Lần đầu chạy, thư mục `data/` và file `data/db.json` sẽ được tạo với dữ liệu trống:
không có giáo án mẫu, không có lead mẫu, cộng đồng trống.

Biến môi trường:

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `PORT` | Không (mặc định 3000) | Cổng app lắng nghe |
| `ADMIN_PASSWORD` | **Nên đặt trên VPS** | Mật khẩu xem tab lead “Đăng ký bản đầy đủ”. Nếu không đặt, tab lead đang mở. |
| `OPENAI_API_KEY` | Không | Chỉ dùng cho “sửa từng mục” bằng AI; không có thì dùng mẫu. |

## Tính năng

1. Soạn giáo án 10 mục theo khung CV 5512 / GDPT 2018.
   Mầm non dùng Chương trình Giáo dục mầm non, không ghi GDPT 2018.
   Cấp: Mầm non / Tiểu học / THCS / THPT / Khác; môn/lớp theo cấp hoặc tự nhập;
   bộ sách: Kết nối tri thức / Cánh diều / Chân trời sáng tạo.
   “Yêu cầu cần đạt” ghi rõ là **gợi ý tham khảo, đối chiếu Sách giáo viên** —
   không bịa là kho chính thức theo từng bộ sách/môn/lớp/bài.
2. Hồ sơ giáo viên lưu 1 lần, tự điền vào đầu giáo án và khối ký tên.
3. Tự chấm /100: đủ mục 5512, động từ đo lường được, tổng thời lượng hoạt động
   so với thời lượng tiết, phân hóa, tiêu chí đánh giá.
   **Chỉ tính thời lượng chính của từng hoạt động, không cộng dồn phút bước con.**
4. Sửa từng mục: rút gọn, chi tiết hơn, thêm trò chơi, tách GV–HS.
5. Cổng đăng ký: khách chưa đăng ký soạn tối đa 3 giáo án (đếm phía máy chủ
   theo cookie, hiển thị “đã soạn X/3 — còn Y”). Giáo án thứ 4 bị chặn và hiện
   form chỉ hỏi họ tên + số điện thoại + email (bắt buộc; điện thoại VN 10 số
   bắt đầu bằng 0; email đúng định dạng) + cấp/môn tùy chọn. Đăng ký xong tạo
   ngay giáo án đang chờ, không hỏi lại, không tạo lead trùng.
   Nhân bản và dùng giáo án cộng đồng **không** tính vào 3 giáo án.
   Tab quản trị lead: danh sách kèm số giáo án lúc đăng ký, nhãn “khách nóng”
   nếu đã đủ 3 giáo án, trạng thái Chưa liên hệ / Đã liên hệ /
   Đã dùng bản đầy đủ, tìm kiếm + lọc, xuất CSV.
6. Thư viện cá nhân: tìm/lọc/nhân bản, xem bản in A4 (bảng 3 cột tiến trình
   theo 5512), tải .doc tương thích Word và .txt, sao chép.
7. Cộng đồng: chia sẻ giáo án (hiện tên giáo viên + trường từ hồ sơ),
   tìm/lọc theo cấp/môn/bài, hiện điểm tự chấm và lượt dùng lại,
   “Dùng ngay” tạo bản sao độc lập và tăng lượt dùng lại của bản gốc.
8. Soạn hàng loạt: dán dòng “Tuần | Tên bài | Số tiết”, tối đa 15 giáo án/lần,
   lỗi báo theo tên bài.
9. Mẫu của trường: dán mẫu đã duyệt trong hồ sơ, máy chủ trích quy ước
   (thứ tự mục, thuật ngữ cố định, khối ký tên) cho giáo viên sửa;
   các giáo án sau tuân theo khối ký tên đó.
10. Tổ/trường: tạo tổ có mã mời tự sinh, tham gia bằng mã (không phân biệt
    hoa/thường), vai trò Tổ trưởng / Ban giám hiệu / Giáo viên; nộp duyệt:
    chờ duyệt → Tổ trưởng/Ban giám hiệu bình luận và duyệt hoặc yêu cầu sửa,
    có lịch sử duyệt, rút khỏi hàng chờ được; giáo án đã duyệt hiện
    huy hiệu “Tổ đã duyệt ✓”.
11. Thống kê & Gói: số liệu thật từ dữ liệu (tổng, đã nộp/chờ/duyệt/cần sửa,
    tỉ lệ duyệt, theo môn, theo cấp, lượt dùng lại cộng đồng, duyệt gần đây),
    toàn app hoặc theo tổ; 3 gói Miễn phí / Tổ chuyên môn / Trường học,
    gói trả phí ghi giá “Liên hệ”, ghi rõ app không thu tiền trong app.

## Bảo mật tối thiểu (đã làm)

- Không lưu mật khẩu dạng text. Tab lead dùng mật khẩu quản trị qua biến môi
  trường `ADMIN_PASSWORD` (so sánh bằng `crypto.timingSafeEqual`) và session
  bằng token ngẫu nhiên trong cookie `HttpOnly`.
- Cookie khách là token ngẫu nhiên, không chứa thông tin cá nhân.
- Máy chủ không ghi số điện thoại/email ra console hay log.
- Dữ liệu liên hệ chỉ nằm trong `data/db.json` trên máy chủ của sếp — hãy sao
  lưu file này và hạn chế quyền đọc (`chmod 600`).

## Phương án MIỄN PHÍ — giống mô hình Game (khuyên dùng để dùng thử trước)

Đây là cách gần nhất với cách `game.nguyenvanquan.io.vn` đang chạy:
nền tảng tự lo máy chủ + tên miền riêng, sếp không phải thuê và quản trị VPS.
Nền tảng gợi ý: **Render (gói Free, Web Service chạy Node)** hoặc một PaaS
tương đương có gói miễn phí, hỗ trợ chạy ứng dụng Node và gắn tên miền riêng
(ví dụ Fly.io trong hạn mức miễn phí). **Không dùng Vercel/Netlify cho bản này
mà không sửa code**, vì hai nền tảng đó chủ yếu chạy web tĩnh/serverless,
không chạy nguyên vẹn một máy chủ Node lưu file JSON như `server.js` này.

Các bước (làm đúng theo hướng dẫn DNS mà nền tảng hiển thị, vì mỗi nền tảng
hiển thị tên máy chủ và mã xác minh khác nhau):

1. Đưa code trong thư mục `standalone/` lên một kho Git (GitHub/GitLab).
   Không cần bước build, không cần `npm install` — code chỉ dùng Node chuẩn.
2. Trên Render, tạo **Web Service** mới từ kho Git đó:
   - Runtime: Node 20+.
   - Start Command: `node server.js` (Render tự cấp `PORT`, app đã đọc từ
     biến môi trường `PORT` nên không cần sửa code).
   - Biến môi trường: đặt `ADMIN_PASSWORD` (mật khẩu xem tab lead).
     `OPENAI_API_KEY` là tùy chọn, không có vẫn chạy bằng mẫu.
3. Trong mục Custom Domain của dịch vụ, thêm tên miền phụ
   `soangiaoan.nguyenvanquan.io.vn`. Nền tảng sẽ hiển thị:
   - tên máy chủ đích để trỏ tới (dạng `ten-app.onrender.com` trên Render),
   - và có thể thêm một bản ghi TXT xác minh quyền sở hữu.
4. Vào Tenten, quản trị tên miền `nguyenvanquan.io.vn`:
   - **XÓA** bản ghi REDIRECT tên `soangiaoan` hiện tại (đang trỏ về link
     Bản Share của Muse) — xem thêm mục DNS ở cuối README.
   - **THÊM** bản ghi CNAME tên `soangiaoan` trỏ về tên máy chủ đích mà
     nền tảng đã cấp ở bước 3, và thêm bản ghi TXT xác minh nếu nền tảng
     yêu cầu (đúng mẫu CNAME + TXT như `game` đang dùng với
     `custom-domains.chatgpt.site`).
   - **Giữ nguyên 6 bản ghi ebook/game**, không sửa, không xóa.
5. Chờ DNS lan truyền, nền tảng tự cấp chứng chỉ SSL cho tên miền phụ
   (không cần tự chạy Certbot như hướng VPS). Sau đó mở
   `https://soangiaoan.nguyenvanquan.io.vn` để kiểm tra.
   Nếu nền tảng báo tên miền chưa xác minh, đối chiếu lại đúng từng ký tự
   bản ghi CNAME/TXT mà nền tảng hiển thị — đó là lỗi thường gặp nhất.

### Giới hạn gói miễn phí — phải biết trước khi mở cho giáo viên

- **Máy chủ “ngủ” khi không dùng:** gói Free của Render tắt máy sau một
  thời gian không có truy cập; người đầu tiên mở lại sau đó phải chờ máy
  khởi động lại (thường khoảng vài chục giây). Đây là giới hạn của gói miễn
  phí, không phải lỗi app.
- **Giới hạn tài nguyên và giờ chạy:** gói miễn phí có giới hạn giờ chạy/tháng
  và cấu hình thấp; đông người dùng cùng lúc sẽ chậm hoặc hết hạn mức.
- **Dữ liệu file JSON có thể mất khi nền tảng khởi động lại:** trên gói miễn
  phí, ổ đĩa của dịch vụ thường là tạm thời (ephemeral) — mỗi lần triển khai
  lại hoặc máy chủ khởi động lại, file `data/db.json` có thể trở về trống.
  Vì vậy trong giai đoạn dùng thử miễn phí, quản trị phải **sao lưu/xuất dữ
  liệu định kỳ**: vào tab “Đăng ký bản đầy đủ” để xuất CSV lead, và sao lưu
  giáo án quan trọng bằng cách tải .doc/.txt. Đừng coi gói miễn phí là nơi
  lưu dữ liệu duy nhất.
- **Khi nào cần nâng cấp trả phí:** khi giáo viên dùng thường xuyên, không
  chấp nhận chờ máy “ngủ” dậy, hoặc khi dữ liệu lead/giáo án không được phép
  mất — lúc đó chuyển sang gói trả phí của chính nền tảng đó (thêm ổ đĩa bền
  vững) hoặc sang VPS ở mục dưới, rồi trỏ lại DNS theo hướng dẫn tương ứng.

## Triển khai VPS trả phí (Node 20+, systemd, Nginx, Certbot)

Giả sử VPS đã có Node 20+, Nginx, Certbot. Thay `IP_CUA_VPS` bằng IP thật.

```bash
# 1. Đưa code lên VPS (ví dụ /opt/soangiaoan)
scp -r standalone/ root@IP_CUA_VPS:/opt/soangiaoan/
ssh root@IP_CUA_VPS
cd /opt/soangiaoan
chmod 600 data/db.json 2>/dev/null || true

# 2. Chạy bằng systemd: /etc/systemd/system/soangiaoan.service
```

Nội dung file `soangiaoan.service`:

```ini
[Unit]
Description=App Soan Giao An
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/soangiaoan
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=ADMIN_PASSWORD=dat-mat-khau-quan-tri-o-day
# Environment=OPENAI_API_KEY=...   # tùy chọn, không bắt buộc
User=root

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now soangiaoan
systemctl status soangiaoan
```

Nginx reverse proxy (`/etc/nginx/sites-available/soangiaoan`):

```nginx
server {
    listen 80;
    server_name soangiaoan.nguyenvanquan.io.vn;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/soangiaoan /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
# Cấp chứng chỉ SSL cho tên miền phụ (sau khi DNS đã trỏ về VPS):
certbot --nginx -d soangiaoan.nguyenvanquan.io.vn
```

Sao lưu định kỳ: copy `data/db.json` ra chỗ khác
(`cp data/db.json /root/backup-soangiaoan-$(date +%F).json`).

## DNS trên Tenten — cần đổi (chưa làm trong lần bàn giao này)

**Chưa sửa DNS Tenten.** Tùy phương án đã chọn mà làm một trong hai cách sau
(không làm cả hai cùng lúc):

- **Phương án miễn phí (Render/PaaS):** XÓA bản ghi REDIRECT tên `soangiaoan`,
  THÊM bản ghi CNAME tên `soangiaoan` trỏ về tên máy chủ đích của nền tảng,
  và thêm bản ghi TXT xác minh nếu nền tảng yêu cầu — giống mẫu CNAME + TXT
  của `game.nguyenvanquan.io.vn`.
- **Phương án VPS trả phí:** khi VPS đã chạy và Nginx đã sẵn sàng, XÓA bản ghi
  REDIRECT tên `soangiaoan`, THÊM bản ghi A tên `soangiaoan` trỏ về IP của VPS.
  (Nếu nhà hosting yêu cầu CNAME thì làm theo yêu cầu của họ thay vì bản ghi A.)

**Giữ nguyên 6 bản ghi ebook/game** (CNAME + TXT xác minh của ebook và game),
không sửa, không xóa. Chờ lan truyền DNS rồi mở
`https://soangiaoan.nguyenvanquan.io.vn` để kiểm tra.

## Giới hạn cần biết trước khi mở cho giáo viên

- Bản này định danh khách dùng thử bằng cookie trình duyệt: cùng một trình
  duyệt là cùng một “khách”. Đây là cơ chế dùng thử, chưa phải hệ thống tài
  khoản đăng nhập email/mật khẩu đầy đủ cho hàng nghìn giáo viên.
- Chưa có thanh toán trong app (đúng thiết kế: gói trả phí ghi “Liên hệ”).
- Nếu giáo viên xóa cookie trình duyệt, bộ đếm 3 giáo án của trình duyệt đó
  sẽ bắt đầu lại — đây là giới hạn của cơ chế dùng thử bằng cookie, cần nâng
  cấp lên tài khoản đăng nhập nếu muốn chặn chặt hơn.
