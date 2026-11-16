# SEAZEN VMS v2.0 — Hệ Thống Kiểm Soát Ra Vào & Sinh Trắc Học Khuôn Mặt

Hệ thống điều hành kiểm soát cửa ra vào, quản lý danh bạ sinh trắc học khuôn mặt, tiếp đón khách/nhà thầu và chấm công tự động của **SeaZen Security Corporation**. Giao tiếp trực tiếp với 4 thiết bị **ZKTeco SenseFace 4A** qua giao thức TCP Socket (cổng `4370`), lưu trữ trên **Microsoft SQL Server (`SeaZen_AccessControl` - 18 bảng)** và đồng bộ đám mây lên **SharePoint Online Lists (`VMS SEAZEN - ...`)** bằng OAuth2 Bearer Token.

---

## 1. Cấu Trúc Thư Mục & Danh Mục File Đang Sử Dụng

Toàn bộ các tệp nháp, kịch bản cũ gây văng tài khoản lễ tân và giao diện tĩnh thế hệ cũ đã được loại bỏ. Dự án chỉ giữ lại các module cốt lõi đang vận hành:

```text
QuanLyRaVao-Seazen/
├── .gitignore                   # Quy tắc loại trừ bộ đệm Python, node_modules và hồ sơ WebView tạm
├── CHAY_HE_THONG_CUA.bat        # Cổng khởi chạy 1-Click (Chọn chế độ Desktop WebView2 hoặc DevTest Browser)
├── launcher.py                  # Bộ khởi chạy kép + Đối soát Giờ chuẩn NTP Việt Nam (UTC+7) khi mở ứng dụng
├── app.py                       # Máy chủ Backend REST API chính (Waitress 16 luồng, cổng 6868)
├── config.json                  # Cấu hình 4 máy ZKTeco SenseFace 4A, SQL Server và SharePoint OAuth2
├── requirements.txt             # Danh sách thư viện Python tiêu chuẩn
├── README.md                    # Tài liệu kiến trúc và danh mục file hệ thống
│
├── zk_direct_client.py          # Driver điều khiển trực tiếp 4 máy ZKTeco (TCP 4370) + Khóa an toàn giờ NTP 2 lớp
├── db_mssql.py                  # Tầng truy xuất CSDL Microsoft SQL Server (CRUD 18 bảng SeaZen_AccessControl)
├── storage.py                   # Tầng lưu trữ Hybrid (SQL Server + JSON cục bộ dự phòng + Xuất báo cáo Excel)
├── sync_safe_database.py        # Công cụ đồng bộ ngầm an toàn (Stateless ServiceId=1 ePAD + ZKTeco Read-Only)
├── sharepoint_vms_sync.py       # Tạo và đồng bộ 18 SharePoint Lists "VMS SEAZEN - (Tên bảng)" qua OAuth2 Bearer Token
├── epad_client.py               # Cầu nối tương thích giao thức API ePAD
│
├── database_schema.sql          # Script T-SQL khởi tạo 18 bảng chuẩn hóa (Idempotent, bảo toàn 100% dữ liệu)
├── seed_data_export.sql         # Dữ liệu gốc trích xuất từ hệ thống (Nhân sự, Phòng ban, Lịch sử quét, Khách)
├── generate_sql_data_seed.py    # Công cụ kết xuất dữ liệu sang tập lệnh SQL
│
├── data/                        # Kho dữ liệu JSON cục bộ & bộ đệm đồng bộ thời gian thực
│   ├── active_visitors.json     # Khách đang giữ thẻ RFID trong tòa nhà
│   ├── daily_scans.json         # Bộ đệm sự kiện quét mặt/thẻ theo ngày
│   ├── departments.json         # Danh mục phòng ban
│   ├── door_actions.json        # Nhật ký kích mở/khóa rơ-le cửa
│   ├── employees.json           # Danh bạ nhân sự
│   ├── users.json               # Tài khoản vận hành phần mềm (RBAC)
│   └── visitor_history.json     # Lịch sử khách đã check-out
│
└── ui/
    └── frontend/                # Ứng dụng Giao diện React 18 + Vite + TailwindCSS
        ├── package.json
        ├── vite.config.js
        ├── tailwind.config.js
        ├── postcss.config.js
        ├── index.html
        ├── src/
        │   ├── main.jsx
        │   ├── index.css
        │   └── App.jsx          # 6 Phân hệ Nghiệp vụ + Đầy đủ Form Input + Khóa Giờ NTP 2 Lớp
        └── dist/                # Bản biên dịch Production phục vụ trực tiếp tại cổng 6868
```

---

## 2. Danh Sách 18 Bảng SQL Server (`SeaZen_AccessControl`) & SharePoint Lists (`VMS SEAZEN - ...`)

| STT | Tên Bảng SQL Server | Tên SharePoint List (`/sites/ONESEAZEN`) | Chức Năng Nghiệp Vụ |
| :-: | :--- | :--- | :--- |
| 1 | `tbl_Departments` | `VMS SEAZEN - PHÒNG BAN` | Cơ cấu phòng ban đa cấp |
| 2 | `tbl_Employees` | `VMS SEAZEN - DANH BẠ NHÂN SỰ` | Hồ sơ 1.225 nhân sự, mã chấm công ATID và số thẻ RFID |
| 3 | `tbl_EmployeeBiometrics` | `VMS SEAZEN - SINH TRẮC HỌC` | Vector khuôn mặt (`BIODATA`), ảnh chân dung (`BIOPHOTO`), vân tay |
| 4 | `tbl_Doors` | `VMS SEAZEN - DANH MỤC CỬA` | Cấu hình Cửa Làn VÀO (Door 1) và Cửa Làn RA (Door 2) |
| 5 | `tbl_Devices` | `VMS SEAZEN - THIẾT BỊ QUÉT MẶT` | 4 máy ZKTeco SenseFace 4A (`172.16.56.136` – `172.16.56.139`) |
| 6 | `tbl_AccessTimezones` | `VMS SEAZEN - KHUNG GIỜ MỞ CỬA` | Khung giờ được phép mở cửa từ Thứ 2 đến Chủ Nhật và Ngày lễ |
| 7 | `tbl_AccessGroups` | `VMS SEAZEN - NHÓM PHÂN QUYỀN CỬA` | Nhóm phân quyền kết hợp Cửa + Khung giờ + Phương thức xác thực |
| 8 | `tbl_DepartmentAccessGroups` | `VMS SEAZEN - PHÂN QUYỀN PHÒNG BAN` | Ánh xạ phân quyền Phòng ban vào Nhóm quyền cửa |
| 9 | `tbl_CustomerCards` | `VMS SEAZEN - KHO THẺ KHÁCH` | Kho thẻ từ RFID cấp phát tạm thời cho khách và nhà thầu |
| 10 | `tbl_Visitors` | `VMS SEAZEN - KHÁCH RA VÀO` | Hồ sơ khách liên hệ công tác, quét QR CCCD và cấp/thu hồi thẻ |
| 11 | `tbl_PreRegisteredGuests` | `VMS SEAZEN - ĐĂNG KÝ HẸN KHÁCH` | Danh sách khách được đăng ký hẹn trước |
| 12 | `tbl_Contractors` | `VMS SEAZEN - NHÀ THẦU THI CÔNG` | Quản lý công nhân, kỹ sư nhà thầu thi công theo thời hạn |
| 13 | `tbl_AttendanceLogs` | `VMS SEAZEN - NHẬT KÝ QUẸT THẺ` | Nhật ký quét khuôn mặt, thẻ từ và vân tay thời gian thực |
| 14 | `tbl_Shifts` | `VMS SEAZEN - CA LÀM VIỆC` | Danh mục ca làm việc hành chính và ca trực an ninh |
| 15 | `tbl_DailyTimekeeping` | `VMS SEAZEN - TỔNG HỢP CHẤM CÔNG` | Tổng hợp Giờ Vào Đầu Tiên, Giờ Ra Cuối Cùng, Đi Trễ, Giờ Công |
| 16 | `tbl_DeviceCommands` | `VMS SEAZEN - LỆNH THIẾT BỊ` | Hàng đợi lệnh điều khiển và đồng bộ phần cứng ZKTeco |
| 17 | `tbl_DoorAuditLogs` | `VMS SEAZEN - NHẬT KÝ ĐÓNG MỞ CỬA` | Nhật ký kiểm toán thao tác mở/khóa cửa từ xa |
| 18 | `tbl_ClockSyncAuditLogs` | `VMS SEAZEN - NHẬT KÝ ĐỐI SOÁT GIỜ NTP` | Nhật ký đối soát Giờ chuẩn Việt Nam (`NTP UTC+7`) và xác nhận 2 lớp |

---

## 3. Quy Tắc An Toàn Cốt Lõi

1. **Bảo toàn dữ liệu tuyệt đối (Zero Data Loss)**: Toàn bộ các tập lệnh SQL và tiến trình đồng bộ chỉ thực hiện thêm mới hoặc cập nhật (`UPSERT`), không bao giờ xóa dữ liệu gốc trên SQL Server hay trên 4 máy ZKTeco.
2. **Bảo vệ đồng hồ phần cứng trước rủi ro lệch giờ máy trạm (Anti-Clock-Drift 2 Lớp)**:
   - Hệ thống đối soát trực tiếp với cụm máy chủ **NTP Quốc tế (`time.google.com`, `vn.pool.ntp.org` - Múi giờ Việt Nam `UTC+7`)**.
   - Tuyệt đối không tự động lấy giờ cục bộ của máy tính mở App để ghi đè xuống 4 máy ZKTeco.
   - Mọi thao tác đồng bộ giờ cho ZKTeco bắt buộc qua **2 lớp xác nhận (`CONFIRM_VN_NTP_SYNC`)** và chỉ sử dụng nguồn giờ chuẩn `NTP UTC+7`.
3. **Xác thực OAuth2 Bearer Token (Không dùng Cookie)**: Mọi kết nối tới SharePoint Online đều sử dụng Azure App Registration `SEAZENHR-PORTAL` (`0390280b-12b8-49c4-adbf-a9c2b8bccfb5`).

---

## 4. Hướng Dẫn Khởi Chạy & Phát Triển

### Khởi chạy ứng dụng
Chạy tệp [`CHAY_HE_THONG_CUA.bat`](CHAY_HE_THONG_CUA.bat) hoặc dùng dòng lệnh:
- **Chế độ cửa sổ Desktop WebView2 (Mặc định)**:
  ```powershell
  python launcher.py
  ```
- **Chế độ Kiểm thử trên Trình duyệt (DevTest Mode)**:
  ```powershell
  python launcher.py --devtest
  ```

### Biên dịch lại Giao diện React + Vite sau khi chỉnh sửa UI
```powershell
npm --prefix ui/frontend run build
```
