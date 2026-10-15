# WEDDONG QUIZ V2 — HƯỚNG DẪN THỬ NGHIỆM

Phiên bản chỉnh trực tiếp từ file `WEDDONG_LOBBY_STT_NAME_FIXED.zip` người dùng cung cấp.
Giữ nguyên 12 phím ESP32, STT, MQTT, sảnh, PHÁT/CHỐT và phần quản lý lớp; sửa nghiệp vụ chấm điểm và layout.

## 1. Kết cấu gói

- `My_projectDONG/Backend/server.js`: API, MySQL, Socket.IO và MQTT mới.
- `My_projectDONG/Backend/test_flow.js`: test logic tự chạy, không dùng DB/MQTT bên ngoài.
- `My_projectDONG/Backend/.env.example`: mẫu biến môi trường (không chứa mật khẩu thật).
- `My_projectDONG/frontend/frontend/src`: frontend React mới.
- `My_projectDONG/ESP32/esp32_quiz_pcb_led_round/esp32_quiz_pcb_led_round.ino`: code Arduino chính thức; chỉ 1 .ino trong thư mục sketch.
- `My_projectDONG/DU_LIEU_MAU`: 3 file TXT để thử nhập danh sách lớp/đề/mapping.

## 2. Cài đặt MySQL / Clever Cloud

Backend dùng database MySQL như bản cũ nhưng KHÔNG gắn mật khẩu vào source.

```bash
cd My_projectDONG/Backend
cp .env.example .env
nano .env
```

Điền DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME **của chính bạn**.
Với Clever Cloud, lấy thông tin trong Dashboard của cơ sở dữ liệu. Không chia sẻ file `.env`.
Giữ `DB_POOL_LIMIT=2` vì database cũ từng báo giới hạn 5 kết nối.

Ở máy local, đổi `ADMIN_PASSWORD` thành mật khẩu quản trị muốn dùng. Với môi trường triển khai thật, phải đặt cả `ADMIN_PASSWORD` và `ADMIN_TOKEN_SECRET` đủ mạnh; `openssl rand -hex 32` tạo chuỗi ngẫu nhiên cho secret.

Backend tự tạo hai bảng mới `quiz_live_rounds`, `quiz_responses` và bảng `quiz_locked_questions`, không xóa 6 bảng cũ khi khởi động. **Sao lưu database trước khi nhập dữ liệu mẫu**, vì thao tác Sổ Đầu Bài hiện dùng danh sách lớp gốc dùng chung và thay thế danh sách hiện tại.

## 3. Chạy Backend

```bash
cd My_projectDONG/Backend
npm ci
npm test
npm start
```

Khi thành công, terminal báo `Đã kiểm tra schema MySQL`, `Backend cổng 3000`, `MQTT đã đăng ký submit/checkin`.
Kiểm tra `http://localhost:3000/api/health`. Nếu bị `max_user_connections`, đóng các backend khác đang dùng cùng tài khoản MySQL (Clever Cloud không phải MariaDB localhost).

## 4. Chạy web

Terminal mới:

```bash
cd My_projectDONG/frontend/frontend
npm ci
npm run dev
```

Mở địa chỉ Vite (thường là `http://localhost:5173`, đôi khi 5174):
- `/admin`: quản lý; đăng nhập bằng mật khẩu đặt trong `Backend/.env`. Nếu biến không cấu hình, bản chạy local demo có mặc định `123`.
- `/screen`: sảnh chờ và chiếu câu hỏi.
- `/play`: giao diện học sinh web, đăng nhập PIN và STT.

Mặc định frontend local kết nối backend qua `http://<địa-chỉ-máy-đang-mở>:3000`.

## 5. Nạp dữ liệu mẫu (được tạo mới, tất cả tên/ngày sinh là HƯ CẤU)

1. Vào `/admin` -> `TẠO MỚI`, tên: **RTOS - LOP TEST**, PIN: **RTOS26**. Lớp mới được chọn tự động.
2. Bấm **Sổ Đầu Bài**, chọn `DU_LIEU_MAU/01_DANH_SACH_LOP_MAU.txt`, bấm **LƯU TÀI LIỆU**. CẢNH BÁO: thay thế danh sách học sinh gốc hiện có.
3. Bấm **Nạp câu hỏi**, chọn `DU_LIEU_MAU/02_DE_MAU_RTOS_10_CAU.txt`, bấm **LƯU TÀI LIỆU**. CẢNH BÁO: xóa và thay bộ đề cùng lịch sử kết quả của lớp đang chọn.
4. **Không bắt buộc** nạp `03_GHEP_THIET_BI_TUY_CHON.txt`: backend tra thẳng STT qua `class_students`. Chỉ dùng mapping khi cần.
5. Mở `/screen?pin=RTOS26` và nạp code ESP32 mới.

## 6. ESP32 / PCB

Arduino IDE chọn `ESP32 Dev Module`, cổng đúng máy, Serial 115200. Dùng thư viện PubSubClient.
Sửa Wi-Fi SSID/mật khẩu đầu sketch cho khớp điểm truy cập Internet của lớp.

| Phím | GPIO | Khi nhập STT | Khi làm bài |
|---|---:|---|---|
| 1 | 16 | 1 | A |
| 2 | 23 | 2 | B |
| 3 | 26 | 3 | C |
| 4 | 17 | 4 | D |
| 5 | 25 | 5 | — |
| 6 | 27 | 6 | — |
| 7 | 18 | 7 | — |
| 8 | 33 | 8 | — |
| 9 | 14 | 9 | — |
| `*` RESET | 19 | Xóa STT | Trở về nhập STT |
| 0 | 32 | 0 | — |
| `#` ENTER | 13 | Xác nhận STT | Gửi đáp án |
| LED | 21 | — | Báo trạng thái |

Đèn LED active-HIGH (sáng ở GPIO21 HIGH). Nếu mạch LED của PCB dùng active-LOW thì đảo mức.

## 7. Trình tự kiểm tra chính xác

1. ESP32 nhập `1` -> ENTER. Sảnh sẽ hiện `STT 1 | Nguyễn Minh Anh | 14/08/2005` trên một dòng ngang. Nhập `11`, `12` tương tự.
2. Khi đang nhập STT, LED đổi trạng thái mỗi **1000ms**.
3. Giáo viên chọn **Câu 1** và nhấn **PHÁT**; LED đổi trạng thái mỗi **200ms**.
4. ESP32 nhấn `1` (=A) -> ENTER. Backend chỉ lưu **đáp án tạm A**; không tính điểm, không trả đúng/sai.
5. ESP32 nhấn `2` (=B) -> ENTER lần nữa. Backend **ghi đè đáp án A bằng B**; trước CHỐT chưa cộng điểm.
6. Giáo viên bấm **CHỐT**. Backend khóa câu 1 và so khớp **đáp án cuối B** với đáp án đúng B; admin được cộng 1 câu đúng.
7. Nếu ESP32 gửi tiếp sau CHỐT, backend từ chối. Giáo viên mới được **PHÁT Câu 2**; LED trở về chớp 200ms. Học sinh trả lời câu 2, LED sáng liên tục khi backend xác nhận đã lưu.
8. RESET vật lý gửi `"left"`; tên thiết bị biến khỏi sảnh chờ.

Các bảng điểm trong admin chỉ hiển thị câu đã CHỐT. Số "đáp án tạm" được thống kê riêng, không tính điểm.

## 8. Deploy Netlify / Render — QUAN TRỌNG

Backend trên Render phải được cập nhật **cùng phiên bản** với frontend mới. Trong Render Environment khai báo DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT, MQTT_URL, ADMIN_PASSWORD, ADMIN_TOKEN_SECRET và PORT theo Render.

Trên Netlify, Build command `npm run build`, base directory `My_projectDONG/frontend/frontend` nếu upload cả repo; publish directory `dist`. Đặt environment `VITE_API_URL=https://<TÊN_BACKEND_RENDER_CỦA_BẠN>.onrender.com` (địa chỉ HTTPS thật, KHÔNG có dấu `/` cuối). Sau khi đổi biến phải rebuild frontend.

**Không chạy đồng thời backend local và backend Render trên cùng prefix MQTT `lagan50ki/quiz`** khi kiểm tra; cả hai sẽ nhận cùng message, gây trả lời và kết quả chồng chéo. Dùng một backend hoặc đổi MQTT_PREFIX **và các topic ESP32** đồng bộ trong môi trường test khác.

## 9. Giới hạn / cần làm trước kỳ thi thực tế

- Logic submit/CHỐT đã qua test mock tự động và frontend build thành công, nhưng chưa được kiểm tra trên MySQL/Clever Cloud thật, thiết bị ESP32 thật và Render/Netlify đang chạy của bạn.
- Public broker MQTT không có xác thực thiết bị; người khác biết topic có thể giả mạo `device_id`. Muốn thi thật cần MQTT riêng/TLS và định danh, xác thực cho từng thiết bị.
- Sổ đầu bài `class_students` hiện là danh sách gốc dùng chung cho các phòng; muốn nhiều lớp độc lập cần đổi database theo `session_id`.
- Mỗi thời điểm backend nhận **một câu đang PHÁT** trên hệ thống MQTT, không nên tổ chức nhiều phòng độc lập đồng thời với một prefix.
- Backend dùng mật khẩu admin và token để khóa API đề và thao tác quản trị, nhưng STT từ client vẫn có thể bị giả mạo; đây là bản kiểm thử trước triển khai thi thật.
- Bộ điểm lịch sử cũ trong bảng `answers` được giữ nguyên, nhưng màn hình tiến độ V2 chỉ đọc bảng mới `quiz_responses` đã CHỐT để không tính nhầm các đáp án cũ từng được chấm quá sớm. Dùng `Xóa trắng kết quả` nếu muốn làm lại đề từ đầu.

**Quy tắc cốt lõi: Lưu lần gửi cuối cho mỗi (phòng, câu, nguồn, STT). CHỐT mới khóa và tính đúng/sai.**
