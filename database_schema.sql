-- ======================================================================
-- SEAZEN SMART ACCESS CONTROL - ENTERPRISE DATABASE SCHEMA (18 TABLES)
-- Microsoft SQL Server (SeaZen_AccessControl)
-- Thiết kế bảo toàn dữ liệu 100% (Idempotent, Zero Data Loss)
-- Bao phủ toàn bộ phân hệ ePAD: Kiểm soát cửa (AC_), Nhân sự & Sinh trắc (IC_/HR_),
-- Khách & Nhà thầu (HR_), Chấm công & Ca làm việc (TA_), Bảo vệ giờ NTP (SY_)
-- ======================================================================

USE master;
GO

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'SeaZen_AccessControl')
BEGIN
    CREATE DATABASE SeaZen_AccessControl
    COLLATE Vietnamese_CI_AS;
END
GO

USE SeaZen_AccessControl;
GO

-- 1. Bảng Cơ Cấu Phòng Ban Đa Cấp (IC_Department)
IF OBJECT_ID(N'tbl_Departments', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Departments (
        DepartmentID INT IDENTITY(1,1) PRIMARY KEY,
        DepartmentCode NVARCHAR(50) NULL,
        DepartmentName NVARCHAR(255) NOT NULL,
        ParentID INT NULL,
        Level INT DEFAULT 1,
        Location NVARCHAR(255) NULL,
        Description NVARCHAR(500) NULL,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Departments_Parent FOREIGN KEY (ParentID) REFERENCES tbl_Departments(DepartmentID)
    );
    CREATE INDEX IX_Departments_Parent ON tbl_Departments(ParentID);
    CREATE INDEX IX_Departments_Name ON tbl_Departments(DepartmentName);
END
GO

-- 2. Bảng Danh Bạ Nhân Sự (HR_User / HR_EmployeeInfo)
IF OBJECT_ID(N'tbl_Employees', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Employees (
        EmployeeID NVARCHAR(50) PRIMARY KEY,
        EmployeeATID NVARCHAR(50) NOT NULL UNIQUE,
        EmployeeCode NVARCHAR(50) NULL,
        FullName NVARCHAR(255) NOT NULL,
        DepartmentID INT NULL,
        DepartmentName NVARCHAR(255) NULL,
        Position NVARCHAR(100) NULL,
        CardNumber NVARCHAR(50) NULL,
        Privilege INT DEFAULT 0,
        Gender NVARCHAR(20) NULL,
        Email NVARCHAR(200) NULL,
        Phone NVARCHAR(50) NULL,
        JoinedDate DATETIME NULL,
        IsStaff BIT DEFAULT 1,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Employees_Department FOREIGN KEY (DepartmentID) REFERENCES tbl_Departments(DepartmentID)
    );
    CREATE INDEX IX_Employees_ATID ON tbl_Employees(EmployeeATID);
    CREATE INDEX IX_Employees_Card ON tbl_Employees(CardNumber);
    CREATE INDEX IX_Employees_Dept ON tbl_Employees(DepartmentID);
    CREATE INDEX IX_Employees_Name ON tbl_Employees(FullName);
END
GO

IF COL_LENGTH('tbl_Employees', 'Privilege') IS NULL
    ALTER TABLE tbl_Employees ADD Privilege INT DEFAULT 0;
GO
IF COL_LENGTH('tbl_Employees', 'Gender') IS NULL
    ALTER TABLE tbl_Employees ADD Gender NVARCHAR(20) NULL;
GO

-- 3. Bảng Dữ Liệu Sinh Trắc Học & Khuôn Mặt (IC_UserMaster / IC_UserFaceV2)
IF OBJECT_ID(N'tbl_EmployeeBiometrics', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_EmployeeBiometrics (
        BiometricID INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeATID NVARCHAR(50) NOT NULL,
        FacePhotoBase64 NVARCHAR(MAX) NULL,
        FacePhotoPath NVARCHAR(500) NULL,
        FaceTemplateBIODATA NVARCHAR(MAX) NULL,
        FaceVersion NVARCHAR(50) DEFAULT 'ZKTeco_VisibleLight_v58.12',
        FingerTemplate NVARCHAR(MAX) NULL,
        FingerCount INT DEFAULT 0,
        HasFace BIT DEFAULT 0,
        HasCard BIT DEFAULT 0,
        HasFinger BIT DEFAULT 0,
        LastSyncedToDevices DATETIME NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Biometrics_Employee FOREIGN KEY (EmployeeATID) REFERENCES tbl_Employees(EmployeeATID) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX UQ_Biometrics_Employee ON tbl_EmployeeBiometrics(EmployeeATID);
END
GO

IF COL_LENGTH('tbl_EmployeeBiometrics', 'FaceVersion') IS NULL
    ALTER TABLE tbl_EmployeeBiometrics ADD FaceVersion NVARCHAR(50) DEFAULT 'ZKTeco_VisibleLight_v58.12';
GO
IF COL_LENGTH('tbl_EmployeeBiometrics', 'FingerCount') IS NULL
    ALTER TABLE tbl_EmployeeBiometrics ADD FingerCount INT DEFAULT 0;
GO

-- 4. Bảng Danh Mục Cửa Kiểm Soát (AC_Door)
IF OBJECT_ID(N'tbl_Doors', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Doors (
        DoorID INT PRIMARY KEY,
        DoorCode NVARCHAR(50) NOT NULL,
        DoorName NVARCHAR(100) NOT NULL,
        Direction NVARCHAR(20) NOT NULL,
        DefaultOpenSeconds INT DEFAULT 3,
        AreaName NVARCHAR(100) DEFAULT N'Sảnh Chính SeaZen',
        IsActive BIT DEFAULT 1
    );
END
GO

IF COL_LENGTH('tbl_Doors', 'AreaName') IS NULL
    ALTER TABLE tbl_Doors ADD AreaName NVARCHAR(100) DEFAULT N'Sảnh Chính SeaZen';
GO

-- 5. Bảng Thiết Bị Phần Cứng ZKTeco SenseFace 4A (IC_Device)
IF OBJECT_ID(N'tbl_Devices', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Devices (
        SerialNumber NVARCHAR(50) PRIMARY KEY,
        DeviceName NVARCHAR(100) NOT NULL,
        IPAddress NVARCHAR(50) NOT NULL,
        Port INT DEFAULT 4370,
        DoorID INT NOT NULL,
        DevicePosition NVARCHAR(50) NULL,
        DeviceModel NVARCHAR(100) DEFAULT 'SenseFace 4A (ZAM70_TFT)',
        FirmwareVersion NVARCHAR(100) NULL,
        UserCount INT DEFAULT 0,
        FaceCount INT DEFAULT 0,
        FingerCount INT DEFAULT 0,
        LogCount INT DEFAULT 0,
        DeviceClock DATETIME NULL,
        NtpDriftSeconds FLOAT DEFAULT 0,
        IsOnline BIT DEFAULT 1,
        LastPingTime DATETIME NULL,
        CONSTRAINT FK_Devices_Door FOREIGN KEY (DoorID) REFERENCES tbl_Doors(DoorID)
    );
END
GO

IF COL_LENGTH('tbl_Devices', 'DeviceModel') IS NULL
    ALTER TABLE tbl_Devices ADD DeviceModel NVARCHAR(100) DEFAULT 'SenseFace 4A (ZAM70_TFT)';
GO
IF COL_LENGTH('tbl_Devices', 'UserCount') IS NULL
    ALTER TABLE tbl_Devices ADD UserCount INT DEFAULT 0;
GO
IF COL_LENGTH('tbl_Devices', 'FaceCount') IS NULL
    ALTER TABLE tbl_Devices ADD FaceCount INT DEFAULT 0;
GO
IF COL_LENGTH('tbl_Devices', 'FingerCount') IS NULL
    ALTER TABLE tbl_Devices ADD FingerCount INT DEFAULT 0;
GO
IF COL_LENGTH('tbl_Devices', 'LogCount') IS NULL
    ALTER TABLE tbl_Devices ADD LogCount INT DEFAULT 0;
GO
IF COL_LENGTH('tbl_Devices', 'DeviceClock') IS NULL
    ALTER TABLE tbl_Devices ADD DeviceClock DATETIME NULL;
GO
IF COL_LENGTH('tbl_Devices', 'NtpDriftSeconds') IS NULL
    ALTER TABLE tbl_Devices ADD NtpDriftSeconds FLOAT DEFAULT 0;
GO

-- 6. Bảng Khung Giờ Mở Cửa (AC_TimeZone)
IF OBJECT_ID(N'tbl_AccessTimezones', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_AccessTimezones (
        TimezoneID INT IDENTITY(1,1) PRIMARY KEY,
        TimezoneCode NVARCHAR(50) NOT NULL UNIQUE,
        TimezoneName NVARCHAR(150) NOT NULL,
        MonTime NVARCHAR(50) DEFAULT '00:00-23:59',
        TueTime NVARCHAR(50) DEFAULT '00:00-23:59',
        WedTime NVARCHAR(50) DEFAULT '00:00-23:59',
        ThuTime NVARCHAR(50) DEFAULT '00:00-23:59',
        FriTime NVARCHAR(50) DEFAULT '00:00-23:59',
        SatTime NVARCHAR(50) DEFAULT '00:00-23:59',
        SunTime NVARCHAR(50) DEFAULT '00:00-23:59',
        HolidayTime NVARCHAR(50) DEFAULT '00:00-23:59',
        Description NVARCHAR(500) NULL,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

-- 7. Bảng Nhóm Phân Quyền Cửa (AC_AccessedGroup)
IF OBJECT_ID(N'tbl_AccessGroups', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_AccessGroups (
        GroupID INT IDENTITY(1,1) PRIMARY KEY,
        GroupCode NVARCHAR(50) NOT NULL UNIQUE,
        GroupName NVARCHAR(150) NOT NULL,
        TimezoneID INT NOT NULL,
        AllowedDoors NVARCHAR(100) DEFAULT '1,2',
        VerifyMode NVARCHAR(50) DEFAULT 'Face / Card / Finger',
        IsDefault BIT DEFAULT 0,
        Description NVARCHAR(500) NULL,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

-- 8. Bảng Phân Quyền Phòng Ban Theo Nhóm Cửa (AC_DepartmentAccessedGroup)
IF OBJECT_ID(N'tbl_DepartmentAccessGroups', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_DepartmentAccessGroups (
        MappingID INT IDENTITY(1,1) PRIMARY KEY,
        DepartmentID INT NOT NULL,
        DepartmentName NVARCHAR(255) NULL,
        GroupID INT NOT NULL,
        GroupName NVARCHAR(150) NULL,
        UpdatedBy NVARCHAR(100) DEFAULT N'Hệ thống',
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

-- 9. Bảng Kho Thẻ Từ RFID Khách & Nhà Thầu (HR_CustomerCard / HR_CardNumberInfo)
IF OBJECT_ID(N'tbl_CustomerCards', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_CustomerCards (
        CardID INT IDENTITY(1,1) PRIMARY KEY,
        CardCode NVARCHAR(50) NOT NULL,
        CardNumber NVARCHAR(50) NOT NULL UNIQUE,
        CardType NVARCHAR(50) DEFAULT 'VISITOR',          -- VISITOR, CONTRACTOR, VIP
        Status NVARCHAR(50) DEFAULT 'AVAILABLE',          -- AVAILABLE, ASSIGNED, LOST, LOCKED
        CurrentHolderName NVARCHAR(255) NULL,
        CurrentHolderCCCD NVARCHAR(50) NULL,
        AssignedAt DATETIME NULL,
        IsSyncedToDevices BIT DEFAULT 1,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
    CREATE INDEX IX_CustomerCards_Status ON tbl_CustomerCards(Status);
END
GO

-- 10. Bảng Quản Lý Khách Ra Vào & Cấp Thẻ Tạm (HR_CustomerInfo)
IF OBJECT_ID(N'tbl_Visitors', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Visitors (
        VisitorID NVARCHAR(50) PRIMARY KEY,
        FullName NVARCHAR(255) NOT NULL,
        CCCDNumber NVARCHAR(50) NULL,
        CardNumber NVARCHAR(50) NULL,
        Phone NVARCHAR(50) NULL,
        BirthDate NVARCHAR(50) NULL,
        Gender NVARCHAR(20) NULL,
        Address NVARCHAR(500) NULL,
        Company NVARCHAR(255) NULL,
        Department NVARCHAR(255) NULL,
        HostPerson NVARCHAR(255) NULL,
        Purpose NVARCHAR(255) NULL,
        CheckinTime DATETIME NOT NULL,
        ExpectedCheckoutTime DATETIME NULL,
        CheckoutTime DATETIME NULL,
        DurationMinutes INT NULL,
        Status NVARCHAR(50) DEFAULT 'ACTIVE',
        Operator NVARCHAR(100) NULL,
        AutoUnlock BIT DEFAULT 0,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
    CREATE INDEX IX_Visitors_Status ON tbl_Visitors(Status);
    CREATE INDEX IX_Visitors_Card ON tbl_Visitors(CardNumber);
    CREATE INDEX IX_Visitors_CCCD ON tbl_Visitors(CCCDNumber);
    CREATE INDEX IX_Visitors_Checkin ON tbl_Visitors(CheckinTime);
END
GO

IF COL_LENGTH('tbl_Visitors', 'Phone') IS NULL
    ALTER TABLE tbl_Visitors ADD Phone NVARCHAR(50) NULL;
GO
IF COL_LENGTH('tbl_Visitors', 'BirthDate') IS NULL
    ALTER TABLE tbl_Visitors ADD BirthDate NVARCHAR(50) NULL;
GO
IF COL_LENGTH('tbl_Visitors', 'Gender') IS NULL
    ALTER TABLE tbl_Visitors ADD Gender NVARCHAR(20) NULL;
GO
IF COL_LENGTH('tbl_Visitors', 'Address') IS NULL
    ALTER TABLE tbl_Visitors ADD Address NVARCHAR(500) NULL;
GO

-- 11. Bảng Đăng Ký Hẹn Khách Trước (HR_EmailDeclareGuest)
IF OBJECT_ID(N'tbl_PreRegisteredGuests', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_PreRegisteredGuests (
        BookingID INT IDENTITY(1,1) PRIMARY KEY,
        BookingCode NVARCHAR(50) NOT NULL UNIQUE,
        GuestFullName NVARCHAR(255) NOT NULL,
        GuestCCCD NVARCHAR(50) NULL,
        GuestPhone NVARCHAR(50) NULL,
        GuestCompany NVARCHAR(255) NULL,
        HostEmployeeName NVARCHAR(255) NOT NULL,
        HostDepartment NVARCHAR(255) NULL,
        VisitDate DATE NOT NULL,
        StartTime NVARCHAR(20) DEFAULT '08:30',
        EndTime NVARCHAR(20) DEFAULT '17:30',
        Purpose NVARCHAR(500) NULL,
        ReservedCardNumber NVARCHAR(50) NULL,
        Status NVARCHAR(50) DEFAULT 'PENDING',            -- PENDING, CHECKED_IN, CANCELLED, EXPIRED
        CreatedBy NVARCHAR(100) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
    CREATE INDEX IX_PreGuests_Date ON tbl_PreRegisteredGuests(VisitDate);
END
GO

-- 12. Bảng Quản Lý Nhân Sự Nhà Thầu / Đơn Vị Thi Công (HR_ContractorInfo)
IF OBJECT_ID(N'tbl_Contractors', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Contractors (
        ContractorID INT IDENTITY(1,1) PRIMARY KEY,
        ContractorCode NVARCHAR(50) NOT NULL UNIQUE,
        ContractorCompany NVARCHAR(255) NOT NULL,
        WorkerFullName NVARCHAR(255) NOT NULL,
        CCCDNumber NVARCHAR(50) NULL,
        Phone NVARCHAR(50) NULL,
        CardNumber NVARCHAR(50) NULL,
        WorkArea NVARCHAR(255) NULL,
        SupervisorName NVARCHAR(255) NULL,
        ValidFrom DATE NOT NULL,
        ValidTo DATE NOT NULL,
        Status NVARCHAR(50) DEFAULT 'ACTIVE',             -- ACTIVE, EXPIRED, SUSPENDED
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

-- 13. Bảng Nhật Ký Quẹt Khuôn Mặt / Thẻ Từ Thời Gian Thực (IC_AttendanceLog)
IF OBJECT_ID(N'tbl_AttendanceLogs', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_AttendanceLogs (
        LogID BIGINT IDENTITY(1,1) PRIMARY KEY,
        EmployeeATID NVARCHAR(50) NOT NULL,
        FullName NVARCHAR(255) NULL,
        Department NVARCHAR(255) NULL,
        DeviceSerialNumber NVARCHAR(50) NOT NULL,
        DeviceName NVARCHAR(100) NULL,
        CheckTime DATETIME NOT NULL,
        VerifyMode NVARCHAR(50) NULL,
        VerifyModeValue INT NULL,
        InOutMode INT NULL,
        IsStaff BIT DEFAULT 1,
        PhotoUrl NVARCHAR(500) NULL,
        SyncSource NVARCHAR(50) DEFAULT 'DIRECT_TCP',
        CreatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT UQ_AttendanceLog UNIQUE (EmployeeATID, CheckTime, DeviceSerialNumber)
    );
    CREATE INDEX IX_Attendance_CheckTime ON tbl_AttendanceLogs(CheckTime);
    CREATE INDEX IX_Attendance_Employee ON tbl_AttendanceLogs(EmployeeATID);
    CREATE INDEX IX_Attendance_IsStaff ON tbl_AttendanceLogs(IsStaff);
END
GO

-- 14. Bảng Danh Mục Ca Làm Việc (TA_Shift)
IF OBJECT_ID(N'tbl_Shifts', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_Shifts (
        ShiftID INT IDENTITY(1,1) PRIMARY KEY,
        ShiftCode NVARCHAR(50) NOT NULL UNIQUE,
        ShiftName NVARCHAR(150) NOT NULL,
        CheckInTime NVARCHAR(20) NOT NULL,                -- e.g. '08:00'
        CheckOutTime NVARCHAR(20) NOT NULL,               -- e.g. '17:30'
        BreakStartTime NVARCHAR(20) DEFAULT '12:00',
        BreakEndTime NVARCHAR(20) DEFAULT '13:30',
        GraceLateMinutes INT DEFAULT 5,
        GraceEarlyMinutes INT DEFAULT 5,
        WorkingHours FLOAT DEFAULT 8.0,
        IsOvernight BIT DEFAULT 0,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETDATE(),
        UpdatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

-- 15. Bảng Tổng Hợp Chấm Công Hàng Ngày (TA_TimeAttendanceLog)
IF OBJECT_ID(N'tbl_DailyTimekeeping', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_DailyTimekeeping (
        TimekeepingID BIGINT IDENTITY(1,1) PRIMARY KEY,
        WorkDate DATE NOT NULL,
        EmployeeATID NVARCHAR(50) NOT NULL,
        EmployeeCode NVARCHAR(50) NULL,
        FullName NVARCHAR(255) NULL,
        DepartmentName NVARCHAR(255) NULL,
        ShiftCode NVARCHAR(50) DEFAULT 'HC_0800_1730',
        FirstInTime DATETIME NULL,
        LastOutTime DATETIME NULL,
        TotalScans INT DEFAULT 0,
        LateMinutes INT DEFAULT 0,
        EarlyLeaveMinutes INT DEFAULT 0,
        TotalHours FLOAT DEFAULT 0,
        AttendanceStatus NVARCHAR(50) DEFAULT 'PRESENT',  -- PRESENT, LATE, EARLY_LEAVE, ABSENT, MISSING_OUT
        Notes NVARCHAR(500) NULL,
        UpdatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT UQ_DailyTimekeeping UNIQUE (WorkDate, EmployeeATID)
    );
    CREATE INDEX IX_Timekeeping_Date ON tbl_DailyTimekeeping(WorkDate);
END
GO

-- 16. Bảng Hàng Đợi Lệnh Thiết Bị Phần Cứng (IC_SystemCommand)
IF OBJECT_ID(N'tbl_DeviceCommands', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_DeviceCommands (
        CommandID BIGINT IDENTITY(1,1) PRIMARY KEY,
        CommandCode NVARCHAR(100) NOT NULL,               -- UPLOAD_USER, DELETE_USER, UNLOCK_DOOR, SYNC_CLOCK_NTP, HARVEST_LOGS
        TargetSerial NVARCHAR(50) DEFAULT 'ALL',
        TargetDeviceName NVARCHAR(100) NULL,
        PayloadJson NVARCHAR(MAX) NULL,
        Protocol NVARCHAR(50) DEFAULT 'DIRECT_TCP_4370',
        Status NVARCHAR(50) DEFAULT 'COMPLETED',          -- PENDING, EXECUTING, COMPLETED, FAILED
        ResultMessage NVARCHAR(MAX) NULL,
        RequestedBy NVARCHAR(100) NULL,
        CreatedAt DATETIME DEFAULT GETDATE(),
        ExecutedAt DATETIME DEFAULT GETDATE()
    );
    CREATE INDEX IX_DeviceCommands_Created ON tbl_DeviceCommands(CreatedAt);
END
GO

-- 17. Bảng Nhật Ký Đóng/Mở Cửa Phần Cứng (AC_StateLog / IC_Audit)
IF OBJECT_ID(N'tbl_DoorAuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_DoorAuditLogs (
        AuditID BIGINT IDENTITY(1,1) PRIMARY KEY,
        DoorID INT NOT NULL,
        DoorName NVARCHAR(100) NULL,
        Action NVARCHAR(50) NOT NULL,
        DurationSec INT DEFAULT 1,
        Operator NVARCHAR(100) NULL,
        Success BIT DEFAULT 1,
        ErrorMessage NVARCHAR(MAX) NULL,
        CreatedAt DATETIME DEFAULT GETDATE()
    );
    CREATE INDEX IX_Audit_CreatedAt ON tbl_DoorAuditLogs(CreatedAt);
END
GO

-- 18. Bảng Nhật Ký Đối Soát & Đồng Bộ Giờ Chuẩn NTP Việt Nam (Anti-Clock-Drift Audit)
IF OBJECT_ID(N'tbl_ClockSyncAuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE tbl_ClockSyncAuditLogs (
        ClockAuditID BIGINT IDENTITY(1,1) PRIMARY KEY,
        AuditType NVARCHAR(50) NOT NULL,                  -- STARTUP_CHECK, MANUAL_AUDIT, CONFIRMED_2LAYER_SYNC
        VietnamNtpTime DATETIME NOT NULL,
        NtpServerUsed NVARCHAR(100) NULL,
        LocalPcTime DATETIME NOT NULL,
        LocalPcDriftSeconds FLOAT NOT NULL,
        DevicesSummaryJson NVARCHAR(MAX) NULL,
        ConfirmationCode NVARCHAR(100) NULL,
        Operator NVARCHAR(100) NULL,
        Status NVARCHAR(50) NOT NULL,                     -- HEALTHY, PC_DRIFT_WARNING, DEVICE_DRIFT_WARNING, SYNCED_TO_VN_NTP
        CreatedAt DATETIME DEFAULT GETDATE()
    );
    CREATE INDEX IX_ClockAudit_CreatedAt ON tbl_ClockSyncAuditLogs(CreatedAt);
END
GO

PRINT N'>>> [OK] KHỞI TẠO ĐẦY ĐỦ 18 BẢNG CSDL SEAZEN_ACCESSCONTROL THÀNH CÔNG (0% MẤT DỮ LIỆU)!';
GO
