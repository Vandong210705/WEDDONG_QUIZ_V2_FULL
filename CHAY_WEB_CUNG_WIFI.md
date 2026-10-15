# WEDDONG QUIZ V2 — chạy Web trên điện thoại cùng Wi-Fi

## 1. Chuẩn bị MySQL

Trong thư mục `Backend`, sao chép `.env.example` thành `.env`, rồi sửa `DB_PASSWORD` thành mật khẩu MySQL thực tế của `admin_quiz` và đặt `ADMIN_PASSWORD` theo nhu cầu. Không chia sẻ `.env` và không đưa file này lên GitHub.

```bash
cd Backend
cp -n .env.example .env
nano .env
npm install
npm start
```

Backend phải in `🚀 Backend cổng 3000`. Nếu lỗi `Access denied`, kiểm tra đúng tài khoản, mật khẩu và quyền MySQL; không cần thay mật khẩu tài khoản MySQL hiện có.

## 2. Chạy giao diện

Mở Terminal thứ hai:

```bash
cd frontend/frontend
npm install
npm run dev
```

Vite sẽ hiển thị địa chỉ Network. Tìm IP laptop bằng `hostname -I` hoặc `ip -4 addr show`.

Ví dụ IP laptop `192.168.1.105`: mở trên điện thoại `http://192.168.1.105:5173/admin`, `/play` hoặc `/screen`. **Thay IP ví dụ bằng IP thật.**

Giao diện tự gọi API và Socket.IO tại `http://<IP-laptop>:3000`; không phải sửa code mỗi khi đổi Wi-Fi. Backend lắng nghe `0.0.0.0:3000`, Vite lắng nghe `0.0.0.0:5173`.

## 3. Nếu điện thoại không vào được

- Laptop và điện thoại cùng Wi-Fi; tắt dữ liệu di động để thử. Wi-Fi khách (guest) hoặc AP isolation có thể chặn thiết bị kết nối nhau.
- Trên Ubuntu nếu UFW bật, cho phép LAN vào cổng 3000 và 5173. Ví dụ (thay subnet phù hợp): `sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp` và tương tự cổng 5173.
- Nếu giao diện mở nhưng báo mất kết nối, kiểm tra Backend còn chạy và file `.env.local` / `.env.production` có `VITE_API_URL` trỏ đến URL khác không. Khi chạy LAN, bỏ cấu hình ghi đè này.
- Nếu `npm start` lỗi MySQL, sửa `.env` và kiểm tra MariaDB đang chạy: `sudo systemctl status mariadb`.

**Lưu ý:** Đây là Web chạy cục bộ, laptop phải bật cả Backend, Frontend và MySQL. Không truy cập từ ngoài Wi-Fi. MQTT ESP32 vẫn cần Internet để kết nối broker công khai `broker.emqx.io`.
