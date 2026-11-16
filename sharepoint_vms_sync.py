"""
SharePoint Online List Provisioning & Synchronization Engine for SeaZen VMS
- Naming convention: "VMS SEAZEN - (Tên bảng)"
- Column display names: 100% Vietnamese
- Authentication: OAuth2 Bearer Token via Azure App Registration SEAZENHR-PORTAL
  (Client ID: 0390280b-12b8-49c4-adbf-a9c2b8bccfb5, Tenant: 29101901-3778-4339-827c-7d2b50914db0)
- Strictly adheres to no-cookies-auth.md and sharepoint-attachments.md.
"""

import os
import sys
import json
import zlib
import ctypes
import ctypes.wintypes
import logging
from typing import Dict, Any, List, Optional
import requests
import msal

import db_mssql

logger = logging.getLogger("sharepoint_vms")

TENANT_ID = "29101901-3778-4339-827c-7d2b50914db0"
CLIENT_ID = "0390280b-12b8-49c4-adbf-a9c2b8bccfb5"
SP_SITE_URL = "https://seazenvn.sharepoint.com/sites/ONESEAZEN"
GRAPH_SCOPES = ["https://graph.microsoft.com/.default"]
SP_SCOPES = ["https://seazenvn.sharepoint.com/.default"]

# Complete 18-Table VMS SEAZEN SharePoint List Schema (Vietnamese Column Names)
VMS_SHAREPOINT_LIST_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "tbl_Departments": {
        "list_title": "VMS SEAZEN - PHÒNG BAN",
        "description": "Cơ cấu phòng ban đa cấp của hệ thống Kiểm soát Ra Vào SeaZen (tbl_Departments)",
        "key_sql_col": "DepartmentID",
        "title_sql_col": "DepartmentCode",
        "columns": [
            {"internal": "MaPhongBan", "display": "Mã Phòng Ban", "type": "text", "sql": "DepartmentCode"},
            {"internal": "TenPhongBan", "display": "Tên Phòng Ban", "type": "text", "sql": "DepartmentName"},
            {"internal": "MaPhongBanCha", "display": "Mã Phòng Ban Cha", "type": "number", "sql": "ParentID"},
            {"internal": "CapBac", "display": "Cấp Bậc", "type": "number", "sql": "Level"},
            {"internal": "DiaDiem", "display": "Địa Điểm Làm Việc", "type": "text", "sql": "Location"},
            {"internal": "MoTa", "display": "Mô Tả", "type": "note", "sql": "Description"},
            {"internal": "TrangThaiHoatDong", "display": "Đang Hoạt Động", "type": "boolean", "sql": "IsActive"},
        ]
    },
    "tbl_Employees": {
        "list_title": "VMS SEAZEN - DANH BẠ NHÂN SỰ",
        "description": "Danh bạ nhân sự và mã chấm công ATID trên 4 máy ZKTeco SenseFace 4A (tbl_Employees)",
        "key_sql_col": "EmployeeATID",
        "title_sql_col": "EmployeeATID",
        "columns": [
            {"internal": "MaChamCongATID", "display": "Mã Chấm Công ATID", "type": "text", "sql": "EmployeeATID"},
            {"internal": "MaNhanVienHR", "display": "Mã Nhân Viên HR", "type": "text", "sql": "EmployeeCode"},
            {"internal": "HoVaTen", "display": "Họ Và Tên", "type": "text", "sql": "FullName"},
            {"internal": "PhongBan", "display": "Phòng Ban", "type": "text", "sql": "DepartmentName"},
            {"internal": "ChucVu", "display": "Chức Vụ", "type": "text", "sql": "Position"},
            {"internal": "MaTheTuRFID", "display": "Mã Thẻ Từ RFID", "type": "text", "sql": "CardNumber"},
            {"internal": "QuyenThietBi", "display": "Quyền Trên Thiết Bị", "type": "number", "sql": "Privilege"},
            {"internal": "Email", "display": "Email", "type": "text", "sql": "Email"},
            {"internal": "SoDienThoai", "display": "Số Điện Thoại", "type": "text", "sql": "Phone"},
            {"internal": "LaNhanVienChinhThuc", "display": "Là Nhân Viên Chính Thức", "type": "boolean", "sql": "IsStaff"},
            {"internal": "TrangThaiLamViec", "display": "Đang Làm Việc", "type": "boolean", "sql": "IsActive"},
        ]
    },
    "tbl_EmployeeBiometrics": {
        "list_title": "VMS SEAZEN - SINH TRẮC HỌC",
        "description": "Dữ liệu sinh trắc học khuôn mặt (BIODATA), ảnh chân dung (BIOPHOTO), vân tay và thẻ từ (tbl_EmployeeBiometrics)",
        "key_sql_col": "EmployeeATID",
        "title_sql_col": "EmployeeATID",
        "columns": [
            {"internal": "MaChamCongATID", "display": "Mã Chấm Công ATID", "type": "text", "sql": "EmployeeATID"},
            {"internal": "DaCoKhuonMat", "display": "Đã Có Khuôn Mặt", "type": "boolean", "sql": "HasFace"},
            {"internal": "DaCoTheTu", "display": "Đã Có Thẻ Từ", "type": "boolean", "sql": "HasCard"},
            {"internal": "DaCoVanTay", "display": "Đã Có Vân Tay", "type": "boolean", "sql": "HasFinger"},
            {"internal": "PhienBanThuatToan", "display": "Phiên Bản Thuật Toán Khuôn Mặt", "type": "text", "sql": "FaceVersion"},
            {"internal": "SoLuongVanTay", "display": "Số Lượng Vân Tay", "type": "number", "sql": "FingerCount"},
            {"internal": "LanDongBoCuoi", "display": "Lần Đồng Bộ Xuống Máy Cuối", "type": "text", "sql": "LastSyncedToDevices"},
        ]
    },
    "tbl_Doors": {
        "list_title": "VMS SEAZEN - DANH MỤC CỬA",
        "description": "Danh mục cửa kiểm soát Làn Vào và Làn Ra tại sảnh chính SeaZen (tbl_Doors)",
        "key_sql_col": "DoorID",
        "title_sql_col": "DoorCode",
        "columns": [
            {"internal": "MaCua", "display": "Mã Cửa", "type": "text", "sql": "DoorCode"},
            {"internal": "TenCua", "display": "Tên Cửa", "type": "text", "sql": "DoorName"},
            {"internal": "HuongDiChuyen", "display": "Hướng Di Chuyển", "type": "text", "sql": "Direction"},
            {"internal": "KhuVuc", "display": "Khu Vực", "type": "text", "sql": "AreaName"},
            {"internal": "SoGiayMoMacDinh", "display": "Số Giây Mở Mặc Định", "type": "number", "sql": "DefaultOpenSeconds"},
            {"internal": "TrangThaiHoatDong", "display": "Đang Hoạt Động", "type": "boolean", "sql": "IsActive"},
        ]
    },
    "tbl_Devices": {
        "list_title": "VMS SEAZEN - THIẾT BỊ QUÉT MẶT",
        "description": "Danh sách 4 máy quét khuôn mặt ZKTeco SenseFace 4A và trạng thái đồng hồ NTP (tbl_Devices)",
        "key_sql_col": "SerialNumber",
        "title_sql_col": "SerialNumber",
        "columns": [
            {"internal": "SoSerialMay", "display": "Số Serial Máy", "type": "text", "sql": "SerialNumber"},
            {"internal": "TenThietBi", "display": "Tên Thiết Bị", "type": "text", "sql": "DeviceName"},
            {"internal": "DiaChiIP", "display": "Địa Chỉ IP", "type": "text", "sql": "IPAddress"},
            {"internal": "CongTCP", "display": "Cổng TCP", "type": "number", "sql": "Port"},
            {"internal": "MaCua", "display": "Mã Cửa Gắn Kết", "type": "number", "sql": "DoorID"},
            {"internal": "DongMay", "display": "Dòng Máy Phần Cứng", "type": "text", "sql": "DeviceModel"},
            {"internal": "TongSoUser", "display": "Tổng Số User Trên Máy", "type": "number", "sql": "UserCount"},
            {"internal": "TongSoKhuonMat", "display": "Tổng Số Khuôn Mặt", "type": "number", "sql": "FaceCount"},
            {"internal": "TongSoLuotQuet", "display": "Tổng Số Lượt Quét Lưu Trữ", "type": "number", "sql": "LogCount"},
            {"internal": "GioTrenThietBi", "display": "Giờ Trên Thiết Bị", "type": "text", "sql": "DeviceClock"},
            {"internal": "DoLechGiayNTP", "display": "Độ Lệch So Với NTP Việt Nam (Giây)", "type": "number", "sql": "NtpDriftSeconds"},
            {"internal": "DangTrucTuyen", "display": "Đang Trực Tuyến", "type": "boolean", "sql": "IsOnline"},
        ]
    },
    "tbl_AccessTimezones": {
        "list_title": "VMS SEAZEN - KHUNG GIỜ MỞ CỬA",
        "description": "Cấu hình khung giờ được phép mở cửa từ Thứ 2 đến Chủ Nhật và Ngày lễ (tbl_AccessTimezones)",
        "key_sql_col": "TimezoneCode",
        "title_sql_col": "TimezoneCode",
        "columns": [
            {"internal": "MaKhungGio", "display": "Mã Khung Giờ", "type": "text", "sql": "TimezoneCode"},
            {"internal": "TenKhungGio", "display": "Tên Khung Giờ", "type": "text", "sql": "TimezoneName"},
            {"internal": "KhungGioThu2", "display": "Khung Giờ Thứ Hai", "type": "text", "sql": "MonTime"},
            {"internal": "KhungGioThu3", "display": "Khung Giờ Thứ Ba", "type": "text", "sql": "TueTime"},
            {"internal": "KhungGioThu4", "display": "Khung Giờ Thứ Tư", "type": "text", "sql": "WedTime"},
            {"internal": "KhungGioThu5", "display": "Khung Giờ Thứ Năm", "type": "text", "sql": "ThuTime"},
            {"internal": "KhungGioThu6", "display": "Khung Giờ Thứ Sáu", "type": "text", "sql": "FriTime"},
            {"internal": "KhungGioThu7", "display": "Khung Giờ Thứ Bảy", "type": "text", "sql": "SatTime"},
            {"internal": "KhungGioChuNhat", "display": "Khung Giờ Chủ Nhật", "type": "text", "sql": "SunTime"},
            {"internal": "KhungGioNgayLe", "display": "Khung Giờ Ngày Lễ", "type": "text", "sql": "HolidayTime"},
            {"internal": "MoTa", "display": "Mô Tả Chi Tiết", "type": "note", "sql": "Description"},
        ]
    },
    "tbl_AccessGroups": {
        "list_title": "VMS SEAZEN - NHÓM PHÂN QUYỀN CỬA",
        "description": "Nhóm phân quyền kết hợp Cửa được phép đi qua và Khung giờ hoạt động (tbl_AccessGroups)",
        "key_sql_col": "GroupCode",
        "title_sql_col": "GroupCode",
        "columns": [
            {"internal": "MaNhomQuyen", "display": "Mã Nhóm Quyền", "type": "text", "sql": "GroupCode"},
            {"internal": "TenNhomQuyen", "display": "Tên Nhóm Quyền", "type": "text", "sql": "GroupName"},
            {"internal": "MaKhungGio", "display": "Mã Khung Giờ Áp Dụng", "type": "number", "sql": "TimezoneID"},
            {"internal": "DanhSachCua", "display": "Danh Sách Cửa Cho Phép", "type": "text", "sql": "AllowedDoors"},
            {"internal": "PhuongThucXacThuc", "display": "Phương Thức Xác Thực", "type": "text", "sql": "VerifyMode"},
            {"internal": "MoTa", "display": "Mô Tả", "type": "note", "sql": "Description"},
        ]
    },
    "tbl_DepartmentAccessGroups": {
        "list_title": "VMS SEAZEN - PHÂN QUYỀN PHÒNG BAN",
        "description": "Ánh xạ phân quyền Phòng ban vào Nhóm quyền cửa kiểm soát (tbl_DepartmentAccessGroups)",
        "key_sql_col": "MappingID",
        "title_sql_col": "DepartmentName",
        "columns": [
            {"internal": "MaPhongBan", "display": "Mã Phòng Ban", "type": "number", "sql": "DepartmentID"},
            {"internal": "TenPhongBan", "display": "Tên Phòng Ban", "type": "text", "sql": "DepartmentName"},
            {"internal": "MaNhomQuyen", "display": "Mã Nhóm Quyền", "type": "number", "sql": "GroupID"},
            {"internal": "TenNhomQuyen", "display": "Tên Nhóm Quyền Cửa", "type": "text", "sql": "GroupName"},
            {"internal": "NguoiCapNhat", "display": "Người Cập Nhật", "type": "text", "sql": "UpdatedBy"},
        ]
    },
    "tbl_CustomerCards": {
        "list_title": "VMS SEAZEN - KHO THẺ KHÁCH",
        "description": "Kho thẻ từ RFID dùng để cấp phát tạm thời cho khách và nhà thầu (tbl_CustomerCards)",
        "key_sql_col": "CardNumber",
        "title_sql_col": "CardCode",
        "columns": [
            {"internal": "MaDinhDanhThe", "display": "Mã Định Danh Thẻ", "type": "text", "sql": "CardCode"},
            {"internal": "SoTheRFID", "display": "Số Thẻ Từ RFID", "type": "text", "sql": "CardNumber"},
            {"internal": "LoaiThe", "display": "Loại Thẻ", "type": "text", "sql": "CardType"},
            {"internal": "TrangThaiThe", "display": "Trạng Thái Thẻ", "type": "text", "sql": "Status"},
            {"internal": "NguoiDangGiuThe", "display": "Người Đang Giữ Thẻ", "type": "text", "sql": "CurrentHolderName"},
            {"internal": "SoCCCDNguoiGiu", "display": "Số CCCD Người Giữ", "type": "text", "sql": "CurrentHolderCCCD"},
            {"internal": "GhiChu", "display": "Ghi Chú", "type": "note", "sql": "Notes"},
        ]
    },
    "tbl_Visitors": {
        "list_title": "VMS SEAZEN - KHÁCH RA VÀO",
        "description": "Hồ sơ khách đến liên hệ công tác, quét QR CCCD và cấp thẻ tạm (tbl_Visitors)",
        "key_sql_col": "VisitorID",
        "title_sql_col": "VisitorID",
        "columns": [
            {"internal": "MaHoSoKhach", "display": "Mã Hồ Sơ Khách", "type": "text", "sql": "VisitorID"},
            {"internal": "HoVaTenKhach", "display": "Họ Và Tên Khách", "type": "text", "sql": "FullName"},
            {"internal": "SoCCCD", "display": "Số CCCD / CMND", "type": "text", "sql": "CCCDNumber"},
            {"internal": "SoTheRFID", "display": "Số Thẻ Từ Tạm Cấp", "type": "text", "sql": "CardNumber"},
            {"internal": "SoDienThoai", "display": "Số Điện Thoại", "type": "text", "sql": "Phone"},
            {"internal": "DonViCongTac", "display": "Đơn Vị / Công Ty Khách", "type": "text", "sql": "Company"},
            {"internal": "PhongBanLienHe", "display": "Phòng Ban Liên Hệ", "type": "text", "sql": "Department"},
            {"internal": "NguoiTiepDon", "display": "Người Tiếp Đón Bảo Lãnh", "type": "text", "sql": "HostPerson"},
            {"internal": "MucDich", "display": "Mục Đích Làm Việc", "type": "note", "sql": "Purpose"},
            {"internal": "GioVao", "display": "Thời Gian Vào", "type": "text", "sql": "CheckinTime"},
            {"internal": "GioRa", "display": "Thời Gian Ra", "type": "text", "sql": "CheckoutTime"},
            {"internal": "TrangThai", "display": "Trạng Thái Hiện Tại", "type": "text", "sql": "Status"},
            {"internal": "NhanVienTiepDon", "display": "Lễ Tân Thực Hiện", "type": "text", "sql": "Operator"},
        ]
    },
    "tbl_PreRegisteredGuests": {
        "list_title": "VMS SEAZEN - ĐĂNG KÝ HẸN KHÁCH",
        "description": "Danh sách khách được cán bộ nhân viên đăng ký hẹn trước (tbl_PreRegisteredGuests)",
        "key_sql_col": "BookingCode",
        "title_sql_col": "BookingCode",
        "columns": [
            {"internal": "MaLichHen", "display": "Mã Lịch Hẹn", "type": "text", "sql": "BookingCode"},
            {"internal": "HoVaTenKhach", "display": "Họ Và Tên Khách", "type": "text", "sql": "GuestFullName"},
            {"internal": "SoCCCD", "display": "Số CCCD Khách", "type": "text", "sql": "GuestCCCD"},
            {"internal": "SoDienThoai", "display": "Số Điện Thoại Khách", "type": "text", "sql": "GuestPhone"},
            {"internal": "DonViKhach", "display": "Đơn Vị Khách", "type": "text", "sql": "GuestCompany"},
            {"internal": "NguoiBaoLanh", "display": "Cán Bộ Bảo Lãnh", "type": "text", "sql": "HostEmployeeName"},
            {"internal": "PhongBan", "display": "Phòng Ban Bảo Lãnh", "type": "text", "sql": "HostDepartment"},
            {"internal": "NgayHen", "display": "Ngày Hẹn Đến", "type": "text", "sql": "VisitDate"},
            {"internal": "GioBatDau", "display": "Giờ Bắt Đầu", "type": "text", "sql": "StartTime"},
            {"internal": "GioKetThuc", "display": "Giờ Kết Thúc", "type": "text", "sql": "EndTime"},
            {"internal": "MucDich", "display": "Nội Dung Làm Việc", "type": "note", "sql": "Purpose"},
            {"internal": "TrangThai", "display": "Trạng Thái Lịch Hẹn", "type": "text", "sql": "Status"},
        ]
    },
    "tbl_Contractors": {
        "list_title": "VMS SEAZEN - NHÀ THẦU THI CÔNG",
        "description": "Quản lý công nhân, kỹ sư nhà thầu ra vào thi công bảo trì dài ngày (tbl_Contractors)",
        "key_sql_col": "ContractorCode",
        "title_sql_col": "ContractorCode",
        "columns": [
            {"internal": "MaNhaThau", "display": "Mã Hồ Sơ Nhà Thầu", "type": "text", "sql": "ContractorCode"},
            {"internal": "DonViNhaThau", "display": "Tên Công Ty Nhà Thầu", "type": "text", "sql": "ContractorCompany"},
            {"internal": "HoTenNhanSu", "display": "Họ Tên Nhân Sự Thi Công", "type": "text", "sql": "WorkerFullName"},
            {"internal": "SoCCCD", "display": "Số CCCD", "type": "text", "sql": "CCCDNumber"},
            {"internal": "SoDienThoai", "display": "Số Điện Thoại", "type": "text", "sql": "Phone"},
            {"internal": "SoTheRFID", "display": "Số Thẻ Từ Cấp Phát", "type": "text", "sql": "CardNumber"},
            {"internal": "KhuVucThiCong", "display": "Khu Vực Thi Công", "type": "text", "sql": "WorkArea"},
            {"internal": "NguoiGiamSat", "display": "Cán Bộ Giám Sát", "type": "text", "sql": "SupervisorName"},
            {"internal": "HieuLucTuNgay", "display": "Hiệu Lực Từ Ngày", "type": "text", "sql": "ValidFrom"},
            {"internal": "HieuLucDenNgay", "display": "Hiệu Lực Đến Ngày", "type": "text", "sql": "ValidTo"},
            {"internal": "TrangThai", "display": "Trạng Thái", "type": "text", "sql": "Status"},
        ]
    },
    "tbl_AttendanceLogs": {
        "list_title": "VMS SEAZEN - NHẬT KÝ QUẸT THẺ",
        "description": "Nhật ký quét khuôn mặt, thẻ từ và vân tay thời gian thực từ 4 máy ZKTeco SenseFace 4A (tbl_AttendanceLogs)",
        "key_sql_col": "LogID",
        "title_sql_col": "EmployeeATID",
        "columns": [
            {"internal": "MaChamCongATID", "display": "Mã Chấm Công ATID", "type": "text", "sql": "EmployeeATID"},
            {"internal": "HoVaTen", "display": "Họ Và Tên", "type": "text", "sql": "FullName"},
            {"internal": "PhongBan", "display": "Phòng Ban", "type": "text", "sql": "Department"},
            {"internal": "SerialThietBi", "display": "Serial Thiết Bị", "type": "text", "sql": "DeviceSerialNumber"},
            {"internal": "TenThietBiCua", "display": "Tên Thiết Bị Cửa", "type": "text", "sql": "DeviceName"},
            {"internal": "ThoiGianQuet", "display": "Thời Gian Quét", "type": "text", "sql": "CheckTime"},
            {"internal": "PhuongThucXacThuc", "display": "Phương Thức Xác Thực", "type": "text", "sql": "VerifyMode"},
            {"internal": "LaNhanVien", "display": "Là Nhân Viên Nội Bộ", "type": "boolean", "sql": "IsStaff"},
            {"internal": "NguonDongBo", "display": "Nguồn Thu Thập", "type": "text", "sql": "SyncSource"},
        ]
    },
    "tbl_Shifts": {
        "list_title": "VMS SEAZEN - CA LÀM VIỆC",
        "description": "Danh mục ca làm việc hành chính và ca trực an ninh (tbl_Shifts)",
        "key_sql_col": "ShiftCode",
        "title_sql_col": "ShiftCode",
        "columns": [
            {"internal": "MaCaLamViec", "display": "Mã Ca Làm Việc", "type": "text", "sql": "ShiftCode"},
            {"internal": "TenCaLamViec", "display": "Tên Ca Làm Việc", "type": "text", "sql": "ShiftName"},
            {"internal": "GioBatDauCa", "display": "Giờ Bắt Đầu Ca", "type": "text", "sql": "CheckInTime"},
            {"internal": "GioKetThucCa", "display": "Giờ Kết Thúc Ca", "type": "text", "sql": "CheckOutTime"},
            {"internal": "BatDauNghiTrua", "display": "Bắt Đầu Nghỉ Trưa", "type": "text", "sql": "BreakStartTime"},
            {"internal": "KetThucNghiTrua", "display": "Kết Thúc Nghỉ Trưa", "type": "text", "sql": "BreakEndTime"},
            {"internal": "PhutChoPhepDiTre", "display": "Số Phút Cho Phép Đi Trễ", "type": "number", "sql": "GraceLateMinutes"},
            {"internal": "GioCongChuan", "display": "Giờ Công Chuẩn", "type": "number", "sql": "WorkingHours"},
        ]
    },
    "tbl_DailyTimekeeping": {
        "list_title": "VMS SEAZEN - TỔNG HỢP CHẤM CÔNG",
        "description": "Bảng tổng hợp giờ vào đầu tiên, giờ ra cuối cùng, phút đi trễ và giờ công hàng ngày (tbl_DailyTimekeeping)",
        "key_sql_col": "TimekeepingID",
        "title_sql_col": "EmployeeATID",
        "columns": [
            {"internal": "NgayLamViec", "display": "Ngày Làm Việc", "type": "text", "sql": "WorkDate"},
            {"internal": "MaChamCongATID", "display": "Mã Chấm Công ATID", "type": "text", "sql": "EmployeeATID"},
            {"internal": "HoVaTen", "display": "Họ Và Tên", "type": "text", "sql": "FullName"},
            {"internal": "PhongBan", "display": "Phòng Ban", "type": "text", "sql": "DepartmentName"},
            {"internal": "MaCa", "display": "Mã Ca Làm Việc", "type": "text", "sql": "ShiftCode"},
            {"internal": "GioVaoDauTien", "display": "Giờ Vào Đầu Tiên", "type": "text", "sql": "FirstInTime"},
            {"internal": "GioRaCuoiCung", "display": "Giờ Ra Cuối Cùng", "type": "text", "sql": "LastOutTime"},
            {"internal": "TongSoLanQuet", "display": "Tổng Số Lần Quét Trong Ngày", "type": "number", "sql": "TotalScans"},
            {"internal": "SoPhutDiTre", "display": "Số Phút Đi Trễ", "type": "number", "sql": "LateMinutes"},
            {"internal": "TongGioLamViec", "display": "Tổng Giờ Làm Việc", "type": "number", "sql": "TotalHours"},
            {"internal": "TrangThaiChamCong", "display": "Trạng Thái Chấm Công", "type": "text", "sql": "AttendanceStatus"},
        ]
    },
    "tbl_DeviceCommands": {
        "list_title": "VMS SEAZEN - LỆNH THIẾT BỊ",
        "description": "Hàng đợi lệnh điều khiển và đồng bộ phần cứng ZKTeco SenseFace 4A (tbl_DeviceCommands)",
        "key_sql_col": "CommandID",
        "title_sql_col": "CommandCode",
        "columns": [
            {"internal": "MaLenh", "display": "Mã Lệnh Thực Thi", "type": "text", "sql": "CommandCode"},
            {"internal": "SerialThietBiDich", "display": "Serial Thiết Bị Đích", "type": "text", "sql": "TargetSerial"},
            {"internal": "TenThietBiDich", "display": "Tên Thiết Bị Đích", "type": "text", "sql": "TargetDeviceName"},
            {"internal": "GiaoThucTruyen", "display": "Giao Thức Truyền", "type": "text", "sql": "Protocol"},
            {"internal": "TrangThaiLenh", "display": "Trạng Thái Lệnh", "type": "text", "sql": "Status"},
            {"internal": "KetQuaChiTiet", "display": "Kết Quả Chi Tiết", "type": "note", "sql": "ResultMessage"},
            {"internal": "NguoiYeuCau", "display": "Người Yêu Cầu", "type": "text", "sql": "RequestedBy"},
            {"internal": "ThoiGianThucThi", "display": "Thời Gian Thực Thi", "type": "text", "sql": "ExecutedAt"},
        ]
    },
    "tbl_DoorAuditLogs": {
        "list_title": "VMS SEAZEN - NHẬT KÝ ĐÓNG MỞ CỬA",
        "description": "Nhật ký kiểm toán các thao tác mở cửa từ xa và mở cửa khẩn cấp (tbl_DoorAuditLogs)",
        "key_sql_col": "AuditID",
        "title_sql_col": "Action",
        "columns": [
            {"internal": "MaCua", "display": "Mã Cửa", "type": "number", "sql": "DoorID"},
            {"internal": "TenCua", "display": "Tên Cửa", "type": "text", "sql": "DoorName"},
            {"internal": "HanhDong", "display": "Hành Động Điều Khiển", "type": "text", "sql": "Action"},
            {"internal": "SoGiayKichRole", "display": "Số Giây Kích Rơ-le", "type": "number", "sql": "DurationSec"},
            {"internal": "NguoiThaoTac", "display": "Người Thao Tác", "type": "text", "sql": "Operator"},
            {"internal": "ThanhCong", "display": "Thực Thi Thành Công", "type": "boolean", "sql": "Success"},
            {"internal": "ThoiGianThaoTac", "display": "Thời Gian Thao Tác", "type": "text", "sql": "CreatedAt"},
        ]
    },
    "tbl_ClockSyncAuditLogs": {
        "list_title": "VMS SEAZEN - NHẬT KÝ ĐỐI SOÁT GIỜ NTP",
        "description": "Nhật ký đối soát Giờ chuẩn Việt Nam (NTP UTC+7) và xác nhận đồng bộ 2 lớp (tbl_ClockSyncAuditLogs)",
        "key_sql_col": "ClockAuditID",
        "title_sql_col": "AuditType",
        "columns": [
            {"internal": "LoaiKiemTra", "display": "Loại Kiểm Tra", "type": "text", "sql": "AuditType"},
            {"internal": "GioChuanVietNamNTP", "display": "Giờ Chuẩn Việt Nam (NTP UTC+7)", "type": "text", "sql": "VietnamNtpTime"},
            {"internal": "MayChuNTP", "display": "Máy Chủ NTP Quốc Tế", "type": "text", "sql": "NtpServerUsed"},
            {"internal": "GioMayTinhCucBo", "display": "Giờ Máy Tính Cục Bộ", "type": "text", "sql": "LocalPcTime"},
            {"internal": "DoLechMayTinhGiay", "display": "Độ Lệch Máy Tính (Giây)", "type": "number", "sql": "LocalPcDriftSeconds"},
            {"internal": "ChiTietBonMayZKTeco", "display": "Chi Tiết Đồng Hồ 4 Máy ZKTeco", "type": "note", "sql": "DevicesSummaryJson"},
            {"internal": "MaXacNhanHaiLop", "display": "Mã Xác Nhận 2 Lớp", "type": "text", "sql": "ConfirmationCode"},
            {"internal": "NguoiThucHien", "display": "Người Thực Hiện", "type": "text", "sql": "Operator"},
            {"internal": "TrangThaiAnToan", "display": "Trạng Thái An Toàn", "type": "text", "sql": "Status"},
        ]
    }
}


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi_decrypt(raw_bytes: bytes) -> bytes:
    """Decrypts DPAPI:, SZSEC1: (DPAPI + Zlib), or raw Windows DPAPI token_cache.bin."""
    if not raw_bytes:
        return b""
    if raw_bytes.startswith(b"{"):
        return raw_bytes
    if raw_bytes.startswith(b"DPAPI:"):
        payload = raw_bytes[6:]
    elif raw_bytes.startswith(b"SZSEC1:"):
        payload = raw_bytes[7:]
    else:
        payload = raw_bytes
    try:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        buf = ctypes.cast(ctypes.create_string_buffer(payload), ctypes.POINTER(ctypes.c_char))
        blob_in = _DATA_BLOB(len(payload), buf)
        blob_out = _DATA_BLOB()
        if crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
            out_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            kernel32.LocalFree(blob_out.pbData)
            try:
                return zlib.decompress(out_bytes)
            except Exception:
                return out_bytes
    except Exception as e:
        logger.debug("DPAPI decrypt fallback: %s", e)
    return raw_bytes


def _find_token_cache_paths() -> List[str]:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    local_appdata = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
    candidates = [
        os.path.join(base_dir, "data", ".cache", "token_cache.bin"),
        os.path.join(base_dir, "token_cache.bin"),
        os.path.join(local_appdata, "SeaZen_HR_Portal", "data", ".cache", "token_cache.bin"),
        r"D:\SeaZen APP\SEAZEN_HR_PORTAL_APP\data\.cache\token_cache.bin",
        r"D:\SeaZen APP\Compress Attachment Sharepoint\token_cache.bin",
    ]
    return [p for p in candidates if os.path.isfile(p)]


def get_sharepoint_tokens() -> Dict[str, Any]:
    """
    Acquires both Graph API and SharePoint Online REST API OAuth2 Bearer tokens
    silently using SEAZENHR-PORTAL (0390280b-12b8-49c4-adbf-a9c2b8bccfb5).
    """
    cache_paths = _find_token_cache_paths()
    for path in cache_paths:
        try:
            with open(path, "rb") as f:
                raw = f.read()
            dec = _dpapi_decrypt(raw).decode("utf-8", errors="replace")
            if not dec.strip().startswith("{"):
                continue
            cache = msal.SerializableTokenCache()
            cache.deserialize(dec)
            app = msal.PublicClientApplication(
                CLIENT_ID,
                authority=f"https://login.microsoftonline.com/{TENANT_ID}",
                token_cache=cache
            )
            accounts = app.get_accounts()
            if not accounts:
                continue
            acc = accounts[0]
            sp_res = app.acquire_token_silent(SP_SCOPES, account=acc)
            graph_res = app.acquire_token_silent(GRAPH_SCOPES, account=acc)
            if sp_res and "access_token" in sp_res:
                return {
                    "ok": True,
                    "account": acc.get("username"),
                    "cache_path": path,
                    "sp_token": sp_res["access_token"],
                    "graph_token": graph_res.get("access_token") if graph_res else None
                }
        except Exception as e:
            logger.debug("Token cache %s error: %s", path, e)

    return {
        "ok": False,
        "error": "Không tìm thấy phiên OAuth2 Bearer Token hợp lệ của SEAZENHR-PORTAL."
    }


def get_vms_sharepoint_status() -> Dict[str, Any]:
    """Checks SharePoint token status and lists existing 'VMS SEAZEN - ...' lists on ONESEAZEN."""
    tok_info = get_sharepoint_tokens()
    if not tok_info.get("ok"):
        return {
            "authenticated": False,
            "error": tok_info.get("error"),
            "schemas": [
                {
                    "sql_table": k,
                    "list_title": v["list_title"],
                    "columns_count": len(v["columns"]),
                    "vietnamese_columns": [c["display"] for c in v["columns"]],
                    "exists_on_sharepoint": False
                }
                for k, v in VMS_SHAREPOINT_LIST_SCHEMAS.items()
            ]
        }

    sp_token = tok_info["sp_token"]
    headers = {
        "Authorization": f"Bearer {sp_token}",
        "Accept": "application/json;odata=nometadata"
    }
    existing_lists = {}
    try:
        r = requests.get(
            f"{SP_SITE_URL}/_api/web/lists?$select=Id,Title,ItemCount",
            headers=headers,
            timeout=10
        )
        if r.status_code == 200:
            for item in r.json().get("value", []):
                existing_lists[item["Title"]] = {
                    "id": item["Id"],
                    "item_count": item.get("ItemCount", 0)
                }
    except Exception as e:
        logger.warning("Error querying SharePoint lists: %s", e)

    schema_list = []
    for sql_tbl, meta in VMS_SHAREPOINT_LIST_SCHEMAS.items():
        title = meta["list_title"]
        sp_match = existing_lists.get(title)
        schema_list.append({
            "sql_table": sql_tbl,
            "list_title": title,
            "description": meta["description"],
            "columns_count": len(meta["columns"]),
            "vietnamese_columns": [c["display"] for c in meta["columns"]],
            "exists_on_sharepoint": sp_match is not None,
            "sp_list_id": sp_match["id"] if sp_match else None,
            "sp_item_count": sp_match["item_count"] if sp_match else 0
        })

    return {
        "authenticated": True,
        "account": tok_info.get("account"),
        "site_url": SP_SITE_URL,
        "client_id": CLIENT_ID,
        "schemas": schema_list
    }


def provision_vms_sharepoint_lists(selected_tables: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Creates the 'VMS SEAZEN - (Tên bảng)' SharePoint Lists and their Vietnamese columns
    on https://seazenvn.sharepoint.com/sites/ONESEAZEN using OAuth2 Bearer Token.
    """
    tok_info = get_sharepoint_tokens()
    if not tok_info.get("ok"):
        return {"success": False, "error": tok_info.get("error")}

    sp_token = tok_info["sp_token"]
    headers_read = {
        "Authorization": f"Bearer {sp_token}",
        "Accept": "application/json;odata=nometadata"
    }

    # Get FormDigestValue per no-cookies-auth.md rule
    ctx_resp = requests.post(
        f"{SP_SITE_URL}/_api/contextinfo",
        headers={"Authorization": f"Bearer {sp_token}", "Accept": "application/json;odata=nometadata"},
        timeout=10
    )
    digest = ctx_resp.json().get("FormDigestValue", "") if ctx_resp.status_code == 200 else ""

    headers_write = {
        "Authorization": f"Bearer {sp_token}",
        "Accept": "application/json;odata=nometadata",
        "Content-Type": "application/json;odata=nometadata",
        "X-RequestDigest": digest
    }

    # Fetch existing lists
    r_lists = requests.get(f"{SP_SITE_URL}/_api/web/lists?$select=Id,Title", headers=headers_read, timeout=10)
    existing_map = {item["Title"]: item["Id"] for item in r_lists.json().get("value", [])} if r_lists.status_code == 200 else {}

    targets = selected_tables or list(VMS_SHAREPOINT_LIST_SCHEMAS.keys())
    results = []

    for tbl in targets:
        meta = VMS_SHAREPOINT_LIST_SCHEMAS.get(tbl)
        if not meta:
            continue
        list_title = meta["list_title"]
        list_id = existing_map.get(list_title)
        created_new = False

        if not list_id:
            payload = {
                "BaseTemplate": 100,
                "Title": list_title,
                "Description": meta["description"],
                "AllowContentTypes": True,
                "ContentTypesEnabled": False
            }
            cr = requests.post(f"{SP_SITE_URL}/_api/web/lists", headers=headers_write, json=payload, timeout=12)
            if cr.status_code in (200, 201):
                list_id = cr.json().get("Id")
                created_new = True
            else:
                results.append({"sql_table": tbl, "list_title": list_title, "success": False, "error": cr.text[:200]})
                continue

        # Check existing fields in this list
        f_resp = requests.get(
            f"{SP_SITE_URL}/_api/web/lists(guid'{list_id}')/fields?$select=InternalName,Title",
            headers=headers_read,
            timeout=10
        )
        existing_fields = set()
        if f_resp.status_code == 200:
            for f_obj in f_resp.json().get("value", []):
                existing_fields.add(f_obj.get("InternalName"))
                existing_fields.add(f_obj.get("Title"))

        cols_created = 0
        for col in meta["columns"]:
            c_internal = col["internal"]
            c_display = col["display"]
            c_type = col["type"]
            if c_internal in existing_fields or c_display in existing_fields:
                continue

            # FieldTypeKind: 2=Text, 3=Note, 4=DateTime, 8=Boolean, 9=Number
            type_kind = 2
            if c_type == "note":
                type_kind = 3
            elif c_type == "number":
                type_kind = 9
            elif c_type == "boolean":
                type_kind = 8

            # Step 1: Create field with clean ASCII InternalName first
            f_payload = {
                "Title": c_internal,
                "FieldTypeKind": type_kind
            }
            fc = requests.post(
                f"{SP_SITE_URL}/_api/web/lists(guid'{list_id}')/fields",
                headers=headers_write,
                json=f_payload,
                timeout=10
            )
            if fc.status_code in (200, 201):
                cols_created += 1
                # Step 2: Rename Display Title to full Vietnamese name
                requests.post(
                    f"{SP_SITE_URL}/_api/web/lists(guid'{list_id}')/fields/getbyinternalnameortitle('{c_internal}')",
                    headers={**headers_write, "X-HTTP-Method": "MERGE", "If-Match": "*"},
                    json={"Title": c_display},
                    timeout=8
                )

        results.append({
            "sql_table": tbl,
            "list_title": list_title,
            "list_id": list_id,
            "created_new": created_new,
            "columns_created": cols_created,
            "success": True
        })

    return {
        "success": True,
        "account": tok_info.get("account"),
        "results": results
    }


def sync_table_to_sharepoint(sql_table: str, max_rows: int = 200) -> Dict[str, Any]:
    """
    Pushes records from a local SQL Server table (SeaZen_AccessControl)
    to its corresponding 'VMS SEAZEN - (Tên bảng)' SharePoint List via OAuth2 Bearer Token.
    """
    meta = VMS_SHAREPOINT_LIST_SCHEMAS.get(sql_table)
    if not meta:
        return {"success": False, "error": f"Bảng không hợp lệ: {sql_table}"}

    # Ensure the target list & Vietnamese columns exist first
    prov = provision_vms_sharepoint_lists([sql_table])
    if not prov.get("success") or not prov.get("results"):
        return {"success": False, "error": prov.get("error", "Không thể khởi tạo SharePoint List")}

    list_info = prov["results"][0]
    if not list_info.get("success"):
        return {"success": False, "error": list_info.get("error")}

    list_id = list_info["list_id"]
    list_title = list_info["list_title"]

    tok_info = get_sharepoint_tokens()
    sp_token = tok_info["sp_token"]

    ctx_resp = requests.post(
        f"{SP_SITE_URL}/_api/contextinfo",
        headers={"Authorization": f"Bearer {sp_token}", "Accept": "application/json;odata=nometadata"},
        timeout=10
    )
    digest = ctx_resp.json().get("FormDigestValue", "") if ctx_resp.status_code == 200 else ""

    headers_read = {
        "Authorization": f"Bearer {sp_token}",
        "Accept": "application/json;odata=nometadata"
    }
    headers_write = {
        "Authorization": f"Bearer {sp_token}",
        "Accept": "application/json;odata=nometadata",
        "Content-Type": "application/json;odata=nometadata",
        "X-RequestDigest": digest
    }

    # Fetch existing Title values in SharePoint list to avoid duplicate inserts
    existing_titles = {}
    try:
        r_items = requests.get(
            f"{SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items?$select=Id,Title&$top=5000",
            headers=headers_read,
            timeout=15
        )
        if r_items.status_code == 200:
            for it in r_items.json().get("value", []):
                if it.get("Title") is not None:
                    existing_titles[str(it["Title"]).strip()] = it["Id"]
    except Exception as e:
        logger.warning("Read existing items warning: %s", e)

    # Read rows from SQL Server
    rows = db_mssql.get_table_rows(sql_table, limit=max_rows)
    inserted = 0
    updated = 0

    for row in rows:
        title_val = str(row.get(meta["title_sql_col"]) or row.get(meta["key_sql_col"]) or "N/A").strip()
        item_payload: Dict[str, Any] = {"Title": title_val[:250]}

        for col in meta["columns"]:
            raw_val = row.get(col["sql"])
            if raw_val is None:
                continue
            c_type = col["type"]
            if c_type == "boolean":
                item_payload[col["internal"]] = bool(raw_val)
            elif c_type == "number":
                try:
                    item_payload[col["internal"]] = float(raw_val) if "." in str(raw_val) else int(raw_val)
                except Exception:
                    item_payload[col["internal"]] = 0
            elif c_type == "note":
                item_payload[col["internal"]] = str(raw_val)[:8000]
            else:
                item_payload[col["internal"]] = str(raw_val)[:250]

        sp_item_id = existing_titles.get(title_val)
        if sp_item_id:
            resp = requests.post(
                f"{SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items({sp_item_id})",
                headers={**headers_write, "X-HTTP-Method": "MERGE", "If-Match": "*"},
                json=item_payload,
                timeout=10
            )
            if resp.status_code in (200, 204):
                updated += 1
        else:
            resp = requests.post(
                f"{SP_SITE_URL}/_api/web/lists(guid'{list_id}')/items",
                headers=headers_write,
                json=item_payload,
                timeout=10
            )
            if resp.status_code in (200, 201):
                inserted += 1

    return {
        "success": True,
        "sql_table": sql_table,
        "list_title": list_title,
        "list_id": list_id,
        "rows_processed": len(rows),
        "inserted": inserted,
        "updated": updated
    }
