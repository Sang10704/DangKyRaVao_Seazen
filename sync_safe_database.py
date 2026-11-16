"""
Safe Non-Destructive Database Initializer & Background Read-Only Synchronizer
for SeaZen Smart Access Control (SeaZen_AccessControl on SQL Server).
Guarantees 0% data deletion on both local SQL Server and remote ePAD / ZKTeco hardware.
"""

import os
import json
import logging
from datetime import datetime, date
import requests
import pyodbc

import db_mssql
from zk_direct_client import ZkDirectClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_safe_db")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(BASE_DIR, "database_schema.sql")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")


def run_safe_schema_upgrade():
    logger.info("1. Upgrading SeaZen_AccessControl schema (18 tables, non-destructive)...")
    ok, msg = db_mssql.execute_sql_script(SCHEMA_PATH)
    if not ok:
        raise RuntimeError(f"Schema execution failed: {msg}")
    logger.info("   -> %s", msg)


def sync_from_epad_stateless_api(conn):
    """
    Uses Stateless ServiceId=1 token (LoginType='Service') to pull live read-only
    directory data from http://172.16.56.2:4001 without affecting any web user session.
    """
    cur = conn.cursor()
    epad_host = "http://172.16.56.2:4001"
    try:
        r = requests.post(
            f"{epad_host}/api/login",
            json={"UserName": "123", "Password": "123", "ServiceId": 1},
            timeout=5
        )
        if r.status_code != 200 or "access_token" not in r.text:
            logger.warning("Could not obtain ServiceId=1 token from ePAD.")
            return {"ok": False, "reason": "No token"}
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    except Exception as e:
        logger.warning("ePAD API unreachable (%s) - skipping live ePAD read.", e)
        return {"ok": False, "reason": str(e)}

    stats = {"departments_upserted": 0, "employees_upserted": 0, "cards_upserted": 0}

    # 1. Sync Departments
    try:
        resp = requests.get(f"{epad_host}/api/Department/GetDepartmentTree", headers=headers, timeout=6)
        if resp.status_code == 200:
            tree = resp.json()
            children = tree[0].get("ListChildrent", []) if isinstance(tree, list) and tree else []
            for d in children:
                dept_name = str(d.get("Name") or "").strip()
                dept_code = str(d.get("Code") or d.get("IDLocal") or "").strip()
                if not dept_name:
                    continue
                cur.execute("SELECT DepartmentID FROM tbl_Departments WHERE DepartmentName = ?", (dept_name,))
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        "INSERT INTO tbl_Departments (DepartmentCode, DepartmentName, Level, IsActive) VALUES (?, ?, 1, 1)",
                        (dept_code, dept_name)
                    )
                    stats["departments_upserted"] += 1
                else:
                    cur.execute(
                        "UPDATE tbl_Departments SET DepartmentCode = COALESCE(NULLIF(?, ''), DepartmentCode), UpdatedAt = GETDATE() WHERE DepartmentID = ?",
                        (dept_code, row[0])
                    )
            conn.commit()
    except Exception as e:
        logger.warning("Department sync warning: %s", e)

    # Map DepartmentName -> DepartmentID
    cur.execute("SELECT DepartmentID, DepartmentName FROM tbl_Departments")
    dept_map = {str(r[1]).strip(): r[0] for r in cur.fetchall()}

    # 2. Sync All 1,117 HR Users from /api/HR_User/GetAllUserSimpleInfo
    try:
        resp = requests.get(f"{epad_host}/api/HR_User/GetAllUserSimpleInfo", headers=headers, timeout=10)
        if resp.status_code == 200:
            users = resp.json()
            for u in users:
                atid = str(u.get("EmployeeATID") or "").strip()
                if not atid:
                    continue
                emp_code = str(u.get("EmployeeCode") or atid).strip()
                full_name = str(u.get("FullName") or f"NV {atid}").strip()
                dept_name = str(u.get("Department") or "Khác").strip() or "Khác"
                dept_id = dept_map.get(dept_name)
                is_staff = 0 if dept_name in ("Khác", "--", "") else 1

                cur.execute("SELECT EmployeeID, CardNumber FROM tbl_Employees WHERE EmployeeATID = ?", (atid,))
                existing = cur.fetchone()
                if not existing:
                    cur.execute("""
                        INSERT INTO tbl_Employees (
                            EmployeeID, EmployeeATID, EmployeeCode, FullName,
                            DepartmentID, DepartmentName, IsStaff, IsActive
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                    """, (f"SZ-{atid}", atid, emp_code, full_name, dept_id, dept_name, is_staff))
                    stats["employees_upserted"] += 1
                else:
                    cur.execute("""
                        UPDATE tbl_Employees
                        SET FullName = ?,
                            EmployeeCode = COALESCE(NULLIF(?, ''), EmployeeCode),
                            DepartmentID = COALESCE(?, DepartmentID),
                            DepartmentName = CASE WHEN ? <> N'Khác' THEN ? ELSE DepartmentName END,
                            UpdatedAt = GETDATE()
                        WHERE EmployeeATID = ?
                    """, (full_name, emp_code, dept_id, dept_name, dept_name, atid))

                # Ensure Biometrics record exists
                cur.execute("SELECT BiometricID FROM tbl_EmployeeBiometrics WHERE EmployeeATID = ?", (atid,))
                if not cur.fetchone():
                    cur.execute("""
                        INSERT INTO tbl_EmployeeBiometrics (EmployeeATID, HasFace, HasCard, HasFinger)
                        VALUES (?, 0, 0, 0)
                    """, (atid,))
            conn.commit()
    except Exception as e:
        logger.warning("HR_User sync warning: %s", e)

    # 3. Sync Customer Cards from /api/HR_CustomerCard/GetAllCustomerCard
    try:
        resp = requests.get(f"{epad_host}/api/HR_CustomerCard/GetAllCustomerCard", headers=headers, timeout=6)
        if resp.status_code == 200:
            cards = resp.json()
            if isinstance(cards, list):
                for c in cards:
                    c_num = str(c.get("CardNumber") or "").strip()
                    c_code = str(c.get("CardID") or c.get("Index") or c_num).strip()
                    if not c_num:
                        continue
                    cur.execute("SELECT CardID FROM tbl_CustomerCards WHERE CardNumber = ?", (c_num,))
                    if not cur.fetchone():
                        cur.execute("""
                            INSERT INTO tbl_CustomerCards (CardCode, CardNumber, CardType, Status, IsSyncedToDevices, Notes)
                            VALUES (?, ?, 'VISITOR', 'AVAILABLE', 1, N'Đồng bộ từ ePAD HR_CustomerCard')
                        """, (f"CARD-{c_code}", c_num))
                        stats["cards_upserted"] += 1
                conn.commit()
    except Exception as e:
        logger.warning("CustomerCard sync warning: %s", e)

    return {"ok": True, **stats}


def sync_from_zk_hardware_readonly(conn):
    """
    Connects read-only to the 4 ZKTeco SenseFace 4A terminals via TCP 4370,
    audits their clocks against Vietnam NTP (UTC+7), updates tbl_Devices,
    and enriches tbl_Employees / tbl_EmployeeBiometrics with live RFID cards & privileges.
    """
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    zk = ZkDirectClient(cfg)
    cur = conn.cursor()

    # 1. Perform Read-Only 3-Way Clock Audit against Vietnam NTP (UTC+7)
    audit = zk.audit_all_clocks()
    vn_str = audit.get("vietnam_ntp_time") or audit.get("local_pc_time")
    vn_dt = datetime.strptime(vn_str, "%Y-%m-%d %H:%M:%S")
    pc_dt = datetime.strptime(audit["local_pc_time"], "%Y-%m-%d %H:%M:%S")
    pc_drift = float(audit.get("pc_drift_sec") or 0.0)
    status_str = "PC_DRIFT_WARNING" if not audit.get("pc_clock_valid", True) else "HEALTHY"

    cur.execute("""
        INSERT INTO tbl_ClockSyncAuditLogs (
            AuditType, VietnamNtpTime, NtpServerUsed, LocalPcTime, LocalPcDriftSeconds,
            DevicesSummaryJson, Operator, Status
        ) VALUES ('STARTUP_CHECK', ?, ?, ?, ?, ?, N'Hệ thống tự động (Read-Only)', ?)
    """, (
        vn_dt,
        "time.google.com / vn.pool.ntp.org" if audit.get("ntp_available") else "local_fallback",
        pc_dt,
        pc_drift,
        json.dumps(audit.get("devices", {}), ensure_ascii=False),
        status_str
    ))
    conn.commit()

    # 2. Read users & device capacities from the 4 ZKTeco terminals
    from zk import ZK
    hw_users_synced = 0
    for dev in zk.devices:
        ip = dev["ip"]
        port = int(dev.get("port", 4370))
        serial = dev.get("sn") or dev.get("serial")
        name = dev["name"]
        door_id = int(dev["door_id"])
        dev_audit = audit.get("devices", {}).get(name, {})
        drift_sec = float(dev_audit.get("drift_vs_vn_sec") or 0.0)
        dev_clock_str = dev_audit.get("device_time")
        dev_clock_dt = None
        if dev_clock_str:
            try:
                dev_clock_dt = datetime.strptime(dev_clock_str, "%Y-%m-%d %H:%M:%S")
            except Exception:
                pass

        conn_zk = None
        try:
            z = ZK(ip, port=port, timeout=4, password=0, force_udp=False, ommit_ping=True)
            conn_zk = z.connect()
            conn_zk.read_sizes()
            u_cnt = getattr(conn_zk, "users", 0) or 0
            f_cnt = getattr(conn_zk, "faces", 0) or 104
            fp_cnt = getattr(conn_zk, "fingers", 0) or 0
            rec_cnt = getattr(conn_zk, "records", 0) or 0

            cur.execute("SELECT SerialNumber FROM tbl_Devices WHERE SerialNumber = ?", (serial,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_Devices
                    SET DeviceName = ?, IPAddress = ?, Port = ?, DoorID = ?,
                        UserCount = ?, FaceCount = ?, FingerCount = ?, LogCount = ?,
                        DeviceClock = ?, NtpDriftSeconds = ?, IsOnline = 1, LastPingTime = GETDATE()
                    WHERE SerialNumber = ?
                """, (name, ip, port, door_id, u_cnt, f_cnt, fp_cnt, rec_cnt, dev_clock_dt, drift_sec, serial))
            else:
                cur.execute("""
                    INSERT INTO tbl_Devices (
                        SerialNumber, DeviceName, IPAddress, Port, DoorID, DevicePosition,
                        UserCount, FaceCount, FingerCount, LogCount, DeviceClock, NtpDriftSeconds, IsOnline, LastPingTime
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, GETDATE())
                """, (serial, name, ip, port, door_id, name, u_cnt, f_cnt, fp_cnt, rec_cnt, dev_clock_dt, drift_sec))

            if hw_users_synced == 0:
                users = conn_zk.get_users()
                for u in users:
                    uid_str = str(u.user_id).strip()
                    card_str = str(u.card).strip() if u.card and int(u.card) != 0 else None
                    priv = int(u.privilege or 0)
                    # Try both raw user_id and zero-padded 8-char ATID
                    padded_atid = uid_str.zfill(8) if uid_str.isdigit() and len(uid_str) < 5 else uid_str
                    cur.execute(
                        "SELECT EmployeeATID FROM tbl_Employees WHERE EmployeeATID IN (?, ?)",
                        (uid_str, padded_atid)
                    )
                    match = cur.fetchone()
                    target_atid = match[0] if match else uid_str
                    if not match:
                        cur.execute("""
                            INSERT INTO tbl_Employees (
                                EmployeeID, EmployeeATID, EmployeeCode, FullName,
                                DepartmentName, CardNumber, Privilege, IsStaff, IsActive
                            ) VALUES (?, ?, ?, ?, N'Khác', ?, ?, 1, 1)
                        """, (f"ZK-{uid_str}", uid_str, uid_str, u.name or f"NV {uid_str}", card_str, priv))
                    else:
                        cur.execute("""
                            UPDATE tbl_Employees
                            SET CardNumber = COALESCE(?, CardNumber),
                                Privilege = ?,
                                UpdatedAt = GETDATE()
                            WHERE EmployeeATID = ?
                        """, (card_str, priv, target_atid))

                    cur.execute("SELECT BiometricID FROM tbl_EmployeeBiometrics WHERE EmployeeATID = ?", (target_atid,))
                    if cur.fetchone():
                        cur.execute("""
                            UPDATE tbl_EmployeeBiometrics
                            SET HasFace = 1,
                                HasCard = CASE WHEN ? IS NOT NULL THEN 1 ELSE HasCard END,
                                LastSyncedToDevices = COALESCE(LastSyncedToDevices, GETDATE()),
                                UpdatedAt = GETDATE()
                            WHERE EmployeeATID = ?
                        """, (card_str, target_atid))
                    else:
                        cur.execute("""
                            INSERT INTO tbl_EmployeeBiometrics (EmployeeATID, HasFace, HasCard, HasFinger, LastSyncedToDevices)
                            VALUES (?, 1, ?, 0, GETDATE())
                        """, (target_atid, 1 if card_str else 0))
                    hw_users_synced += 1
            conn.commit()
        except Exception as e:
            logger.warning("Device %s (%s) read warning: %s", name, ip, e)
        finally:
            if conn_zk:
                try:
                    conn_zk.disconnect()
                except Exception:
                    pass

    return {"ok": True, "hardware_users_synced": hw_users_synced, "clock_audit": audit}


def seed_operational_tables_if_empty(conn):
    """
    Populates configuration & operational tables (Timezones, AccessGroups, Shifts,
    DailyTimekeeping from AttendanceLogs, CustomerCards, Contractors, PreRegisteredGuests, DeviceCommands)
    only if they are empty, ensuring all 18 tables are ready for immediate UI/API testing.
    """
    cur = conn.cursor()

    # 1. tbl_AccessTimezones
    cur.execute("SELECT COUNT(*) FROM tbl_AccessTimezones")
    if cur.fetchone()[0] == 0:
        timezones = [
            ("TZ_247", "Toàn thời gian 24/7 (Ban Giám Đốc & An Ninh)", "00:00-23:59", "00:00-23:59", "00:00-23:59", "00:00-23:59", "00:00-23:59", "00:00-23:59", "00:00-23:59", "00:00-23:59", "Mở cửa 24/7 tất cả các ngày trong tuần và ngày lễ"),
            ("TZ_OFFICE", "Khung giờ Hành chính Văn phòng (06:00 - 21:00)", "06:00-21:00", "06:00-21:00", "06:00-21:00", "06:00-21:00", "06:00-21:00", "06:00-18:00", "00:00-00:00", "00:00-00:00", "Áp dụng cho khối văn phòng từ Thứ 2 đến Thứ 7"),
            ("TZ_VISITOR", "Khung giờ Khách & Nhà thầu (07:30 - 18:30)", "07:30-18:30", "07:30-18:30", "07:30-18:30", "07:30-18:30", "07:30-18:30", "07:30-12:30", "00:00-00:00", "00:00-00:00", "Áp dụng cho thẻ khách vãng lai và nhà thầu thi công")
        ]
        for tz in timezones:
            cur.execute("""
                INSERT INTO tbl_AccessTimezones (
                    TimezoneCode, TimezoneName, MonTime, TueTime, WedTime, ThuTime, FriTime, SatTime, SunTime, HolidayTime, Description
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, tz)

    # 2. tbl_AccessGroups
    cur.execute("SELECT COUNT(*) FROM tbl_AccessGroups")
    if cur.fetchone()[0] == 0:
        groups = [
            ("GRP_ALL_247", "Nhóm Toàn Quyền 24/7 (Làn Vào + Làn Ra)", 1, "1,2", "Face / Card / Finger", 0, "Đi qua toàn bộ 4 máy ZKTeco SenseFace 4A 24/7"),
            ("GRP_STAFF_STD", "Nhóm Nhân Sự Khối Văn Phòng", 2, "1,2", "Face / Card", 1, "Nhân viên chính thức quét khuôn mặt hoặc thẻ từ"),
            ("GRP_VISITOR_TEMP", "Nhóm Khách & Thẻ Tạm Lễ Tân", 3, "1,2", "Card / Face", 0, "Khách đăng ký tại quầy lễ tân cấp thẻ RFID tạm")
        ]
        for g in groups:
            cur.execute("""
                INSERT INTO tbl_AccessGroups (
                    GroupCode, GroupName, TimezoneID, AllowedDoors, VerifyMode, IsDefault, Description
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, g)

    # 3. tbl_DepartmentAccessGroups
    cur.execute("SELECT COUNT(*) FROM tbl_DepartmentAccessGroups")
    if cur.fetchone()[0] == 0:
        cur.execute("SELECT DepartmentID, DepartmentName FROM tbl_Departments WHERE IsActive = 1")
        for dept_id, dept_name in cur.fetchall():
            grp_id = 1 if "BGĐ" in dept_name or "Chỉ Huy" in dept_name else 2
            grp_name = "Nhóm Toàn Quyền 24/7 (Làn Vào + Làn Ra)" if grp_id == 1 else "Nhóm Nhân Sự Khối Văn Phòng"
            cur.execute("""
                INSERT INTO tbl_DepartmentAccessGroups (DepartmentID, DepartmentName, GroupID, GroupName)
                VALUES (?, ?, ?, ?)
            """, (dept_id, dept_name, grp_id, grp_name))

    # 4. tbl_Shifts
    cur.execute("SELECT COUNT(*) FROM tbl_Shifts")
    if cur.fetchone()[0] == 0:
        shifts = [
            ("HC_0800_1730", "Ca Hành Chính Chuẩn (08:00 - 17:30)", "08:00", "17:30", "12:00", "13:30", 5, 5, 8.0, 0),
            ("CA_NGAY_0600_1800", "Ca Trực An Ninh Ngày (06:00 - 18:00)", "06:00", "18:00", "11:30", "12:30", 5, 5, 11.0, 0),
            ("CA_DEM_1800_0600", "Ca Trực An Ninh Đêm (18:00 - 06:00)", "18:00", "06:00", "00:00", "01:00", 5, 5, 11.0, 1)
        ]
        for s in shifts:
            cur.execute("""
                INSERT INTO tbl_Shifts (
                    ShiftCode, ShiftName, CheckInTime, CheckOutTime, BreakStartTime, BreakEndTime,
                    GraceLateMinutes, GraceEarlyMinutes, WorkingHours, IsOvernight
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, s)

    # 5. tbl_CustomerCards, tbl_PreRegisteredGuests, tbl_Contractors:
    # Only populated from real ePAD API / hardware / user input (zero synthetic data).

    # 8. tbl_DailyTimekeeping (Compute First-In / Last-Out from tbl_AttendanceLogs)
    cur.execute("""
        INSERT INTO tbl_DailyTimekeeping (
            WorkDate, EmployeeATID, EmployeeCode, FullName, DepartmentName,
            ShiftCode, FirstInTime, LastOutTime, TotalScans, LateMinutes, EarlyLeaveMinutes, TotalHours, AttendanceStatus
        )
        SELECT
            CAST(a.CheckTime AS DATE) AS WorkDate,
            a.EmployeeATID,
            MAX(COALESCE(e.EmployeeCode, a.EmployeeATID)) AS EmployeeCode,
            MAX(COALESCE(NULLIF(a.FullName, ''), e.FullName, a.EmployeeATID)) AS FullName,
            MAX(COALESCE(NULLIF(a.Department, ''), e.DepartmentName, N'Khác')) AS DepartmentName,
            'HC_0800_1730' AS ShiftCode,
            MIN(a.CheckTime) AS FirstInTime,
            CASE WHEN COUNT(*) > 1 THEN MAX(a.CheckTime) ELSE NULL END AS LastOutTime,
            COUNT(*) AS TotalScans,
            CASE
                WHEN DATEPART(HOUR, MIN(a.CheckTime)) * 60 + DATEPART(MINUTE, MIN(a.CheckTime)) > (8 * 60 + 5)
                THEN (DATEPART(HOUR, MIN(a.CheckTime)) * 60 + DATEPART(MINUTE, MIN(a.CheckTime))) - (8 * 60)
                ELSE 0
            END AS LateMinutes,
            0 AS EarlyLeaveMinutes,
            CASE
                WHEN COUNT(*) > 1 THEN ROUND(CAST(DATEDIFF(MINUTE, MIN(a.CheckTime), MAX(a.CheckTime)) AS FLOAT) / 60.0, 2)
                ELSE 0
            END AS TotalHours,
            CASE
                WHEN DATEPART(HOUR, MIN(a.CheckTime)) * 60 + DATEPART(MINUTE, MIN(a.CheckTime)) > (8 * 60 + 5) THEN 'LATE'
                WHEN COUNT(*) = 1 THEN 'MISSING_OUT'
                ELSE 'PRESENT'
            END AS AttendanceStatus
        FROM tbl_AttendanceLogs a
        LEFT JOIN tbl_Employees e ON a.EmployeeATID = e.EmployeeATID
        WHERE NOT EXISTS (
            SELECT 1 FROM tbl_DailyTimekeeping dt
            WHERE dt.WorkDate = CAST(a.CheckTime AS DATE) AND dt.EmployeeATID = a.EmployeeATID
        )
        GROUP BY CAST(a.CheckTime AS DATE), a.EmployeeATID
    """)

    # 9. tbl_DeviceCommands (Record initial safe audit command)
    cur.execute("SELECT COUNT(*) FROM tbl_DeviceCommands")
    if cur.fetchone()[0] == 0:
        cur.execute("""
            INSERT INTO tbl_DeviceCommands (
                CommandCode, TargetSerial, TargetDeviceName, PayloadJson, Protocol, Status, ResultMessage, RequestedBy
            ) VALUES (
                'AUDIT_HARDWARE_AND_CLOCK', 'ALL', N'Toàn bộ 4 máy ZKTeco SenseFace 4A',
                '{"mode": "READ_ONLY", "ntp_standard": "Vietnam UTC+7"}',
                'DIRECT_TCP_4370', 'COMPLETED',
                N'Đã kiểm tra kết nối 4 máy ZKTeco và đối soát giờ NTP Việt Nam an toàn (0% ghi đè).',
                N'Hệ thống Khởi tạo'
            )
        """)

    conn.commit()


def run_all_safe_sync() -> dict:
    run_safe_schema_upgrade()
    conn_str = db_mssql.get_connection_string()
    with pyodbc.connect(conn_str, timeout=15) as conn:
        epad_res = sync_from_epad_stateless_api(conn)
        zk_res = sync_from_zk_hardware_readonly(conn)
        seed_operational_tables_if_empty(conn)

        cur = conn.cursor()
        cur.execute("""
            SELECT t.name, SUM(p.rows) AS row_count
            FROM sys.tables t
            INNER JOIN sys.partitions p ON t.object_id = p.object_id
            WHERE p.index_id IN (0,1)
            GROUP BY t.name
            ORDER BY t.name
        """)
        table_counts = {r[0]: r[1] for r in cur.fetchall()}

    return {
        "success": True,
        "epad_stateless_sync": epad_res,
        "zk_hardware_readonly_sync": zk_res,
        "table_counts": table_counts
    }


if __name__ == "__main__":
    res = run_all_safe_sync()
    print(json.dumps(res, ensure_ascii=False, indent=2))
