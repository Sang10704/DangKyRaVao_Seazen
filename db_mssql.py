"""
Microsoft SQL Server Connector & Data Access Layer for SeaZen Smart Access Control.
Provides high-performance, resilient connectivity to SQL Server via pyodbc.
Includes schema initialization, employee/biometrics sync, attendance logs, and door audit logs.
"""

import os
import re
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

try:
    import pyodbc
    PYODBC_AVAILABLE = True
except ImportError:
    pyodbc = None
    PYODBC_AVAILABLE = False

logger = logging.getLogger("db_mssql")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")


def load_db_config() -> Dict[str, Any]:
    """Load database configuration from config.json."""
    default_cfg = {
        "enabled": False,
        "server": "localhost\\SQLEXPRESS",
        "database": "SeaZen_AccessControl",
        "driver": "ODBC Driver 18 for SQL Server",
        "trusted_connection": True,
        "username": "",
        "password": "",
        "trust_server_certificate": True,
        "connection_timeout": 5
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                return cfg.get("database", default_cfg)
        except Exception as e:
            logger.warning("Failed to load config.json for database: %s", e)
    return default_cfg


def get_connection_string(custom_db: Optional[str] = None) -> str:
    """Construct ODBC connection string based on config."""
    cfg = load_db_config()
    server = cfg.get("server", "localhost\\SQLEXPRESS")
    database = custom_db if custom_db is not None else cfg.get("database", "SeaZen_AccessControl")
    driver = cfg.get("driver", "ODBC Driver 18 for SQL Server")
    timeout = cfg.get("connection_timeout", 5)

    if PYODBC_AVAILABLE:
        installed_drivers = pyodbc.drivers()
        if driver not in installed_drivers:
            for d in ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server"]:
                if d in installed_drivers:
                    driver = d
                    break

    parts = [
        f"DRIVER={{{driver}}}",
        f"SERVER={server}",
        f"Timeout={timeout}"
    ]

    if database:
        parts.append(f"DATABASE={database}")

    if cfg.get("trusted_connection", True):
        parts.append("Trusted_Connection=yes")
    else:
        parts.append(f"UID={cfg.get('username', 'sa')}")
        parts.append(f"PWD={cfg.get('password', '')}")

    if cfg.get("trust_server_certificate", True):
        parts.append("TrustServerCertificate=yes")

    return ";".join(parts) + ";"


def test_connection() -> Dict[str, Any]:
    """Test SQL Server connectivity and return server version and database status."""
    if not PYODBC_AVAILABLE:
        return {"ok": False, "message": "pyodbc module is not installed."}

    cfg = load_db_config()
    server = cfg.get("server", "localhost\\SQLEXPRESS")
    target_db = cfg.get("database", "SeaZen_AccessControl")

    try:
        conn_str_master = get_connection_string(custom_db="master")
        with pyodbc.connect(conn_str_master, autocommit=True, timeout=5) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT @@VERSION AS Version, @@SERVERNAME AS ServerName")
            row = cursor.fetchone()
            version_str = row[0] if row else "Unknown"
            server_name = row[1] if row else server

            cursor.execute("SELECT database_id FROM sys.databases WHERE name = ?", (target_db,))
            db_row = cursor.fetchone()
            db_exists = db_row is not None

            employee_count = 0
            log_count = 0
            if db_exists:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM [{target_db}].[dbo].[tbl_Employees]")
                    emp_row = cursor.fetchone()
                    employee_count = emp_row[0] if emp_row else 0

                    cursor.execute(f"SELECT COUNT(*) FROM [{target_db}].[dbo].[tbl_AttendanceLogs]")
                    log_row = cursor.fetchone()
                    log_count = log_row[0] if log_row else 0
                except Exception:
                    pass

            return {
                "ok": True,
                "server": server_name,
                "version": version_str.split("\n")[0],
                "database": target_db,
                "database_exists": db_exists,
                "employee_count": employee_count,
                "log_count": log_count,
                "message": "Connected successfully to SQL Server."
            }
    except Exception as e:
        return {
            "ok": False,
            "server": server,
            "database": target_db,
            "message": str(e)
        }


def execute_sql_script(script_path: str, target_db: Optional[str] = None) -> Tuple[bool, str]:
    """Execute a large .sql script containing GO delimiters against SQL Server."""
    if not PYODBC_AVAILABLE:
        return False, "pyodbc is not installed"

    if not os.path.exists(script_path):
        return False, f"File not found: {script_path}"

    try:
        with open(script_path, "r", encoding="utf-8") as f:
            full_sql = f.read()

        conn_str = get_connection_string(custom_db=target_db or "master")
        with pyodbc.connect(conn_str, autocommit=True, timeout=30) as conn:
            cursor = conn.cursor()
            batches = re.split(r'^\s*GO\s*$', full_sql, flags=re.MULTILINE | re.IGNORECASE)
            total_batches = len(batches)
            executed = 0

            for i, batch in enumerate(batches):
                cleaned = batch.strip()
                if not cleaned:
                    continue
                try:
                    cursor.execute(cleaned)
                    executed += 1
                except Exception as ex:
                    return False, f"Error in batch {i+1}/{total_batches}: {str(ex)}"

            return True, f"Successfully executed {executed} batches from {os.path.basename(script_path)}"
    except Exception as e:
        return False, str(e)


def is_mssql_active() -> bool:
    cfg = load_db_config()
    return cfg.get("enabled", False) and PYODBC_AVAILABLE


_EXTENDED_SCHEMA_READY = False


def ensure_extended_schema() -> None:
    """Idempotently ensures optional columns exist without data loss."""
    global _EXTENDED_SCHEMA_READY
    if _EXTENDED_SCHEMA_READY or not is_mssql_active():
        return
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                IF COL_LENGTH('tbl_Visitors', 'ParentVisitorID') IS NULL
                    ALTER TABLE tbl_Visitors ADD ParentVisitorID NVARCHAR(50) NULL;
                IF COL_LENGTH('tbl_Visitors', 'ParentVisitorName') IS NULL
                    ALTER TABLE tbl_Visitors ADD ParentVisitorName NVARCHAR(255) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'CardName') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD CardName NVARCHAR(100) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'CardPhotoBase64') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD CardPhotoBase64 NVARCHAR(MAX) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'EvidenceStatus') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD EvidenceStatus NVARCHAR(50) DEFAULT 'PENDING_PHOTO';
                IF COL_LENGTH('tbl_CustomerCards', 'AutoDetectedAt') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD AutoDetectedAt DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'DetectedBy') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD DetectedBy NVARCHAR(100) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'VerifiedBy') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD VerifiedBy NVARCHAR(100) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'VerifiedAt') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD VerifiedAt DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastHolderName') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastHolderName NVARCHAR(255) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastHolderCCCD') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastHolderCCCD NVARCHAR(50) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastHolderPhone') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastHolderPhone NVARCHAR(50) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastHolderCompany') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastHolderCompany NVARCHAR(255) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastContactPerson') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastContactPerson NVARCHAR(255) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastContactPhone') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastContactPhone NVARCHAR(50) NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastAssignedAt') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastAssignedAt DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastGateOutAt') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastGateOutAt DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'LastReturnedAt') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD LastReturnedAt DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'ValidFrom') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD ValidFrom DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'ValidTo') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD ValidTo DATETIME NULL;
                IF COL_LENGTH('tbl_CustomerCards', 'DeviceSyncState') IS NULL
                    ALTER TABLE tbl_CustomerCards ADD DeviceSyncState NVARCHAR(50) NULL;
                IF OBJECT_ID(N'tbl_CardHistory', N'U') IS NULL
                BEGIN
                    CREATE TABLE tbl_CardHistory (
                        HistoryID INT IDENTITY(1,1) PRIMARY KEY,
                        CardID INT NULL,
                        CardNumber NVARCHAR(50) NOT NULL,
                        EventType NVARCHAR(50) NOT NULL,
                        HolderName NVARCHAR(255) NULL,
                        HolderCCCD NVARCHAR(50) NULL,
                        HolderPhone NVARCHAR(50) NULL,
                        ContactPerson NVARCHAR(255) NULL,
                        ContactPhone NVARCHAR(50) NULL,
                        EventTime DATETIME DEFAULT GETDATE(),
                        Operator NVARCHAR(100) NULL,
                        Notes NVARCHAR(500) NULL
                    );
                    CREATE INDEX IX_CardHistory_CardNumber ON tbl_CardHistory(CardNumber, EventTime DESC);
                END
            """)
            conn.commit()
            _EXTENDED_SCHEMA_READY = True
    except Exception as e:
        logger.debug("ensure_extended_schema warning: %s", e)


def get_departments() -> List[Dict[str, Any]]:
    if not is_mssql_active():
        return []
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT d.DepartmentID, d.DepartmentCode, d.DepartmentName, d.ParentID, d.Level,
                       d.Location, d.Description, d.IsActive,
                       (
                           SELECT COUNT(*)
                           FROM tbl_Employees e
                           WHERE e.IsStaff = 1 AND e.IsActive = 1
                             AND (e.DepartmentID = d.DepartmentID OR e.DepartmentName = d.DepartmentName)
                       ) AS StaffCount
                FROM tbl_Departments d
                WHERE d.IsActive = 1
                ORDER BY d.Level ASC, d.DepartmentName ASC
            """)
            columns = [col[0] for col in cursor.description]
            results = []
            for row in cursor.fetchall():
                results.append(dict(zip(columns, row)))
            return results
    except Exception as e:
        logger.error("MSSQL get_departments error: %s", e)
        return []


def get_employees(q: str = "", department: str = "", page: int = 1, limit: int = 50, include_inactive: bool = False) -> Dict[str, Any]:
    if not is_mssql_active():
        return {"items": [], "total": 0, "page": page, "limit": limit}

    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=5) as conn:
            cursor = conn.cursor()
            where_clauses = [
                "e.IsStaff = 1",
                "e.DepartmentName IS NOT NULL",
                "e.DepartmentName <> ''",
                "e.DepartmentName <> N'Khác'"
            ]
            if not include_inactive:
                where_clauses.append("e.IsActive = 1")
            params: List[Any] = []

            if q:
                search_term = f"%{q.strip()}%"
                where_clauses.append("(e.EmployeeATID LIKE ? OR e.EmployeeCode LIKE ? OR e.FullName LIKE ? OR e.CardNumber LIKE ? OR e.Phone LIKE ? OR e.Email LIKE ? OR e.Position LIKE ?)")
                params.extend([search_term, search_term, search_term, search_term, search_term, search_term, search_term])

            if department:
                where_clauses.append("(e.DepartmentName = ? OR d.DepartmentName = ?)")
                params.extend([department, department])

            where_sql = " AND ".join(where_clauses)

            count_sql = f"SELECT COUNT(*) FROM tbl_Employees e LEFT JOIN tbl_Departments d ON e.DepartmentID = d.DepartmentID WHERE {where_sql}"
            cursor.execute(count_sql, params)
            total = cursor.fetchone()[0]

            offset = max(0, (page - 1) * limit)
            paged_params = list(params)
            paged_params.extend([offset, limit])

            query_sql = f"""
                SELECT 
                    e.EmployeeID, e.EmployeeATID, e.EmployeeCode, e.FullName,
                    e.DepartmentID, e.DepartmentName, e.Position, e.CardNumber,
                    e.Privilege, e.Gender, e.Email, e.Phone, e.JoinedDate, e.IsStaff, e.IsActive,
                    b.HasFace, b.HasCard, b.HasFinger, b.FingerCount, b.FaceVersion,
                    b.LastSyncedToDevices, b.FacePhotoBase64,
                    logs.LastScanTime, logs.LastVerifyMode
                FROM tbl_Employees e
                LEFT JOIN tbl_Departments d ON e.DepartmentID = d.DepartmentID
                LEFT JOIN tbl_EmployeeBiometrics b ON e.EmployeeATID = b.EmployeeATID
                OUTER APPLY (
                    SELECT TOP 1 CheckTime AS LastScanTime, VerifyMode AS LastVerifyMode
                    FROM tbl_AttendanceLogs al
                    WHERE al.EmployeeATID = e.EmployeeATID
                    ORDER BY al.CheckTime DESC
                ) logs
                WHERE {where_sql}
                ORDER BY e.IsActive DESC, e.FullName ASC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """
            cursor.execute(query_sql, paged_params)
            columns = [col[0] for col in cursor.description]
            items = []
            for row in cursor.fetchall():
                row_dict = dict(zip(columns, row))
                last_scan = row_dict.get("LastScanTime")
                last_synced = row_dict.get("LastSyncedToDevices")
                joined = row_dict.get("JoinedDate")
                items.append({
                    "EmployeeID": row_dict["EmployeeID"],
                    "EmployeeATID": row_dict["EmployeeATID"],
                    "EmployeeCode": row_dict["EmployeeCode"] or row_dict["EmployeeATID"],
                    "FullName": row_dict["FullName"],
                    "DepartmentName": row_dict["DepartmentName"] or "Khác",
                    "DepartmentID": row_dict["DepartmentID"],
                    "Position": row_dict["Position"] or "",
                    "CardNumber": row_dict["CardNumber"] or "",
                    "Privilege": int(row_dict.get("Privilege") or 0),
                    "Gender": row_dict.get("Gender") or "",
                    "Email": row_dict["Email"] or "",
                    "Phone": row_dict["Phone"] or "",
                    "JoinedDate": joined.strftime("%Y-%m-%d") if joined else "",
                    "IsStaff": bool(row_dict["IsStaff"]),
                    "IsActive": bool(row_dict["IsActive"]),
                    "HasFace": bool(row_dict["HasFace"]),
                    "HasCard": bool(row_dict["CardNumber"] or row_dict["HasCard"]),
                    "HasFinger": bool(row_dict["HasFinger"]),
                    "FingerCount": int(row_dict.get("FingerCount") or 0),
                    "FaceVersion": row_dict.get("FaceVersion") or "ZKTeco_VisibleLight_v58.12",
                    "LastSyncedToDevices": last_synced.strftime("%Y-%m-%d %H:%M:%S") if last_synced else "",
                    "LastScanTime": last_scan.strftime("%Y-%m-%d %H:%M:%S") if last_scan else "",
                    "LastVerifyMode": row_dict.get("LastVerifyMode") or "",
                    "FaceImageBase64": row_dict["FacePhotoBase64"] if row_dict.get("FacePhotoBase64") else None
                })

            return {"items": items, "total": total, "page": page, "limit": limit}
    except Exception as e:
        logger.error("MSSQL get_employees error: %s", e)
        return {"items": [], "total": 0, "page": page, "limit": limit}


def get_latest_attendance_time() -> Optional[datetime]:
    """Returns the latest CheckTime recorded in tbl_AttendanceLogs."""
    if not is_mssql_active():
        return None
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=3) as conn:
            cur = conn.cursor()
            cur.execute("SELECT MAX(CheckTime) FROM tbl_AttendanceLogs")
            row = cur.fetchone()
            return row[0] if row and row[0] else None
    except Exception as e:
        logger.error("MSSQL get_latest_attendance_time error: %s", e)
        return None


def insert_attendance_log(scan: Dict[str, Any]) -> bool:
    """Inserts a single attendance log safely into tbl_AttendanceLogs."""
    return insert_attendance_logs_bulk([scan]) > 0


def insert_attendance_logs_bulk(scans: List[Dict[str, Any]]) -> int:
    """
    Inserts a list of attendance logs into tbl_AttendanceLogs safely,
    ignoring records that already exist by (EmployeeATID, CheckTime, DeviceSerialNumber).
    Returns count of newly inserted records.
    """
    if not is_mssql_active() or not scans:
        return 0
    inserted = 0
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=5) as conn:
            cursor = conn.cursor()
            for scan in scans:
                atid = str(scan.get("EmployeeATID") or scan.get("UserEnrollNumber") or scan.get("ATID") or "").strip()
                if not atid:
                    continue
                time_str = str(scan.get("CheckTime") or scan.get("Time") or "").strip()
                try:
                    dt_obj = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    try:
                        dt_obj = datetime.fromisoformat(time_str)
                    except Exception:
                        dt_obj = datetime.now()

                device_sn = str(scan.get("SerialNumber") or scan.get("DeviceSerialNumber") or "").strip()
                device_name = str(scan.get("DeviceName") or "").strip()
                full_name = str(scan.get("FullName") or scan.get("fullname") or "").strip()
                dept = str(scan.get("Department") or "").strip()
                verify_mode = str(scan.get("VerifyMode") or "FaceTemplate")
                raw_vval = scan.get("VerifyModeValue")
                verify_val = int(raw_vval) if str(raw_vval or "").isdigit() else (2 if "card" in verify_mode.lower() else 15)
                raw_io = scan.get("InOutMode", 0)
                if isinstance(raw_io, int):
                    in_out = raw_io
                elif str(raw_io).isdigit():
                    in_out = int(raw_io)
                else:
                    in_out = 0 if str(raw_io).strip().lower() in ("in", "vào", "0", "") else 1
                is_staff = 1 if (scan.get("is_staff", True) and not str(atid).startswith("8000")) else 0
                sync_source = str(scan.get("SyncSource") or "ADMS_PUSH_BRIDGE")

                direction = str(scan.get("Direction") or ("IN" if "vào" in device_name.lower() else "OUT"))

                cursor.execute("""
                    IF NOT EXISTS (
                        SELECT 1 FROM tbl_AttendanceLogs 
                        WHERE EmployeeATID = ? AND CheckTime = ? AND DeviceSerialNumber = ?
                    )
                    BEGIN
                        INSERT INTO tbl_AttendanceLogs (
                            EmployeeATID, FullName, Department, DeviceSerialNumber, DeviceName,
                            CheckTime, VerifyMode, VerifyModeValue, InOutMode, IsStaff, SyncSource
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    END
                """, (
                    atid, dt_obj, device_sn,
                    atid, full_name, dept, device_sn, device_name,
                    dt_obj, verify_mode, verify_val, in_out, is_staff, sync_source
                ))
                if cursor.rowcount > 0:
                    inserted += 1
                    # Also upsert daily timekeeping summary row for staff
                    if is_staff:
                        try:
                            work_date = dt_obj.date()
                            cursor.execute("""
                                IF NOT EXISTS (
                                    SELECT 1 FROM tbl_DailyTimekeeping
                                    WHERE WorkDate = ? AND EmployeeATID = ?
                                )
                                BEGIN
                                    INSERT INTO tbl_DailyTimekeeping (
                                        WorkDate, EmployeeATID, EmployeeCode, FullName, DepartmentName,
                                        ShiftCode, FirstInTime, LastOutTime, TotalScans, LateMinutes, EarlyLeaveMinutes, TotalHours, AttendanceStatus
                                    ) VALUES (
                                        ?, ?, ?, ?, ?, 'HC_0745_1645', ?, NULL, 1,
                                        CASE WHEN (? * 60 + ?) > (7 * 60 + 45) THEN (? * 60 + ?) - (7 * 60 + 45) ELSE 0 END,
                                        0, 0,
                                        CASE WHEN (? * 60 + ?) > (7 * 60 + 45) THEN 'LATE' ELSE 'MISSING_OUT' END
                                    )
                                END
                                ELSE
                                BEGIN
                                    UPDATE tbl_DailyTimekeeping
                                    SET FirstInTime = CASE WHEN ? < FirstInTime THEN ? ELSE FirstInTime END,
                                        LastOutTime = CASE WHEN ? > FirstInTime THEN ? ELSE LastOutTime END,
                                        TotalScans = TotalScans + 1,
                                        TotalHours = CASE
                                            WHEN ? > FirstInTime THEN ROUND(CAST(DATEDIFF(MINUTE, FirstInTime, ?) AS FLOAT) / 60.0, 2)
                                            ELSE TotalHours
                                        END,
                                        AttendanceStatus = CASE
                                            WHEN LateMinutes > 0 THEN 'LATE'
                                            WHEN ? > FirstInTime THEN 'PRESENT'
                                            ELSE AttendanceStatus
                                        END,
                                        UpdatedAt = GETDATE()
                                    WHERE WorkDate = ? AND EmployeeATID = ?
                                END
                            """, (
                                work_date, atid,
                                work_date, atid, atid, full_name or f"Nhân sự {atid}", dept or "Nhân sự SeaZen", dt_obj,
                                dt_obj.hour, dt_obj.minute, dt_obj.hour, dt_obj.minute,
                                dt_obj.hour, dt_obj.minute,
                                dt_obj, dt_obj, dt_obj, dt_obj, dt_obj, dt_obj, dt_obj,
                                work_date, atid
                            ))
                        except Exception as tk_err:
                            logger.debug("DailyTimekeeping upsert warning: %s", tk_err)
            conn.commit()
    except Exception as e:
        logger.error("MSSQL insert_attendance_logs_bulk error: %s", e)
    return inserted


def get_attendance_logs_by_date_db(date_str: str, limit: int = 1000) -> List[Dict[str, Any]]:
    """Fetches attendance logs for a specific YYYY-MM-DD date from tbl_AttendanceLogs."""
    if not is_mssql_active():
        return []
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT TOP ({int(limit)})
                    EmployeeATID, FullName, Department, DeviceSerialNumber, DeviceName,
                    CheckTime, VerifyMode, VerifyModeValue, InOutMode, IsStaff, SyncSource
                FROM tbl_AttendanceLogs
                WHERE CAST(CheckTime AS DATE) = ?
                ORDER BY CheckTime DESC
            """, (date_str,))
            cols = [c[0] for c in cursor.description]
            out = []
            for row in cursor.fetchall():
                d = dict(zip(cols, row))
                chk = d["CheckTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckTime") else ""
                dev_name = str(d.get("DeviceName") or "")
                out.append({
                    "EmployeeATID": str(d.get("EmployeeATID") or ""),
                    "FullName": str(d.get("FullName") or ""),
                    "Department": str(d.get("Department") or ""),
                    "SerialNumber": str(d.get("DeviceSerialNumber") or ""),
                    "DeviceSerialNumber": str(d.get("DeviceSerialNumber") or ""),
                    "DeviceName": dev_name,
                    "Direction": "IN" if "vào" in dev_name.lower() else "OUT",
                    "CheckTime": chk,
                    "Time": chk,
                    "VerifyMode": str(d.get("VerifyMode") or "FaceTemplate"),
                    "VerifyModeValue": d.get("VerifyModeValue"),
                    "InOutMode": d.get("InOutMode", 0),
                    "is_staff": bool(d.get("IsStaff", True)),
                    "SyncSource": str(d.get("SyncSource") or "DIRECT_TCP")
                })
            return out
    except Exception as e:
        logger.debug("MSSQL get_attendance_logs_by_date_db error: %s", e)
        return []


def insert_door_action(action: Dict[str, Any]) -> bool:
    if not is_mssql_active():
        return False
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=3) as conn:
            cursor = conn.cursor()
            time_str = action.get("time") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            try:
                dt_obj = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
            except Exception:
                dt_obj = datetime.now()

            cursor.execute("""
                INSERT INTO tbl_DoorAuditLogs (
                    DoorID, DoorName, Action, DurationSec, Operator, Success, ErrorMessage, CreatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                int(action.get("door_id") or 1),
                action.get("door_name") or "",
                action.get("action") or "UNLOCK",
                int(action.get("duration_sec") or 1),
                action.get("operator") or action.get("user") or "Lễ tân",
                1 if action.get("success", True) else 0,
                action.get("error_message") or action.get("message") or "",
                dt_obj
            ))
            conn.commit()
            return True
    except Exception as e:
        logger.error("MSSQL insert_door_action error: %s", e)
        return False


# ---------------- Visitor Management Operations ----------------

def get_active_visitors_db() -> List[Dict[str, Any]]:
    if not is_mssql_active():
        return []
    try:
        ensure_extended_schema()
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                       HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, CheckoutTime,
                       DurationMinutes, Status, Operator, Phone, BirthDate,
                       ParentVisitorID, ParentVisitorName
                FROM tbl_Visitors
                WHERE Status = 'ACTIVE'
                ORDER BY CheckinTime DESC
            """)
            cols = [col[0] for col in cursor.description]
            items = []
            for row in cursor.fetchall():
                d = dict(zip(cols, row))
                cin_time = d["CheckinTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckinTime") else ""
                exp_time = d["ExpectedCheckoutTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("ExpectedCheckoutTime") else ""
                items.append({
                    "id": d["VisitorID"],
                    "full_name": d["FullName"] or "Khách",
                    "cccd_number": d["CCCDNumber"] or "",
                    "birth_date": d.get("BirthDate") or "",
                    "phone": d.get("Phone") or "",
                    "card_number": d["CardNumber"] or "",
                    "company": d["Company"] or "",
                    "department": d["Department"] or "",
                    "host_person": d["HostPerson"] or "",
                    "purpose": d["Purpose"] or "",
                    "checkin_time": cin_time,
                    "expected_checkout_time": exp_time,
                    "status": "ACTIVE",
                    "operator": d["Operator"] or "Bảo vệ",
                    "parent_visitor_id": d.get("ParentVisitorID") or "",
                    "parent_visitor_name": d.get("ParentVisitorName") or ""
                })
            return items
    except Exception as e:
        logger.error("MSSQL get_active_visitors_db error: %s", e)
        return []


def insert_visitor_db(v: Dict[str, Any]) -> bool:
    if not is_mssql_active():
        return False
    try:
        ensure_extended_schema()
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            v_id = str(v.get("id") or "")[:50]
            cin = v.get("checkin_time")
            try:
                cin_dt = datetime.strptime(cin, "%Y-%m-%d %H:%M:%S") if cin else datetime.now()
            except Exception:
                cin_dt = datetime.now()

            exp_cout = v.get("expected_checkout_time")
            try:
                exp_dt = datetime.strptime(exp_cout, "%Y-%m-%d %H:%M:%S") if exp_cout else None
            except Exception:
                exp_dt = None

            parent_id = str(v.get("parent_visitor_id") or "")[:50] or None
            parent_name = str(v.get("parent_visitor_name") or "")[:255] or None
            status_val = str(v.get("status") or "ACTIVE").strip().upper()[:50]

            cursor.execute("SELECT Status FROM tbl_Visitors WHERE VisitorID = ?", (v_id,))
            existing_row = cursor.fetchone()
            existing_status = str(existing_row[0] or "").strip().upper() if existing_row else ""

            if existing_row and existing_status != "ACTIVE" and status_val == "ACTIVE":
                # Hardware slot reuse (e.g. 562xx): archive previous checked-out/pending row
                # so history is preserved and stale ParentVisitorID/CheckoutTime never leak.
                arch_suffix = datetime.now().strftime("%Y%m%d%H%M%S%f")[:18]
                arch_id = f"{v_id[:30]}_h_{arch_suffix}"[:50]
                cursor.execute(
                    "UPDATE tbl_Visitors SET VisitorID = ? WHERE VisitorID = ?",
                    (arch_id, v_id),
                )
                existing_row = None

            if not existing_row:
                cursor.execute("""
                    INSERT INTO tbl_Visitors (
                        VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                        HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, CheckoutTime,
                        DurationMinutes, Status, Operator, Phone, BirthDate,
                        ParentVisitorID, ParentVisitorName
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
                """, (
                    v_id, v.get("full_name") or "Khách", v.get("cccd_number") or "",
                    v.get("card_number") or "", v.get("company") or "", v.get("department") or "",
                    v.get("host_person") or "", v.get("purpose") or "", cin_dt, exp_dt, status_val,
                    v.get("operator") or "Bảo vệ", v.get("phone") or "", v.get("birth_date") or "",
                    parent_id, parent_name,
                ))
            else:
                cursor.execute("""
                    UPDATE tbl_Visitors
                    SET FullName = ?, CCCDNumber = ?, CardNumber = ?, Company = ?, Department = ?,
                        HostPerson = ?, Purpose = ?, CheckinTime = ?, ExpectedCheckoutTime = ?, Status = ?,
                        Operator = COALESCE(NULLIF(?, ''), Operator),
                        Phone = COALESCE(NULLIF(?, ''), Phone),
                        BirthDate = COALESCE(NULLIF(?, ''), BirthDate),
                        ParentVisitorID = ?,
                        ParentVisitorName = ?,
                        CheckoutTime = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE CheckoutTime END,
                        DurationMinutes = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE DurationMinutes END
                    WHERE VisitorID = ?
                """, (
                    v.get("full_name") or "Khách", v.get("cccd_number") or "",
                    v.get("card_number") or "", v.get("company") or "", v.get("department") or "",
                    v.get("host_person") or "", v.get("purpose") or "", cin_dt, exp_dt, status_val,
                    v.get("operator") or "",
                    v.get("phone") or "", v.get("birth_date") or "",
                    parent_id, parent_name,
                    status_val, status_val,
                    v_id,
                ))
            conn.commit()
            return True
    except Exception as e:
        logger.error("MSSQL insert_visitor_db error: %s", e)
        return False


def get_pending_visitors_db() -> List[Dict[str, Any]]:
    if not is_mssql_active():
        return []
    try:
        ensure_extended_schema()
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                       HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, Status, Operator, Phone, BirthDate,
                       ParentVisitorID, ParentVisitorName
                FROM tbl_Visitors
                WHERE Status = 'PENDING'
                ORDER BY CheckinTime ASC, CreatedAt DESC
            """)
            cols = [col[0] for col in cursor.description]
            items = []
            for row in cursor.fetchall():
                d = dict(zip(cols, row))
                cin_time = d["CheckinTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckinTime") else ""
                exp_time = d["ExpectedCheckoutTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("ExpectedCheckoutTime") else ""
                items.append({
                    "id": d["VisitorID"],
                    "full_name": d["FullName"] or "Khách",
                    "cccd_number": d["CCCDNumber"] or "",
                    "birth_date": d.get("BirthDate") or "",
                    "phone": d.get("Phone") or "",
                    "card_number": d["CardNumber"] or "",
                    "company": d["Company"] or "",
                    "department": d["Department"] or "",
                    "host_person": d["HostPerson"] or "",
                    "purpose": d["Purpose"] or "",
                    "checkin_time": cin_time,
                    "expected_checkout_time": exp_time,
                    "status": "PENDING",
                    "operator": d["Operator"] or "Phòng ban",
                    "parent_visitor_id": d.get("ParentVisitorID") or "",
                    "parent_visitor_name": d.get("ParentVisitorName") or "",
                })
            return items
    except Exception as e:
        logger.error("MSSQL get_pending_visitors_db error: %s", e)
        return []


def activate_pending_visitor_db(old_visitor_id: str, new_visitor_id: str, card_number: str, operator: str = "Lễ tân") -> bool:
    if not is_mssql_active():
        return False
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            old_id = str(old_visitor_id)[:50]
            new_id = str(new_visitor_id or old_visitor_id)[:50]
            # If ZKTeco reused an ATID that already exists in tbl_Visitors (from a past CHECKED_OUT visitor),
            # rename the historical row's VisitorID so we preserve history and avoid a PK collision.
            if new_id != old_id:
                cur.execute("SELECT Status FROM tbl_Visitors WHERE VisitorID = ?", (new_id,))
                existing = cur.fetchone()
                if existing:
                    archived_id = f"{new_id}_old_{int(datetime.now().timestamp())}"[:50]
                    cur.execute("UPDATE tbl_Visitors SET VisitorID = ? WHERE VisitorID = ?", (archived_id, new_id))
                    cur.execute("UPDATE tbl_Visitors SET ParentVisitorID = ? WHERE ParentVisitorID = ?", (archived_id, new_id))

            cur.execute("""
                UPDATE tbl_Visitors
                SET VisitorID = ?,
                    CardNumber = ?,
                    Status = 'ACTIVE',
                    Operator = ?
                WHERE VisitorID = ? AND Status = 'PENDING'
            """, (new_id, str(card_number or "")[:50], str(operator or "Lễ tân")[:100], old_id))
            updated = cur.rowcount > 0
            if updated:
                # Activate any pending companions attached to this lead appointment so they move
                # into the lead visitor's active group instead of staying stuck in PENDING.
                cur.execute("""
                    UPDATE tbl_Visitors
                    SET ParentVisitorID = ?,
                        Status = 'ACTIVE',
                        Operator = ?
                    WHERE ParentVisitorID = ? AND Status = 'PENDING'
                """, (new_id, str(operator or "Lễ tân")[:100], old_id))
            conn.commit()
            return updated
    except Exception as e:
        logger.error("MSSQL activate_pending_visitor_db error: %s", e)
        return False


def delete_pending_visitor_db(visitor_id: str) -> bool:
    if not is_mssql_active():
        return False
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM tbl_Visitors WHERE (VisitorID = ? OR ParentVisitorID = ?) AND Status = 'PENDING'", (str(visitor_id)[:50], str(visitor_id)[:50]))
            conn.commit()
            return cur.rowcount > 0
    except Exception as e:
        logger.error("MSSQL delete_pending_visitor_db error: %s", e)
        return False


def swap_visitor_card_db(visitor_id: str, old_card: str, new_card: str, new_visitor_id: Optional[str] = None) -> bool:
    if not is_mssql_active():
        return False
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            if new_visitor_id and str(new_visitor_id) != str(visitor_id):
                cur.execute("""
                    UPDATE tbl_Visitors
                    SET VisitorID = ?, CardNumber = ?
                    WHERE (VisitorID = ? OR CardNumber = ?) AND Status = 'ACTIVE'
                """, (str(new_visitor_id)[:50], str(new_card)[:50], str(visitor_id)[:50], str(old_card)[:50]))
            else:
                cur.execute("""
                    UPDATE tbl_Visitors
                    SET CardNumber = ?
                    WHERE (VisitorID = ? OR CardNumber = ?) AND Status = 'ACTIVE'
                """, (str(new_card)[:50], str(visitor_id)[:50], str(old_card)[:50]))
            conn.commit()
            return cur.rowcount > 0
    except Exception as e:
        logger.error("MSSQL swap_visitor_card_db error: %s", e)
        return False


def checkout_visitor_db(query_key: str, checkout_time_str: Optional[str] = None) -> bool:
    if not is_mssql_active():
        return False
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            try:
                cout_dt = datetime.strptime(checkout_time_str, "%Y-%m-%d %H:%M:%S") if checkout_time_str else datetime.now()
            except Exception:
                cout_dt = datetime.now()

            q = str(query_key).strip()
            clean_q = q.lstrip("0")
            cursor.execute("""
                UPDATE tbl_Visitors
                SET Status = 'CHECKED_OUT', CheckoutTime = ?
                WHERE Status = 'ACTIVE' AND (
                    VisitorID = ? OR CardNumber = ? OR CardNumber = ? OR CCCDNumber = ?
                )
            """, (cout_dt, q, q, clean_q, q))
            conn.commit()
            return cursor.rowcount > 0
    except Exception as e:
        logger.error("MSSQL checkout_visitor_db error: %s", e)
        return False


def get_visitor_history_db(limit: int = 200) -> List[Dict[str, Any]]:
    if not is_mssql_active():
        return []
    try:
        ensure_extended_schema()
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT TOP ({limit}) VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                       HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, CheckoutTime,
                       DurationMinutes, Status, Operator, Phone, BirthDate,
                       ParentVisitorID, ParentVisitorName
                FROM tbl_Visitors
                ORDER BY CheckinTime DESC
            """)
            cols = [col[0] for col in cursor.description]
            items = []
            for row in cursor.fetchall():
                d = dict(zip(cols, row))
                cin_time = d["CheckinTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckinTime") else ""
                exp_time = d["ExpectedCheckoutTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("ExpectedCheckoutTime") else ""
                cout_time = d["CheckoutTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckoutTime") else ""
                
                # Duration string
                duration_str = "--"
                if d.get("CheckinTime") and d.get("CheckoutTime"):
                    mins = int((d["CheckoutTime"] - d["CheckinTime"]).total_seconds() / 60)
                    hrs, rm = divmod(max(0, mins), 60)
                    duration_str = f"{hrs}g {rm}p" if hrs > 0 else f"{rm} phút"

                items.append({
                    "id": d["VisitorID"],
                    "full_name": d["FullName"] or "Khách",
                    "cccd_number": d["CCCDNumber"] or "",
                    "birth_date": d.get("BirthDate") or "",
                    "phone": d.get("Phone") or "",
                    "card_number": d["CardNumber"] or "",
                    "company": d["Company"] or "",
                    "department": d["Department"] or "",
                    "host_person": d["HostPerson"] or "",
                    "purpose": d["Purpose"] or "",
                    "checkin_time": cin_time,
                    "expected_checkout_time": exp_time,
                    "checkout_time": cout_time,
                    "duration_str": duration_str,
                    "status": d["Status"] or "CHECKED_OUT",
                    "operator": d["Operator"] or "Bảo vệ",
                    "parent_visitor_id": d.get("ParentVisitorID") or "",
                    "parent_visitor_name": d.get("ParentVisitorName") or ""
                })
            return items
    except Exception as e:
        logger.error("MSSQL get_visitor_history_db error: %s", e)
        return []



# ==============================================================================
# ENTERPRISE 18-TABLE CRUD & ANALYTICS LAYER (SeaZen_AccessControl)
# ==============================================================================

ALLOWED_TABLES = {
    "tbl_Departments": "Phòng Ban",
    "tbl_Employees": "Danh Bạ Nhân Sự",
    "tbl_EmployeeBiometrics": "Sinh Trắc Học",
    "tbl_Doors": "Danh Mục Cửa",
    "tbl_Devices": "Thiết Bị Quét Mặt",
    "tbl_AccessTimezones": "Khung Giờ Mở Cửa",
    "tbl_AccessGroups": "Nhóm Phân Quyền Cửa",
    "tbl_DepartmentAccessGroups": "Phân Quyền Phòng Ban",
    "tbl_CustomerCards": "Kho Thẻ Khách",
    "tbl_Visitors": "Khách Ra Vào",
    "tbl_PreRegisteredGuests": "Đăng Ký Hẹn Khách",
    "tbl_Contractors": "Nhà Thầu Thi Công",
    "tbl_AttendanceLogs": "Nhật Ký Quẹt Thẻ",
    "tbl_Shifts": "Ca Làm Việc",
    "tbl_DailyTimekeeping": "Tổng Hợp Chấm Công",
    "tbl_DeviceCommands": "Lệnh Thiết Bị",
    "tbl_DoorAuditLogs": "Nhật Ký Đóng Mở Cửa",
    "tbl_ClockSyncAuditLogs": "Nhật Ký Đối Soát Giờ NTP"
}


def _serialize_row(cols: List[str], row: Any) -> Dict[str, Any]:
    out = {}
    for c, v in zip(cols, row):
        if isinstance(v, datetime):
            out[c] = v.strftime("%Y-%m-%d %H:%M:%S")
        elif hasattr(v, "isoformat"):
            out[c] = v.isoformat()
        else:
            out[c] = v
    return out


def get_all_tables_overview() -> List[Dict[str, Any]]:
    if not is_mssql_active():
        return []
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT t.name, SUM(p.rows) AS row_count
                FROM sys.tables t
                INNER JOIN sys.partitions p ON t.object_id = p.object_id
                WHERE p.index_id IN (0,1)
                GROUP BY t.name
                ORDER BY t.name
            """)
            counts = {r[0]: int(r[1]) for r in cur.fetchall()}
            result = []
            for tbl, vn_name in ALLOWED_TABLES.items():
                result.append({
                    "table_name": tbl,
                    "vn_name": vn_name,
                    "sharepoint_list_name": f"VMS SEAZEN - {vn_name.upper()}",
                    "row_count": counts.get(tbl, 0),
                    "exists": tbl in counts
                })
            return result
    except Exception as e:
        logger.error("get_all_tables_overview error: %s", e)
        return []


def get_table_rows(table_name: str, limit: int = 200) -> List[Dict[str, Any]]:
    if not is_mssql_active() or table_name not in ALLOWED_TABLES:
        return []
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=8) as conn:
            cur = conn.cursor()
            if table_name == "tbl_Employees":
                cur.execute(f"""
                    SELECT TOP ({int(limit)}) *
                    FROM tbl_Employees
                    WHERE IsStaff = 1 AND IsActive = 1
                      AND DepartmentName IS NOT NULL AND DepartmentName <> '' AND DepartmentName <> N'Khác'
                    ORDER BY FullName ASC
                """)
            elif table_name == "tbl_EmployeeBiometrics":
                cur.execute(f"""
                    SELECT TOP ({int(limit)}) b.*
                    FROM tbl_EmployeeBiometrics b
                    INNER JOIN tbl_Employees e ON b.EmployeeATID = e.EmployeeATID
                    WHERE e.IsStaff = 1 AND e.IsActive = 1
                      AND e.DepartmentName IS NOT NULL AND e.DepartmentName <> '' AND e.DepartmentName <> N'Khác'
                    ORDER BY b.UpdatedAt DESC, b.BiometricID DESC
                """)
            elif table_name == "tbl_DailyTimekeeping":
                cur.execute(f"SELECT TOP ({int(limit)}) * FROM tbl_DailyTimekeeping ORDER BY WorkDate DESC, UpdatedAt DESC")
            elif table_name == "tbl_AttendanceLogs":
                cur.execute(f"SELECT TOP ({int(limit)}) * FROM tbl_AttendanceLogs ORDER BY CheckTime DESC, LogID DESC")
            else:
                cur.execute(f"SELECT TOP ({int(limit)}) * FROM [{table_name}] ORDER BY 1 DESC")
            cols = [c[0] for c in cur.description]
            return [_serialize_row(cols, r) for r in cur.fetchall()]
    except Exception as e:
        logger.error("get_table_rows(%s) error: %s", table_name, e)
        return []


def upsert_department_db(data: Dict[str, Any]) -> Dict[str, Any]:
    dept_name = str(data.get("DepartmentName") or data.get("name") or "").strip()
    dept_code = str(data.get("DepartmentCode") or data.get("code") or "").strip()
    parent_id = data.get("ParentID") or None
    level = int(data.get("Level") or 1)
    location = str(data.get("Location") or "").strip()
    desc = str(data.get("Description") or "").strip()
    dept_id = data.get("DepartmentID")

    if not dept_name:
        return {"success": False, "error": "Tên phòng ban không được để trống"}

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            if dept_id:
                cur.execute("""
                    UPDATE tbl_Departments
                    SET DepartmentCode = ?, DepartmentName = ?, ParentID = ?, Level = ?, Location = ?, Description = ?, UpdatedAt = GETDATE()
                    WHERE DepartmentID = ?
                """, (dept_code, dept_name, parent_id, level, location, desc, int(dept_id)))
            else:
                cur.execute("SELECT DepartmentID FROM tbl_Departments WHERE DepartmentName = ?", (dept_name,))
                existing = cur.fetchone()
                if existing:
                    cur.execute("""
                        UPDATE tbl_Departments
                        SET DepartmentCode = COALESCE(NULLIF(?, ''), DepartmentCode), Location = ?, Description = ?, UpdatedAt = GETDATE()
                        WHERE DepartmentID = ?
                    """, (dept_code, location, desc, existing[0]))
                else:
                    cur.execute("""
                        INSERT INTO tbl_Departments (DepartmentCode, DepartmentName, ParentID, Level, Location, Description, IsActive)
                        VALUES (?, ?, ?, ?, ?, ?, 1)
                    """, (dept_code, dept_name, parent_id, level, location, desc))
            conn.commit()
            return {"success": True, "message": f"Đã lưu phòng ban '{dept_name}' thành công."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_employee_and_biometrics_db(data: Dict[str, Any]) -> Dict[str, Any]:
    atid = str(data.get("EmployeeATID") or data.get("atid") or "").strip()
    full_name = str(data.get("FullName") or data.get("fullname") or "").strip()
    if not atid or not full_name:
        return {"success": False, "error": "Vui lòng nhập Mã chấm công ATID và Họ tên nhân sự."}

    update_scope = str(data.get("update_scope") or "full").strip().lower()
    emp_code = str(data.get("EmployeeCode") or data.get("code") or atid).strip()
    dept_name = str(data.get("DepartmentName") or data.get("department") or "HC QTNS").strip()
    position = str(data.get("Position") or data.get("position") or "").strip()
    card_num = str(data.get("CardNumber") or data.get("card_number") or "").strip() or None
    privilege = int(data.get("Privilege") or 0)
    gender = str(data.get("Gender") or data.get("gender") or "").strip()
    email = str(data.get("Email") or data.get("email") or "").strip()
    phone = str(data.get("Phone") or data.get("phone") or "").strip()
    joined_raw = str(data.get("JoinedDate") or data.get("joined_date") or "").strip()
    joined_dt = None
    if joined_raw:
        try:
            joined_dt = datetime.strptime(joined_raw[:10], "%Y-%m-%d")
        except Exception:
            joined_dt = None

    is_active = 1 if data.get("IsActive", True) else 0
    face_b64 = data.get("FacePhotoBase64") or data.get("face_photo_base64") or None
    face_biodata = data.get("FaceTemplateBIODATA") or None
    has_face = 1 if (data.get("HasFace") or face_b64 or face_biodata) else 0
    has_finger = 1 if data.get("HasFinger") else 0
    has_card = 1 if card_num else 0

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT DepartmentID FROM tbl_Departments WHERE DepartmentName = ?", (dept_name,))
            d_row = cur.fetchone()
            dept_id = d_row[0] if d_row else None

            cur.execute("SELECT EmployeeID FROM tbl_Employees WHERE EmployeeATID = ?", (atid,))
            if cur.fetchone():
                if update_scope == "hrm":
                    cur.execute("""
                        UPDATE tbl_Employees
                        SET EmployeeCode = ?, FullName = ?, DepartmentID = ?, DepartmentName = ?,
                            Position = ?, Gender = ?, Email = ?, Phone = ?,
                            JoinedDate = COALESCE(?, JoinedDate),
                            IsStaff = 1, IsActive = ?, UpdatedAt = GETDATE()
                        WHERE EmployeeATID = ?
                    """, (emp_code, full_name, dept_id, dept_name, position, gender, email, phone, joined_dt, is_active, atid))
                else:
                    cur.execute("""
                        UPDATE tbl_Employees
                        SET EmployeeCode = ?, FullName = ?, DepartmentID = ?, DepartmentName = ?,
                            Position = ?, CardNumber = ?, Privilege = ?, Gender = COALESCE(NULLIF(?, ''), Gender),
                            Email = ?, Phone = ?, IsStaff = 1, IsActive = ?, UpdatedAt = GETDATE()
                        WHERE EmployeeATID = ?
                    """, (emp_code, full_name, dept_id, dept_name, position, card_num, privilege, gender, email, phone, is_active, atid))
            else:
                cur.execute("""
                    INSERT INTO tbl_Employees (
                        EmployeeID, EmployeeATID, EmployeeCode, FullName, DepartmentID, DepartmentName,
                        Position, CardNumber, Privilege, Gender, Email, Phone, JoinedDate, IsStaff, IsActive
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (f"SZ-{atid}", atid, emp_code, full_name, dept_id, dept_name, position, card_num, privilege, gender, email, phone, joined_dt, is_active))

            if update_scope != "hrm":
                cur.execute("SELECT BiometricID FROM tbl_EmployeeBiometrics WHERE EmployeeATID = ?", (atid,))
                if cur.fetchone():
                    cur.execute("""
                        UPDATE tbl_EmployeeBiometrics
                        SET FacePhotoBase64 = COALESCE(?, FacePhotoBase64),
                            FaceTemplateBIODATA = COALESCE(?, FaceTemplateBIODATA),
                            HasFace = CASE WHEN ? = 1 THEN 1 ELSE HasFace END,
                            HasCard = ?,
                            HasFinger = CASE WHEN ? = 1 THEN 1 ELSE HasFinger END,
                            LastSyncedToDevices = CASE WHEN ? = 1 THEN GETDATE() ELSE LastSyncedToDevices END,
                            UpdatedAt = GETDATE()
                        WHERE EmployeeATID = ?
                    """, (face_b64, face_biodata, has_face, has_card, has_finger, 1 if data.get("sync_to_hardware") else 0, atid))
                else:
                    cur.execute("""
                        INSERT INTO tbl_EmployeeBiometrics (
                            EmployeeATID, FacePhotoBase64, FaceTemplateBIODATA, HasFace, HasCard, HasFinger,
                            LastSyncedToDevices
                        ) VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN GETDATE() ELSE NULL END)
                    """, (atid, face_b64, face_biodata, has_face, has_card, has_finger, 1 if data.get("sync_to_hardware") else 0))

            conn.commit()
            return {"success": True, "message": f"Đã cập nhật hồ sơ cho {full_name} (ATID: {atid})."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def toggle_employee_status_db(atid: str, is_active: bool) -> Dict[str, Any]:
    clean_atid = str(atid or "").strip()
    if not clean_atid:
        return {"success": False, "error": "Thiếu Mã ATID nhân viên."}
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE tbl_Employees
                SET IsActive = ?, UpdatedAt = GETDATE()
                WHERE EmployeeATID = ?
            """, (1 if is_active else 0, clean_atid))
            conn.commit()
            if cur.rowcount == 0:
                return {"success": False, "error": f"Không tìm thấy nhân viên ATID {clean_atid}."}
            return {
                "success": True,
                "atid": clean_atid,
                "is_active": bool(is_active),
                "message": f"Đã {'kích hoạt lại' if is_active else 'tạm khóa'} hồ sơ nhân viên {clean_atid}."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def mark_employee_hardware_synced_db(atid: str, card_num: Optional[str] = None, privilege: Optional[int] = None) -> None:
    if not is_mssql_active():
        return
    clean_atid = str(atid or "").strip()
    if not clean_atid:
        return
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            if card_num:
                cur.execute("""
                    UPDATE tbl_Employees
                    SET CardNumber = COALESCE(NULLIF(CardNumber, ''), ?),
                        Privilege = COALESCE(?, Privilege),
                        UpdatedAt = GETDATE()
                    WHERE EmployeeATID = ?
                """, (str(card_num), privilege, clean_atid))
            cur.execute("""
                IF EXISTS (SELECT 1 FROM tbl_EmployeeBiometrics WHERE EmployeeATID = ?)
                BEGIN
                    UPDATE tbl_EmployeeBiometrics
                    SET LastSyncedToDevices = GETDATE(),
                        HasCard = CASE WHEN ? IS NOT NULL AND ? <> '' THEN 1 ELSE HasCard END,
                        UpdatedAt = GETDATE()
                    WHERE EmployeeATID = ?
                END
                ELSE
                BEGIN
                    INSERT INTO tbl_EmployeeBiometrics (EmployeeATID, HasFace, HasCard, HasFinger, LastSyncedToDevices)
                    VALUES (?, 0, CASE WHEN ? IS NOT NULL AND ? <> '' THEN 1 ELSE 0 END, 0, GETDATE())
                END
            """, (clean_atid, card_num, card_num, clean_atid, clean_atid, card_num, card_num))
            conn.commit()
    except Exception as e:
        logger.debug("mark_employee_hardware_synced_db warning: %s", e)


def _normalize_card_number(raw: Any) -> str:
    s = str(raw or "").strip()
    if s.isdigit():
        return s.lstrip("0") or "0"
    return s


def get_customer_cards_db(limit: int = 500, include_photos: bool = True) -> Dict[str, Any]:
    """Returns card inventory with evidence status summary counts."""
    if not is_mssql_active():
        return {"rows": [], "count": 0, "pending_photo_count": 0, "lost_count": 0}
    try:
        ensure_extended_schema()
        photo_expr = "CardPhotoBase64" if include_photos else "CAST(NULL AS NVARCHAR(MAX)) AS CardPhotoBase64"
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute(f"""
                SELECT TOP ({int(limit)})
                    CardID, CardCode, CardName, CardNumber, CardType, Status,
                    CurrentHolderName, CurrentHolderCCCD, AssignedAt, IsSyncedToDevices,
                    {photo_expr},
                    CASE WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20 THEN 1 ELSE 0 END AS HasPhoto,
                    CASE WHEN CardName IS NOT NULL AND LTRIM(RTRIM(CardName)) <> '' THEN 1 ELSE 0 END AS HasName,
                    CASE
                        WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20
                         AND CardName IS NOT NULL AND LTRIM(RTRIM(CardName)) <> ''
                        THEN 'VERIFIED'
                        ELSE 'PENDING_PHOTO'
                    END AS EvidenceStatus,
                    AutoDetectedAt, DetectedBy, VerifiedBy, VerifiedAt,
                    LastHolderName, LastHolderCCCD, LastHolderPhone, LastHolderCompany,
                    LastContactPerson, LastContactPhone, LastAssignedAt, LastGateOutAt, LastReturnedAt,
                    ValidFrom, ValidTo, DeviceSyncState,
                    Notes, CreatedAt, UpdatedAt
                FROM tbl_CustomerCards
                ORDER BY
                    CASE
                        WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20
                         AND CardName IS NOT NULL AND LTRIM(RTRIM(CardName)) <> ''
                        THEN 1 ELSE 0
                    END,
                    UpdatedAt DESC, CardID DESC
            """)
            cols = [c[0] for c in cur.description]
            rows = [_serialize_row(cols, r) for r in cur.fetchall()]
            pending_cnt = sum(1 for r in rows if not r.get("HasPhoto") or not r.get("HasName"))
            lost_cnt = sum(1 for r in rows if str(r.get("Status") or "").upper() in ("LOST", "LOCKED"))
            return {
                "rows": rows,
                "count": len(rows),
                "pending_photo_count": pending_cnt,
                "lost_count": lost_cnt,
            }
    except Exception as e:
        logger.error("get_customer_cards_db error: %s", e)
        return {"rows": [], "count": 0, "pending_photo_count": 0, "lost_count": 0}


def check_card_not_blocked_db(card_number: str) -> Dict[str, Any]:
    """Checks if a card exists in tbl_CustomerCards and is marked LOST or LOCKED."""
    clean_num = _normalize_card_number(card_number)
    if not clean_num or not is_mssql_active():
        return {"blocked": False}
    try:
        ensure_extended_schema()
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT TOP 1 CardCode, CardNumber, Status, CurrentHolderName
                FROM tbl_CustomerCards
                WHERE CardNumber = ? OR CardNumber = ?
            """, (str(card_number).strip(), clean_num))
            row = cur.fetchone()
            if row and str(row[2] or "").upper() in ("LOST", "LOCKED"):
                st_label = "ĐÃ BÁO MẤT" if str(row[2]).upper() == "LOST" else "ĐANG KHÓA / HỎNG"
                return {
                    "blocked": True,
                    "status": str(row[2]).upper(),
                    "card_code": str(row[0] or ""),
                    "error": f"Thẻ {row[1]} ({row[0]}) đang ở trạng thái {st_label} trong Kho thẻ Admin. Vui lòng kiểm tra hoặc mở khóa thẻ trước khi cấp cho khách!",
                }
    except Exception as e:
        logger.debug("check_card_not_blocked_db warning: %s", e)
    return {"blocked": False}


def _parse_dt_sql(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw
    s = str(raw).strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:len(fmt) + 2], fmt)
        except Exception:
            continue
    return None


def log_card_history_db(
    card_number: str,
    event_type: str,
    card_id: Optional[int] = None,
    holder_name: str = "",
    holder_cccd: str = "",
    holder_phone: str = "",
    contact_person: str = "",
    contact_phone: str = "",
    operator: str = "Hệ thống",
    notes: str = "",
) -> None:
    clean_num = _normalize_card_number(card_number)
    if not clean_num or not is_mssql_active():
        return
    try:
        ensure_extended_schema()
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO tbl_CardHistory (
                    CardID, CardNumber, EventType, HolderName, HolderCCCD, HolderPhone,
                    ContactPerson, ContactPhone, EventTime, Operator, Notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?)
            """, (
                int(card_id) if card_id else None,
                clean_num[:50],
                str(event_type or "EVENT")[:50],
                str(holder_name or "")[:250] or None,
                str(holder_cccd or "")[:50] or None,
                str(holder_phone or "")[:50] or None,
                str(contact_person or "")[:250] or None,
                str(contact_phone or "")[:50] or None,
                str(operator or "Hệ thống")[:100],
                str(notes or "")[:500] or None,
            ))
            conn.commit()
    except Exception as e:
        logger.debug("log_card_history_db warning: %s", e)


def get_card_history_db(card_number: str, limit: int = 30) -> List[Dict[str, Any]]:
    clean_num = _normalize_card_number(card_number)
    if not clean_num or not is_mssql_active():
        return []
    try:
        ensure_extended_schema()
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute(f"""
                SELECT TOP ({int(limit)})
                    HistoryID, CardID, CardNumber, EventType, HolderName, HolderCCCD, HolderPhone,
                    ContactPerson, ContactPhone, EventTime, Operator, Notes
                FROM tbl_CardHistory
                WHERE CardNumber = ? OR CardNumber = ?
                ORDER BY EventTime DESC, HistoryID DESC
            """, (str(card_number).strip(), clean_num))
            cols = [c[0] for c in cur.description]
            return [_serialize_row(cols, r) for r in cur.fetchall()]
    except Exception as e:
        logger.debug("get_card_history_db warning: %s", e)
        return []


def sync_card_assignment_on_checkin(
    card_number: str,
    holder_name: str,
    holder_cccd: str = "",
    operator: str = "Lễ tân",
    holder_phone: str = "",
    holder_company: str = "",
    contact_person: str = "",
    contact_phone: str = "",
    valid_from: Any = None,
    valid_to: Any = None,
    device_sync_state: str = "ACTIVE_ON_DEVICE",
) -> Dict[str, Any]:
    """
    Progressive Card Onboarding + Persistent Last Holder + Time-Bound Validity:
    - Always stores both CurrentHolder* and LastHolder* (never wiped on checkout).
    - Records ValidFrom / ValidTo & DeviceSyncState so cards expire cleanly after 23:59:59 of ValidTo date.
    """
    clean_num = _normalize_card_number(card_number)
    if not clean_num or not is_mssql_active():
        return {"is_new": False, "needs_photo": False}
    vf_dt = _parse_dt_sql(valid_from)
    vt_dt = _parse_dt_sql(valid_to)
    h_name = str(holder_name or "Khách")[:250]
    h_cccd = str(holder_cccd or "")[:50]
    h_phone = str(holder_phone or "")[:50]
    h_comp = str(holder_company or "")[:250]
    c_person = str(contact_person or "")[:250]
    c_phone = str(contact_phone or "")[:50]
    sync_st = str(device_sync_state or "ACTIVE_ON_DEVICE")[:50]
    try:
        ensure_extended_schema()
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT TOP 1 CardID, CardCode, CardNumber,
                       CASE WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20 THEN 1 ELSE 0 END,
                       ISNULL(EvidenceStatus, 'PENDING_PHOTO'),
                       Status
                FROM tbl_CustomerCards
                WHERE CardNumber = ? OR CardNumber = ?
            """, (str(card_number).strip(), clean_num))
            row = cur.fetchone()
            if row:
                cid, ccode, cnum, has_photo, ev_status, cur_status = row
                if str(cur_status or "").upper() in ("LOST", "LOCKED"):
                    return {"blocked": True, "is_new": False, "card_number": str(cnum), "card_code": str(ccode)}
                cur.execute("""
                    UPDATE tbl_CustomerCards
                    SET Status = 'IN_USE',
                        CurrentHolderName = ?,
                        CurrentHolderCCCD = ?,
                        AssignedAt = GETDATE(),
                        LastHolderName = ?,
                        LastHolderCCCD = ?,
                        LastHolderPhone = ?,
                        LastHolderCompany = ?,
                        LastContactPerson = ?,
                        LastContactPhone = ?,
                        LastAssignedAt = GETDATE(),
                        LastGateOutAt = NULL,
                        LastReturnedAt = NULL,
                        ValidFrom = ?,
                        ValidTo = ?,
                        DeviceSyncState = ?,
                        IsSyncedToDevices = ?,
                        UpdatedAt = GETDATE()
                    WHERE CardID = ?
                """, (
                    h_name, h_cccd,
                    h_name, h_cccd, h_phone or None, h_comp or None, c_person or None, c_phone or None,
                    vf_dt, vt_dt, sync_st, 0 if sync_st == "SCHEDULED" else 1,
                    int(cid),
                ))
                conn.commit()
                log_card_history_db(
                    cnum, "SCHEDULED" if sync_st == "SCHEDULED" else "ASSIGNED",
                    card_id=int(cid), holder_name=h_name, holder_cccd=h_cccd, holder_phone=h_phone,
                    contact_person=c_person, contact_phone=c_phone, operator=operator,
                    notes=f"Hiệu lực: {valid_from or 'Ngay lập tức'} -> {valid_to or '23:59 hôm nay'}",
                )
                needs_photo = (not bool(has_photo)) or (str(ev_status) == "PENDING_PHOTO")
                return {
                    "blocked": False,
                    "is_new": False,
                    "needs_photo": needs_photo,
                    "card_id": int(cid),
                    "card_number": str(cnum),
                    "card_code": str(ccode),
                }

            new_code = f"THE-KHACH-{clean_num}"[:50]
            note_txt = f"Phát hiện thẻ mới khi đón khách {holder_name}"[:500]
            cur.execute("""
                INSERT INTO tbl_CustomerCards (
                    CardCode, CardNumber, CardType, Status,
                    CurrentHolderName, CurrentHolderCCCD, AssignedAt,
                    LastHolderName, LastHolderCCCD, LastHolderPhone, LastHolderCompany,
                    LastContactPerson, LastContactPhone, LastAssignedAt,
                    ValidFrom, ValidTo, DeviceSyncState,
                    IsSyncedToDevices, EvidenceStatus, AutoDetectedAt, DetectedBy, Notes
                ) VALUES (?, ?, 'VISITOR', 'IN_USE', ?, ?, GETDATE(), ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?, ?, ?, 'PENDING_PHOTO', GETDATE(), ?, ?)
            """, (
                new_code,
                clean_num[:50],
                h_name, h_cccd,
                h_name, h_cccd, h_phone or None, h_comp or None, c_person or None, c_phone or None,
                vf_dt, vt_dt, sync_st, 0 if sync_st == "SCHEDULED" else 1,
                str(operator or "Lễ tân")[:100],
                note_txt,
            ))
            conn.commit()
            log_card_history_db(
                clean_num, "ASSIGNED",
                holder_name=h_name, holder_cccd=h_cccd, holder_phone=h_phone,
                contact_person=c_person, contact_phone=c_phone, operator=operator,
                notes=f"Thẻ mới tự động ghi nhận · Hiệu lực đến {valid_to or '23:59 hôm nay'}",
            )
            return {
                "blocked": False,
                "is_new": True,
                "needs_photo": True,
                "card_number": clean_num,
                "card_code": new_code,
            }
    except Exception as e:
        logger.warning("sync_card_assignment_on_checkin warning: %s", e)
        return {"is_new": False, "needs_photo": False, "error": str(e)}


def release_card_on_checkout(card_number: str, operator: str = "Lễ tân", notes: str = "") -> bool:
    """
    Marks visitor card AVAILABLE on checkout unless marked LOST or LOCKED.
    IMPORTANT: Preserves LastHolder* columns permanently so lost cards discovered
    after checkout can still be traced back to the last holder.
    """
    clean_num = _normalize_card_number(card_number)
    if not clean_num or not is_mssql_active():
        return False
    try:
        ensure_extended_schema()
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT TOP 1 CardID, LastHolderName, LastHolderCCCD, LastHolderPhone, LastContactPerson, LastContactPhone
                FROM tbl_CustomerCards
                WHERE CardNumber = ? OR CardNumber = ?
            """, (str(card_number).strip(), clean_num))
            prev = cur.fetchone()
            cur.execute("""
                UPDATE tbl_CustomerCards
                SET Status = 'AVAILABLE',
                    CurrentHolderName = NULL,
                    CurrentHolderCCCD = NULL,
                    LastReturnedAt = GETDATE(),
                    DeviceSyncState = 'REVOKED_CHECKOUT',
                    IsSyncedToDevices = 0,
                    UpdatedAt = GETDATE()
                WHERE (CardNumber = ? OR CardNumber = ?)
                  AND ISNULL(Status, 'AVAILABLE') NOT IN ('LOST', 'LOCKED')
            """, (str(card_number).strip(), clean_num))
            conn.commit()
            updated = cur.rowcount > 0
            if updated and prev:
                log_card_history_db(
                    clean_num, "CHECKED_OUT",
                    card_id=int(prev[0]),
                    holder_name=str(prev[1] or ""),
                    holder_cccd=str(prev[2] or ""),
                    holder_phone=str(prev[3] or ""),
                    contact_person=str(prev[4] or ""),
                    contact_phone=str(prev[5] or ""),
                    operator=operator,
                    notes=notes or "Đã trả thẻ & Check-out",
                )
            return updated
    except Exception as e:
        logger.debug("release_card_on_checkout warning: %s", e)
        return False


def process_card_expiry_and_schedule_db(zk_client: Any = None) -> Dict[str, Any]:
    """
    Enforces time-bound validity on 4 ZKTeco devices:
    1. Enrolls SCHEDULED cards once NOW >= ValidFrom.
    2. Allows access through 23:59:59 of the ValidTo calendar day (warnings only at ValidTo),
       then automatically revokes on all 4 ZKTeco devices once past 23:59:59 (next day 00:00+).
    3. Keeps LastGateOutAt updated whenever the visitor swipes Làn RA.
    """
    res = {"enrolled": 0, "revoked": 0}
    if not is_mssql_active():
        return res
    try:
        ensure_extended_schema()
        now_dt = datetime.now()
        with pyodbc.connect(get_connection_string(), timeout=6) as conn:
            cur = conn.cursor()
            # 1. Activate SCHEDULED cards whose ValidFrom has arrived
            cur.execute("""
                SELECT c.CardID, c.CardNumber, c.LastHolderName, c.LastHolderCCCD, c.ValidFrom, c.ValidTo
                FROM tbl_CustomerCards c
                WHERE c.Status = 'IN_USE'
                  AND c.DeviceSyncState = 'SCHEDULED'
                  AND c.ValidFrom IS NOT NULL
                  AND c.ValidFrom <= GETDATE()
                  AND (c.ValidTo IS NULL OR CAST(c.ValidTo AS DATE) >= CAST(GETDATE() AS DATE))
            """)
            to_enroll = cur.fetchall()
            for cid, cnum, hname, hcccd, vf, vt in to_enroll:
                if zk_client:
                    try:
                        zk_client.register_customer_epad(
                            {"card_number": str(cnum), "full_name": str(hname or f"Khach {cnum}"), "cccd_number": str(hcccd or "")},
                            auto_sync=True,
                        )
                    except Exception:
                        pass
                cur.execute(
                    "UPDATE tbl_CustomerCards SET DeviceSyncState = 'ACTIVE_ON_DEVICE', IsSyncedToDevices = 1, UpdatedAt = GETDATE() WHERE CardID = ?",
                    (int(cid),),
                )
                log_card_history_db(str(cnum), "ENROLLED", card_id=int(cid), holder_name=str(hname or ""), notes="Tự động kích hoạt thẻ đúng giờ hẹn ValidFrom")
                res["enrolled"] += 1

            # 2. Update LastGateOutAt and revoke cards past 23:59:59 of their ValidTo calendar day
            cur.execute("""
                SELECT c.CardID, c.CardNumber, c.CurrentHolderName, c.CurrentHolderCCCD,
                       c.LastAssignedAt, c.ValidTo, c.LastGateOutAt,
                       (
                           SELECT MAX(a.CheckTime)
                           FROM tbl_AttendanceLogs a
                           WHERE (a.EmployeeATID = c.CardNumber OR a.EmployeeATID = RIGHT('0000000000' + c.CardNumber, 10))
                             AND a.DeviceName LIKE N'%RA%'
                             AND a.CheckTime >= ISNULL(c.LastAssignedAt, DATEADD(hour, -24, GETDATE()))
                       ) AS GateOutTime
                FROM tbl_CustomerCards c
                WHERE c.Status = 'IN_USE'
                  AND ISNULL(c.DeviceSyncState, 'ACTIVE_ON_DEVICE') = 'ACTIVE_ON_DEVICE'
                  AND c.ValidTo IS NOT NULL
            """)
            active_rows = cur.fetchall()
            for cid, cnum, hname, hcccd, assigned_at, vt_dt, prev_out_dt, gate_out_dt in active_rows:
                if gate_out_dt is not None and prev_out_dt != gate_out_dt:
                    cur.execute(
                        "UPDATE tbl_CustomerCards SET LastGateOutAt = ? WHERE CardID = ?",
                        (gate_out_dt, int(cid)),
                    )
                if vt_dt is not None and now_dt.date() > vt_dt.date():
                    if zk_client:
                        try:
                            zk_client.return_or_delete_card(str(cnum))
                        except Exception:
                            pass
                    cur.execute("""
                        UPDATE tbl_CustomerCards
                        SET DeviceSyncState = 'REVOKED_EXPIRED',
                            IsSyncedToDevices = 0,
                            LastGateOutAt = COALESCE(?, LastGateOutAt),
                            UpdatedAt = GETDATE()
                        WHERE CardID = ?
                    """, (gate_out_dt, int(cid)))
                    log_card_history_db(
                        str(cnum), "EXPIRED_REVOKED",
                        card_id=int(cid), holder_name=str(hname or ""), holder_cccd=str(hcccd or ""),
                        notes=f"Đã qua 23:59 ngày {vt_dt.strftime('%Y-%m-%d')} — tự động thu hồi quyền mở cửa trên 4 máy ZKTeco",
                    )
                    res["revoked"] += 1
            conn.commit()
    except Exception as e:
        logger.debug("process_card_expiry_and_schedule_db warning: %s", e)
    return res


def upload_card_evidence_db(
    card_id_or_number: Any,
    photo_b64: Optional[str] = None,
    verified_by: str = "Quản trị viên",
    card_name: Optional[str] = None,
    card_code: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Updates CardName and/or physical card evidence photo (neither is strictly mandatory).
    Marks EvidenceStatus='VERIFIED' only when BOTH CardName and CardPhotoBase64 are present.
    """
    key_str = str(card_id_or_number or "").strip()
    clean_photo = str(photo_b64 or "").strip()
    clean_name = str(card_name or "").strip() if card_name is not None else None
    if not key_str:
        return {"success": False, "error": "Thiếu thông tin thẻ cần cập nhật."}
    if clean_photo and len(clean_photo) < 25:
        return {"success": False, "error": "Ảnh bằng chứng thẻ không hợp lệ."}
    if clean_photo and not clean_photo.startswith("data:image/"):
        clean_photo = f"data:image/jpeg;base64,{clean_photo}"
    if not clean_photo and not clean_name and card_code is None and notes is None:
        return {"success": False, "error": "Vui lòng nhập Tên thẻ hoặc chọn Ảnh bằng chứng."}

    try:
        ensure_extended_schema()
        clean_num = _normalize_card_number(key_str)
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            if key_str.isdigit() and len(key_str) <= 6:
                cur.execute(
                    "SELECT CardID, CardNumber, CardCode, CardName, CASE WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20 THEN 1 ELSE 0 END FROM tbl_CustomerCards WHERE CardID = ? OR CardNumber = ? OR CardNumber = ?",
                    (int(key_str), key_str, clean_num),
                )
            else:
                cur.execute(
                    "SELECT CardID, CardNumber, CardCode, CardName, CASE WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20 THEN 1 ELSE 0 END FROM tbl_CustomerCards WHERE CardNumber = ? OR CardNumber = ? OR CardCode = ?",
                    (key_str, clean_num, key_str),
                )
            row = cur.fetchone()
            if not row:
                return {"success": False, "error": f"Không tìm thấy thẻ '{key_str}' trong kho thẻ."}
            cid, cnum, ccode, existing_name, had_photo = int(row[0]), str(row[1]), str(row[2]), str(row[3] or "").strip(), bool(row[4])
            new_code = str(card_code or "").strip() or ccode
            final_name = clean_name if clean_name is not None else existing_name
            has_both = bool(final_name) and (bool(clean_photo) or had_photo)
            ev_status = "VERIFIED" if has_both else "PENDING_PHOTO"

            set_clauses = [
                "EvidenceStatus = ?",
                "VerifiedBy = ?",
                "VerifiedAt = GETDATE()",
                "CardCode = ?",
                "UpdatedAt = GETDATE()",
            ]
            params: List[Any] = [
                ev_status,
                str(verified_by or "Quản trị viên")[:100],
                new_code[:50],
            ]
            if clean_photo:
                set_clauses.append("CardPhotoBase64 = ?")
                params.append(clean_photo)
            if clean_name is not None:
                set_clauses.append("CardName = ?")
                params.append(clean_name[:100] if clean_name else None)
            if notes is not None and str(notes).strip() != "":
                set_clauses.append("Notes = ?")
                params.append(str(notes).strip()[:500])
            params.append(cid)
            cur.execute(f"UPDATE tbl_CustomerCards SET {', '.join(set_clauses)} WHERE CardID = ?", params)
            conn.commit()
            return {
                "success": True,
                "card_id": cid,
                "card_number": cnum,
                "card_code": new_code,
                "card_name": final_name,
                "evidence_status": ev_status,
                "message": f"Đã cập nhật thẻ {final_name or cnum}" + (" (đủ Tên thẻ & Ảnh bằng chứng)." if has_both else " (vẫn đang thiếu Tên thẻ hoặc Ảnh)."),
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_customer_card_db(data: Dict[str, Any]) -> Dict[str, Any]:
    ensure_extended_schema()
    card_id = data.get("CardID")
    card_num = _normalize_card_number(data.get("CardNumber"))
    card_code = str(data.get("CardCode") or f"THE-KHACH-{card_num}").strip()
    card_name = str(data.get("CardName") or "").strip() or None
    card_type = str(data.get("CardType") or "VISITOR").strip()
    status = str(data.get("Status") or "AVAILABLE").strip().upper()
    notes = str(data.get("Notes") or "").strip()
    photo_b64 = str(data.get("CardPhotoBase64") or "").strip() or None
    if photo_b64 and len(photo_b64) > 25 and not photo_b64.startswith("data:image/"):
        photo_b64 = f"data:image/jpeg;base64,{photo_b64}"
    verified_by = str(data.get("VerifiedBy") or data.get("operator") or "Quản trị viên").strip()[:100]

    if not card_num:
        return {"success": False, "error": "Số thẻ từ RFID/NFC không được để trống."}

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            existing_row = None
            if card_id:
                cur.execute(
                    "SELECT CardID, CardName, CASE WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20 THEN 1 ELSE 0 END FROM tbl_CustomerCards WHERE CardID = ?",
                    (int(card_id),),
                )
                existing_row = cur.fetchone()
            else:
                cur.execute(
                    "SELECT CardID, CardName, CASE WHEN CardPhotoBase64 IS NOT NULL AND LEN(CardPhotoBase64) > 20 THEN 1 ELSE 0 END FROM tbl_CustomerCards WHERE CardNumber = ?",
                    (card_num,),
                )
                existing_row = cur.fetchone()

            if existing_row:
                target_cid = int(existing_row[0])
                existing_name = str(existing_row[1] or "").strip()
                had_photo = bool(existing_row[2])
                final_name = card_name if card_name is not None else existing_name
                has_both = bool(final_name) and (bool(photo_b64) or had_photo)
                ev_st = "VERIFIED" if has_both else "PENDING_PHOTO"

                set_clauses = [
                    "CardCode = ?",
                    "CardNumber = ?",
                    "CardType = ?",
                    "Status = ?",
                    "Notes = ?",
                    "EvidenceStatus = ?",
                    "UpdatedAt = GETDATE()",
                ]
                params: List[Any] = [card_code, card_num, card_type, status, notes, ev_st]
                if card_name is not None:
                    set_clauses.append("CardName = ?")
                    params.append(card_name[:100])
                if photo_b64 is not None:
                    set_clauses.append("CardPhotoBase64 = ?")
                    params.append(photo_b64)
                if photo_b64 is not None or card_name is not None:
                    set_clauses.extend(["VerifiedBy = ?", "VerifiedAt = GETDATE()"])
                    params.append(verified_by)
                params.append(target_cid)
                cur.execute(f"UPDATE tbl_CustomerCards SET {', '.join(set_clauses)} WHERE CardID = ?", params)
            else:
                ev_st = "VERIFIED" if (photo_b64 and card_name) else "PENDING_PHOTO"
                has_ev = bool(photo_b64 or card_name)
                cur.execute("""
                    INSERT INTO tbl_CustomerCards (
                        CardCode, CardName, CardNumber, CardType, Status, IsSyncedToDevices,
                        CardPhotoBase64, EvidenceStatus, VerifiedBy, VerifiedAt, Notes
                    )
                    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, CASE WHEN ? = 1 THEN GETDATE() ELSE NULL END, ?)
                """, (
                    card_code, card_name, card_num, card_type, status, photo_b64, ev_st,
                    verified_by if has_ev else None,
                    1 if has_ev else 0,
                    notes,
                ))
            conn.commit()
            if existing_row and status in ("LOST", "LOCKED"):
                cur.execute(
                    "SELECT LastHolderName, LastHolderCCCD, LastHolderPhone, LastContactPerson, LastContactPhone FROM tbl_CustomerCards WHERE CardID = ?",
                    (target_cid,),
                )
                lh = cur.fetchone()
                cur.execute("UPDATE tbl_CustomerCards SET DeviceSyncState = ?, IsSyncedToDevices = 0 WHERE CardID = ?", (status, target_cid))
                conn.commit()
                log_card_history_db(
                    card_num, status, card_id=target_cid,
                    holder_name=str((lh[0] if lh else "") or ""),
                    holder_cccd=str((lh[1] if lh else "") or ""),
                    holder_phone=str((lh[2] if lh else "") or ""),
                    contact_person=str((lh[3] if lh else "") or ""),
                    contact_phone=str((lh[4] if lh else "") or ""),
                    operator=verified_by,
                    notes=notes or f"Đánh dấu trạng thái {status}",
                )
            return {
                "success": True,
                "card_number": card_num,
                "card_code": card_code,
                "card_name": card_name or "",
                "has_photo": bool(photo_b64),
                "message": f"Đã lưu thẻ {card_name or card_num} ({card_code}) vào CSDL Kho thẻ.",
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_customer_card_db(card_id_or_number: Any) -> Dict[str, Any]:
    key_str = str(card_id_or_number or "").strip()
    if not key_str:
        return {"success": False, "error": "Vui lòng chọn thẻ cần xóa."}

    try:
        clean_num = _normalize_card_number(key_str)
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            if key_str.isdigit() and len(key_str) <= 6:
                cur.execute("SELECT CardNumber, CardCode FROM tbl_CustomerCards WHERE CardID = ? OR CardNumber = ? OR CardNumber = ?", (int(key_str), key_str, clean_num))
            else:
                cur.execute("SELECT CardNumber, CardCode FROM tbl_CustomerCards WHERE CardNumber = ? OR CardNumber = ? OR CardCode = ?", (key_str, clean_num, key_str))
            row = cur.fetchone()
            if not row:
                return {"success": False, "error": f"Không tìm thấy thẻ '{key_str}' trong kho thẻ."}
            target_card_num = str(row[0])
            target_card_code = str(row[1])
            cur.execute("DELETE FROM tbl_CustomerCards WHERE CardNumber = ?", (target_card_num,))
            conn.commit()
            return {
                "success": True,
                "card_number": target_card_num,
                "card_code": target_card_code,
                "message": f"Đã xóa thẻ {target_card_num} ({target_card_code}) khỏi CSDL Kho thẻ."
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def clear_customer_cards_db(card_numbers: Optional[List[str]] = None, clear_all: bool = False) -> Dict[str, Any]:
    """
    Deletes selected cards (or all unheld cards when clear_all=True) from tbl_CustomerCards.
    Never deletes cards currently held by an ACTIVE visitor in tbl_Visitors.
    """
    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT DISTINCT LTRIM(RTRIM(ISNULL(CardNumber, ''))) FROM tbl_Visitors WHERE Status = 'ACTIVE' AND CardNumber IS NOT NULL AND CardNumber <> ''")
            active_held = {_normalize_card_number(r[0]) for r in cur.fetchall() if r[0]}

            cur.execute("SELECT CardID, CardNumber, CardCode FROM tbl_CustomerCards")
            all_rows = cur.fetchall()

            targets_set = {_normalize_card_number(c) for c in (card_numbers or []) if str(c or "").strip()}
            deleted = []
            skipped_active = []
            for cid, cnum, ccode in all_rows:
                norm_c = _normalize_card_number(cnum)
                if not clear_all and norm_c not in targets_set and str(cnum) not in (card_numbers or []):
                    continue
                if norm_c in active_held:
                    skipped_active.append(str(cnum))
                    continue
                cur.execute("DELETE FROM tbl_CustomerCards WHERE CardID = ?", (int(cid),))
                deleted.append({"card_number": str(cnum), "card_code": str(ccode or "")})
            conn.commit()
            return {
                "success": True,
                "deleted_count": len(deleted),
                "deleted": deleted,
                "skipped_active": skipped_active,
                "message": f"Đã xóa {len(deleted)} thẻ khỏi Kho thẻ SQL" + (f" (bỏ qua {len(skipped_active)} thẻ đang có khách giữ)" if skipped_active else "."),
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_pre_registered_guest_db(data: Dict[str, Any]) -> Dict[str, Any]:
    guest_name = str(data.get("GuestFullName") or "").strip()
    host_name = str(data.get("HostEmployeeName") or "").strip()
    if not guest_name or not host_name:
        return {"success": False, "error": "Vui lòng nhập Họ tên khách hẹn và Người bảo lãnh."}

    booking_code = str(data.get("BookingCode") or f"BK-{datetime.now().strftime('%Y%m%d%H%M%S')}").strip()
    cccd = str(data.get("GuestCCCD") or "").strip()
    phone = str(data.get("GuestPhone") or "").strip()
    company = str(data.get("GuestCompany") or "").strip()
    dept = str(data.get("HostDepartment") or "").strip()
    visit_date = str(data.get("VisitDate") or datetime.now().strftime("%Y-%m-%d")).strip()
    start_time = str(data.get("StartTime") or "08:30").strip()
    end_time = str(data.get("EndTime") or "17:30").strip()
    purpose = str(data.get("Purpose") or "").strip()
    card = str(data.get("ReservedCardNumber") or "").strip()
    status = str(data.get("Status") or "PENDING").strip()

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT BookingID FROM tbl_PreRegisteredGuests WHERE BookingCode = ?", (booking_code,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_PreRegisteredGuests
                    SET GuestFullName = ?, GuestCCCD = ?, GuestPhone = ?, GuestCompany = ?,
                        HostEmployeeName = ?, HostDepartment = ?, VisitDate = ?, StartTime = ?, EndTime = ?,
                        Purpose = ?, ReservedCardNumber = ?, Status = ?, UpdatedAt = GETDATE()
                    WHERE BookingCode = ?
                """, (guest_name, cccd, phone, company, host_name, dept, visit_date, start_time, end_time, purpose, card, status, booking_code))
            else:
                cur.execute("""
                    INSERT INTO tbl_PreRegisteredGuests (
                        BookingCode, GuestFullName, GuestCCCD, GuestPhone, GuestCompany,
                        HostEmployeeName, HostDepartment, VisitDate, StartTime, EndTime,
                        Purpose, ReservedCardNumber, Status, CreatedBy
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, N'Lễ tân / Quản trị')
                """, (booking_code, guest_name, cccd, phone, company, host_name, dept, visit_date, start_time, end_time, purpose, card, status))
            conn.commit()
            return {"success": True, "message": f"Đã lưu lịch hẹn trước cho khách {guest_name} ({booking_code})."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_contractor_db(data: Dict[str, Any]) -> Dict[str, Any]:
    company = str(data.get("ContractorCompany") or "").strip()
    worker = str(data.get("WorkerFullName") or "").strip()
    if not company or not worker:
        return {"success": False, "error": "Vui lòng nhập Tên đơn vị nhà thầu và Họ tên nhân sự thi công."}

    code = str(data.get("ContractorCode") or f"CON-{datetime.now().strftime('%m%d%H%M%S')}").strip()
    cccd = str(data.get("CCCDNumber") or "").strip()
    phone = str(data.get("Phone") or "").strip()
    card = str(data.get("CardNumber") or "").strip()
    area = str(data.get("WorkArea") or "Sảnh & Khu Kỹ Thuật").strip()
    sup = str(data.get("SupervisorName") or "HC QTNS").strip()
    v_from = str(data.get("ValidFrom") or datetime.now().strftime("%Y-%m-%d")).strip()
    v_to = str(data.get("ValidTo") or datetime.now().strftime("%Y-%m-%d")).strip()
    status = str(data.get("Status") or "ACTIVE").strip()

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT ContractorID FROM tbl_Contractors WHERE ContractorCode = ?", (code,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_Contractors
                    SET ContractorCompany = ?, WorkerFullName = ?, CCCDNumber = ?, Phone = ?,
                        CardNumber = ?, WorkArea = ?, SupervisorName = ?, ValidFrom = ?, ValidTo = ?, Status = ?, UpdatedAt = GETDATE()
                    WHERE ContractorCode = ?
                """, (company, worker, cccd, phone, card, area, sup, v_from, v_to, status, code))
            else:
                cur.execute("""
                    INSERT INTO tbl_Contractors (
                        ContractorCode, ContractorCompany, WorkerFullName, CCCDNumber, Phone,
                        CardNumber, WorkArea, SupervisorName, ValidFrom, ValidTo, Status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, company, worker, cccd, phone, card, area, sup, v_from, v_to, status))
            conn.commit()
            return {"success": True, "message": f"Đã lưu hồ sơ nhà thầu {worker} ({company})."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_access_timezone_db(data: Dict[str, Any]) -> Dict[str, Any]:
    code = str(data.get("TimezoneCode") or "").strip()
    name = str(data.get("TimezoneName") or "").strip()
    if not code or not name:
        return {"success": False, "error": "Vui lòng nhập Mã khung giờ và Tên khung giờ."}

    mon = str(data.get("MonTime") or "00:00-23:59").strip()
    tue = str(data.get("TueTime") or mon).strip()
    wed = str(data.get("WedTime") or mon).strip()
    thu = str(data.get("ThuTime") or mon).strip()
    fri = str(data.get("FriTime") or mon).strip()
    sat = str(data.get("SatTime") or "06:00-18:00").strip()
    sun = str(data.get("SunTime") or "00:00-00:00").strip()
    hol = str(data.get("HolidayTime") or "00:00-00:00").strip()
    desc = str(data.get("Description") or "").strip()

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT TimezoneID FROM tbl_AccessTimezones WHERE TimezoneCode = ?", (code,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_AccessTimezones
                    SET TimezoneName = ?, MonTime = ?, TueTime = ?, WedTime = ?, ThuTime = ?, FriTime = ?,
                        SatTime = ?, SunTime = ?, HolidayTime = ?, Description = ?, UpdatedAt = GETDATE()
                    WHERE TimezoneCode = ?
                """, (name, mon, tue, wed, thu, fri, sat, sun, hol, desc, code))
            else:
                cur.execute("""
                    INSERT INTO tbl_AccessTimezones (
                        TimezoneCode, TimezoneName, MonTime, TueTime, WedTime, ThuTime, FriTime,
                        SatTime, SunTime, HolidayTime, Description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, name, mon, tue, wed, thu, fri, sat, sun, hol, desc))
            conn.commit()
            return {"success": True, "message": f"Đã lưu khung giờ '{name}' ({code})."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_access_group_db(data: Dict[str, Any]) -> Dict[str, Any]:
    code = str(data.get("GroupCode") or "").strip()
    name = str(data.get("GroupName") or "").strip()
    if not code or not name:
        return {"success": False, "error": "Vui lòng nhập Mã nhóm quyền và Tên nhóm quyền."}

    tz_id = int(data.get("TimezoneID") or 1)
    doors = str(data.get("AllowedDoors") or "1,2").strip()
    v_mode = str(data.get("VerifyMode") or "Face / Card / Finger").strip()
    desc = str(data.get("Description") or "").strip()

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT GroupID FROM tbl_AccessGroups WHERE GroupCode = ?", (code,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_AccessGroups
                    SET GroupName = ?, TimezoneID = ?, AllowedDoors = ?, VerifyMode = ?, Description = ?, UpdatedAt = GETDATE()
                    WHERE GroupCode = ?
                """, (name, tz_id, doors, v_mode, desc, code))
            else:
                cur.execute("""
                    INSERT INTO tbl_AccessGroups (GroupCode, GroupName, TimezoneID, AllowedDoors, VerifyMode, Description)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (code, name, tz_id, doors, v_mode, desc))
            conn.commit()
            return {"success": True, "message": f"Đã lưu nhóm phân quyền cửa '{name}'."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_shift_db(data: Dict[str, Any]) -> Dict[str, Any]:
    code = str(data.get("ShiftCode") or "").strip()
    name = str(data.get("ShiftName") or "").strip()
    if not code or not name:
        return {"success": False, "error": "Vui lòng nhập Mã ca và Tên ca làm việc."}

    cin = str(data.get("CheckInTime") or "08:00").strip()
    cout = str(data.get("CheckOutTime") or "17:30").strip()
    b_start = str(data.get("BreakStartTime") or "12:00").strip()
    b_end = str(data.get("BreakEndTime") or "13:30").strip()
    late = int(data.get("GraceLateMinutes") or 5)
    early = int(data.get("GraceEarlyMinutes") or 5)
    hours = float(data.get("WorkingHours") or 8.0)

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT ShiftID FROM tbl_Shifts WHERE ShiftCode = ?", (code,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_Shifts
                    SET ShiftName = ?, CheckInTime = ?, CheckOutTime = ?, BreakStartTime = ?, BreakEndTime = ?,
                        GraceLateMinutes = ?, GraceEarlyMinutes = ?, WorkingHours = ?, UpdatedAt = GETDATE()
                    WHERE ShiftCode = ?
                """, (name, cin, cout, b_start, b_end, late, early, hours, code))
            else:
                cur.execute("""
                    INSERT INTO tbl_Shifts (
                        ShiftCode, ShiftName, CheckInTime, CheckOutTime, BreakStartTime, BreakEndTime,
                        GraceLateMinutes, GraceEarlyMinutes, WorkingHours
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, name, cin, cout, b_start, b_end, late, early, hours))
            conn.commit()
            return {"success": True, "message": f"Đã lưu cấu hình ca làm việc '{name}' ({code})."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def log_device_command_db(cmd_code: str, target_serial: str, target_name: str, payload: Any, status: str, result_msg: str, operator: str) -> None:
    if not is_mssql_active():
        return
    try:
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO tbl_DeviceCommands (
                    CommandCode, TargetSerial, TargetDeviceName, PayloadJson, Protocol, Status, ResultMessage, RequestedBy
                ) VALUES (?, ?, ?, ?, 'DIRECT_TCP_4370', ?, ?, ?)
            """, (
                cmd_code, target_serial, target_name,
                json.dumps(payload, ensure_ascii=False) if not isinstance(payload, str) else payload,
                status, result_msg, operator
            ))
            conn.commit()
    except Exception as e:
        logger.debug("log_device_command_db warning: %s", e)


def log_door_audit_db(
    door_id: int,
    door_name: str,
    action: str,
    duration_sec: int,
    operator: str,
    success: bool = True,
    timestamp_str: Optional[str] = None
) -> None:
    if not is_mssql_active():
        return
    try:
        try:
            created_dt = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S") if timestamp_str else datetime.now()
        except Exception:
            created_dt = datetime.now()
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                IF NOT EXISTS (
                    SELECT 1 FROM tbl_DoorAuditLogs
                    WHERE DoorID = ? AND Action = ? AND CreatedAt = ?
                )
                BEGIN
                    INSERT INTO tbl_DoorAuditLogs (DoorID, DoorName, Action, DurationSec, Operator, Success, CreatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                END
            """, (
                int(door_id or 0), str(action or "UNLOCK"), created_dt,
                int(door_id or 0), str(door_name or ""), str(action or "UNLOCK"),
                int(duration_sec or 0), str(operator or "Quản trị viên"), 1 if success else 0, created_dt
            ))
            conn.commit()
    except Exception as e:
        logger.debug("log_door_audit_db warning: %s", e)


def log_clock_sync_audit_db(audit_type: str, audit_data: Dict[str, Any], confirm_code: str, operator: str, status: str) -> None:
    if not is_mssql_active():
        return
    try:
        vn_str = audit_data.get("vietnam_ntp_time") or audit_data.get("local_pc_time") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pc_str = audit_data.get("local_pc_time") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        vn_dt = datetime.strptime(vn_str, "%Y-%m-%d %H:%M:%S")
        pc_dt = datetime.strptime(pc_str, "%Y-%m-%d %H:%M:%S")
        drift = float(audit_data.get("pc_drift_sec") or 0.0)
        with pyodbc.connect(get_connection_string(), timeout=4) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO tbl_ClockSyncAuditLogs (
                    AuditType, VietnamNtpTime, NtpServerUsed, LocalPcTime, LocalPcDriftSeconds,
                    DevicesSummaryJson, ConfirmationCode, Operator, Status
                ) VALUES (?, ?, 'time.google.com / vn.pool.ntp.org', ?, ?, ?, ?, ?, ?)
            """, (
                audit_type, vn_dt, pc_dt, drift,
                json.dumps(audit_data.get("devices", {}), ensure_ascii=False),
                confirm_code, operator, status
            ))
            conn.commit()
    except Exception as e:
        logger.debug("log_clock_sync_audit_db warning: %s", e)
