# HỆ THỐNG QUẢN LÝ ĐĂNG KÝ KHÁCH & GIÁM SÁT RA VÀO VĂN PHÒNG SEAZEN

Hệ thống ứng dụng Web độc lập, tinh gọn, hiệu năng cao giúp bảo vệ và ban quản lý SeaZen:
- **Đăng ký khách nhanh siêu tốc bằng cách quét mã QR Căn Cước Công Dân (CCCD gắn chip)**.
- **Tự động phân loại luồng ra vào**: Quét khuôn mặt (**FaceTemplate**) = 🏢 **Nhân viên văn phòng**, Quét thẻ RFID (**Card**) = 🎫 **Khách đến**.
- **Dashboard biểu đồ phân tích lưu lượng theo giờ (07:00 - 19:00) & cơ cấu đối tượng (Chart.js)**.
- **Check-out nhanh 1-chạm hoặc quét lại CCCD / thẻ từ**.
- **In phiếu khách / tem đeo tạm thời (khổ nhiệt 80mm hoặc decal)**.
- **Cảnh báo tự động khách quá giờ lưu trú (> 4 tiếng)**.
- **Xuất báo cáo Excel chi tiết (.xlsx) & Sẵn sàng đồng bộ SharePoint Online**.

---

## 1. TỔNG QUAN HỆ THỐNG

- **Mô hình**: Hybrid Client - ePAD Backend (`http://172.16.56.2:4001/api`).
- **Cổng Web ứng dụng**: `http://localhost:6868` (Chạy mượt mà, không xung đột cổng).
- **Phần cứng tích hợp**:
  - 4 máy chấm công nhận diện khuôn mặt **ZKTeco SenseFace 4A** (2 Làn Vào, 2 Làn Ra).
  - Máy quét mã vạch 2D cầm tay cổng USB (dùng quét mã QR trên thẻ CCCD).
  - Đầu đọc thẻ từ RFID cổng USB (tùy chọn cấp thẻ cho khách).

---

## 2. HƯỚNG DẪN KHỞI CHẠY (1-CLICK)

1. Mở thư mục: `d:\SeaZen APP\QuanLyRaVao-Seazen\`
2. Nhấp đúp chuột vào file: **`CHAY_HE_THONG_CUA.bat`**.
3. Ứng dụng tự động khởi động máy chủ và mở trình duyệt tại:
   ```
   http://localhost:6868
   ```

---

## 3. CÁC TÍNH NĂNG CHÍNH DÀNH CHO BẢO VỆ & QUẢN LÝ

### 3.1. Đăng Ký Khách Nhanh Bằng QR Căn Cước Công Dân (CCCD)
- **Chuẩn mã QR Bộ Công An**:
  `SốCCCD|SốCMNDCũ|HọVàTên|NgàySinh(DDMMYYYY)|GiớiTính|ĐịaChỉ|NgàyCấp`
- **Thao tác cực kỳ đơn giản**:
  1. Đặt thẻ CCCD của khách trước máy quét mã vạch 2D (hoặc dán chuỗi QR vào ô quét).
  2. Hệ thống tự động bóc tách và điền tức thì chỉ trong **0.05 giây**:
     - Số CCCD (12 chữ số) & Số CMND cũ
     - Họ và tên khách
     - Ngày sinh, Năm sinh & Giới tính
     - Địa chỉ thường trú
     - Ngày vào & Giờ vào (tự động lấy giờ hiện tại)
  3. **Cơ chế gợi ý nhanh (Autocomplete / Datalist)**:
     - Chọn nhanh đơn vị công ty (Viettel, VNPT, FPT, EVN, Grab, Ahamove, Shopee, Bưu điện...).
     - Chọn nhanh người tiếp đón & phòng ban (Vận hành, Kỹ thuật, Nhân sự, BGĐ, Kế toán, IT...).
     - Chọn mục đích đến (Giao dịch, Họp, Phỏng vấn, Thi công, Giao nhận...).
     - Nhập biển số xe (nếu có).
  4. Bấm **"Đăng Ký & Cho Vào"**: Hồ sơ được lưu ngay lập tức.
  5. Có nút **"In Phiếu"**: Mở mẫu thẻ khách 80mm có đầy đủ thông tin để in cho khách đeo.

> **Mẹo thử nghiệm nhanh**: Nhấn nút **"Test Thử Mẫu CCCD"** cạnh ô quét để hệ thống tự điền dữ liệu mẫu kiểm thử ngay mà không cần cầm thẻ thật!

### 3.2. Check-Out Siêu Tốc (Khách Rời Tòa Nhà)
- **Cách 1 (Quét lại CCCD / Thẻ)**: Khách ra về, bảo vệ chỉ cần quét lại mã QR CCCD hoặc quẹt thẻ vào ô "Check-out siêu tốc" -> Hệ thống tự động đóng hồ sơ.
- **Cách 2 (1-Click trên bảng)**: Nhấn nút **"Check-Out"** ngay trên dòng khách tương ứng.
- Hệ thống tự động ghi nhận **Giờ ra**, tính toán **Thời gian lưu lại** (ví dụ: `45 phút`, `1h 30m`) và chuyển vào Lịch sử.
- **Cảnh báo khách quá giờ (Overstay Alert)**: Khách lưu lại trên 4 tiếng sẽ tự động được tô đỏ và hiện icon cảnh báo ⚠️.

### 3.3. Dashboard Thống Kê & Biểu Đồ Giám Sát Văn Phòng (Chart.js)
- **4 Thẻ Chỉ Số KPI Đo Lường**:
  - 🏢 **Nhân Viên Văn Phòng Có Mặt**: Đếm số người nhận diện khuôn mặt hôm nay.
  - 🎫 **Lượt Khách Trong Ngày**: Tổng lượt đăng ký và khách quẹt thẻ.
  - 🟢 **Khách Đang Trong Văn Phòng**: Số khách đang có mặt chưa check-out.
  - ⚪ **Khách Đã Ra Về**: Số khách đã hoàn tất thủ tục check-out.
- **Biểu Đồ Phân Bổ Lưu Lượng Theo Khung Giờ (07:00 – 19:00)**:
  - Cột xanh lá: Nhân viên văn phòng (quét mặt).
  - Cột vàng cam: Khách đến (quẹt thẻ / đăng ký CCCD).
  - Giúp quản lý nắm rõ giờ cao điểm ra vào của công ty.
- **Biểu Đồ Donut Cơ Cấu & Top Phòng Ban Tiếp Khách**:
  - Tỷ lệ phần trăm giữa Nhân viên và Khách.
  - Thống kê các phòng ban tiếp đón khách nhiều nhất.

### 3.4. Giám Sát Ra Vào Trực Tiếp (SenseFace 4A Live Stream)
- Tự động phân loại theo thời gian thực:
  - 🏢 **Nhân Viên Văn Phòng**: Giao dịch nhận diện khuôn mặt (`FaceTemplate`).
  - 🎫 **Khách Đến**: Giao dịch quẹt thẻ RFID (`Card`).
- Bộ lọc danh mục: [Tất cả] [Chỉ Nhân Viên Văn Phòng] [Chỉ Khách Đến].

### 3.5. Xuất Báo Cáo Excel Đầy Đủ (.xlsx)
- Nhấn nút **"Xuất Báo Cáo Excel Đầy Đủ (.xlsx)"** tại tab Lịch Sử để tải về bảng thống kê chi tiết mọi lượt khách ra vào với đầy đủ số CCCD, Năm sinh, Giới tính, Đơn vị, Mục đích, Biển số xe, Giờ vào, Giờ ra, Thời gian lưu lại.

---

## 4. CÔNG CỤ QUẢN TRỊ 1-CLICK TIỆN ÍCH

### 4.1. Đổi Tài Khoản ePAD: `DOI_TAI_KHOAN_EPAD.bat`
- Khi tài khoản `Thuan.Trinh@seazen.com.vn` đổi mật khẩu hoặc bạn muốn chuyển tài khoản khác:
  1. Nhấp đúp vào **`DOI_TAI_KHOAN_EPAD.bat`**.
  2. Nhập Email và Mật khẩu mới (có dấu `*` bảo mật).
  3. Công cụ tự kiểm tra xác thực trước khi cập nhật `config.json`.

### 4.2. Đăng Nhập & Tạo Token SharePoint Online: `DANG_NHAP_SHAREPOINT.bat`
- Hoạt động tương tự cơ chế của Canteen Kiosk:
  1. Nhấp đúp vào **`DANG_NHAP_SHAREPOINT.bat`**.
  2. Đăng nhập bằng tài khoản Microsoft 365 (hoặc Device Code MFA).
  3. File `token_cache.bin` tự động được sinh và làm mới.
  4. Hệ thống đã có sẵn toàn bộ hàm đồng bộ hồ sơ khách (Họ tên, CCCD, Năm sinh, Giờ vào, Giờ ra...) lên danh sách SharePoint Online.


