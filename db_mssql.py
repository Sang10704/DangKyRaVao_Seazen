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


def get_departments() -> List[Dict[str, Any]]:
    if not is_mssql_active():
        return []
    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DepartmentID, DepartmentCode, DepartmentName, ParentID, Level, Description, IsActive
                FROM tbl_Departments
                WHERE IsActive = 1
                ORDER BY Level ASC, DepartmentName ASC
            """)
            columns = [col[0] for col in cursor.description]
            results = []
            for row in cursor.fetchall():
                results.append(dict(zip(columns, row)))
            return results
    except Exception as e:
        logger.error("MSSQL get_departments error: %s", e)
        return []


def get_employees(q: str = "", department: str = "", page: int = 1, limit: int = 50) -> Dict[str, Any]:
    if not is_mssql_active():
        return {"items": [], "total": 0, "page": page, "limit": limit}

    try:
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=5) as conn:
            cursor = conn.cursor()
            where_clauses = [
                "e.IsActive = 1",
                "e.IsStaff = 1",
                "e.DepartmentName IS NOT NULL",
                "e.DepartmentName <> ''",
                "e.DepartmentName <> N'Khác'"
            ]
            params: List[Any] = []

            if q:
                search_term = f"%{q.strip()}%"
                where_clauses.append("(e.EmployeeATID LIKE ? OR e.EmployeeCode LIKE ? OR e.FullName LIKE ? OR e.CardNumber LIKE ? OR e.Phone LIKE ?)")
                params.extend([search_term, search_term, search_term, search_term, search_term])

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
                    e.Email, e.Phone, e.IsStaff, e.IsActive,
                    b.HasFace, b.HasCard, b.HasFinger, b.FacePhotoBase64
                FROM tbl_Employees e
                LEFT JOIN tbl_Departments d ON e.DepartmentID = d.DepartmentID
                LEFT JOIN tbl_EmployeeBiometrics b ON e.EmployeeATID = b.EmployeeATID
                WHERE {where_sql}
                ORDER BY e.FullName ASC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """
            cursor.execute(query_sql, paged_params)
            columns = [col[0] for col in cursor.description]
            items = []
            for row in cursor.fetchall():
                row_dict = dict(zip(columns, row))
                items.append({
                    "EmployeeID": row_dict["EmployeeID"],
                    "EmployeeATID": row_dict["EmployeeATID"],
                    "EmployeeCode": row_dict["EmployeeCode"] or row_dict["EmployeeATID"],
                    "FullName": row_dict["FullName"],
                    "DepartmentName": row_dict["DepartmentName"] or "Khác",
                    "DepartmentID": row_dict["DepartmentID"],
                    "Position": row_dict["Position"] or "",
                    "CardNumber": row_dict["CardNumber"] or "",
                    "Email": row_dict["Email"] or "",
                    "Phone": row_dict["Phone"] or "",
                    "IsStaff": bool(row_dict["IsStaff"]),
                    "HasFace": bool(row_dict["HasFace"]),
                    "HasCard": bool(row_dict["CardNumber"] or row_dict["HasCard"]),
                    "HasFinger": bool(row_dict["HasFinger"]),
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
                verify_val = scan.get("VerifyModeValue")
                in_out = scan.get("InOutMode", 0)
                is_staff = 1 if scan.get("is_staff", True) else 0
                sync_source = str(scan.get("SyncSource") or "DIRECT_TCP")

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
            conn.commit()
    except Exception as e:
        logger.error("MSSQL insert_attendance_logs_bulk error: %s", e)
    return inserted


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
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                       HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, CheckoutTime,
                       DurationMinutes, Status, Operator
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
                    "card_number": d["CardNumber"] or "",
                    "company": d["Company"] or "",
                    "department": d["Department"] or "",
                    "host_person": d["HostPerson"] or "",
                    "purpose": d["Purpose"] or "",
                    "checkin_time": cin_time,
                    "expected_checkout_time": exp_time,
                    "status": "ACTIVE",
                    "operator": d["Operator"] or "Bảo vệ"
                })
            return items
    except Exception as e:
        logger.error("MSSQL get_active_visitors_db error: %s", e)
        return []


def insert_visitor_db(v: Dict[str, Any]) -> bool:
    if not is_mssql_active():
        return False
    try:
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

            cursor.execute("""
                IF NOT EXISTS (SELECT 1 FROM tbl_Visitors WHERE VisitorID = ?)
                BEGIN
                    INSERT INTO tbl_Visitors (
                        VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                        HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, Status, Operator
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
                END
                ELSE
                BEGIN
                    UPDATE tbl_Visitors
                    SET FullName = ?, CCCDNumber = ?, CardNumber = ?, Company = ?, Department = ?,
                        HostPerson = ?, Purpose = ?, CheckinTime = ?, ExpectedCheckoutTime = ?, Status = 'ACTIVE'
                    WHERE VisitorID = ?
                END
            """, (
                v_id,
                v_id, v.get("full_name") or "Khách", v.get("cccd_number") or "",
                v.get("card_number") or "", v.get("company") or "", v.get("department") or "",
                v.get("host_person") or "", v.get("purpose") or "", cin_dt, exp_dt,
                v.get("operator") or "Bảo vệ",
                v.get("full_name") or "Khách", v.get("cccd_number") or "",
                v.get("card_number") or "", v.get("company") or "", v.get("department") or "",
                v.get("host_person") or "", v.get("purpose") or "", cin_dt, exp_dt,
                v_id
            ))
            conn.commit()
            return True
    except Exception as e:
        logger.error("MSSQL insert_visitor_db error: %s", e)
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
        conn_str = get_connection_string()
        with pyodbc.connect(conn_str, timeout=4) as conn:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT TOP ({limit}) VisitorID, FullName, CCCDNumber, CardNumber, Company, Department,
                       HostPerson, Purpose, CheckinTime, ExpectedCheckoutTime, CheckoutTime,
                       DurationMinutes, Status, Operator
                FROM tbl_Visitors
                ORDER BY CheckinTime DESC
            """)
            cols = [col[0] for col in cursor.description]
            items = []
            for row in cursor.fetchall():
                d = dict(zip(cols, row))
                cin_time = d["CheckinTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckinTime") else ""
                cout_time = d["CheckoutTime"].strftime("%Y-%m-%d %H:%M:%S") if d.get("CheckoutTime") else ""
                
                # Duration string
                duration_str = "--"
                if d.get("CheckinTime") and d.get("CheckoutTime"):
                    mins = int((d["CheckoutTime"] - d["CheckinTime"]).total_seconds() / 60)
                    hrs, rm = divmod(max(0, mins), 60)
                    duration_str = f"{hrs}h {rm}m" if hrs > 0 else f"{rm} phút"

                items.append({
                    "id": d["VisitorID"],
                    "full_name": d["FullName"] or "Khách",
                    "cccd_number": d["CCCDNumber"] or "",
                    "card_number": d["CardNumber"] or "",
                    "company": d["Company"] or "",
                    "department": d["Department"] or "",
                    "host_person": d["HostPerson"] or "",
                    "purpose": d["Purpose"] or "",
                    "checkin_time": cin_time,
                    "checkout_time": cout_time,
                    "duration_str": duration_str,
                    "status": d["Status"] or "CHECKED_OUT",
                    "operator": d["Operator"] or "Bảo vệ"
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
        with pyodbc.connect(conn_str, timeout=6) as conn:
            cur = conn.cursor()
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

    emp_code = str(data.get("EmployeeCode") or data.get("code") or atid).strip()
    dept_name = str(data.get("DepartmentName") or data.get("department") or "HC QTNS").strip()
    position = str(data.get("Position") or data.get("position") or "").strip()
    card_num = str(data.get("CardNumber") or data.get("card_number") or "").strip() or None
    privilege = int(data.get("Privilege") or 0)
    email = str(data.get("Email") or data.get("email") or "").strip()
    phone = str(data.get("Phone") or data.get("phone") or "").strip()
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
                cur.execute("""
                    UPDATE tbl_Employees
                    SET EmployeeCode = ?, FullName = ?, DepartmentID = ?, DepartmentName = ?,
                        Position = ?, CardNumber = ?, Privilege = ?, Email = ?, Phone = ?, IsStaff = 1, IsActive = 1, UpdatedAt = GETDATE()
                    WHERE EmployeeATID = ?
                """, (emp_code, full_name, dept_id, dept_name, position, card_num, privilege, email, phone, atid))
            else:
                cur.execute("""
                    INSERT INTO tbl_Employees (
                        EmployeeID, EmployeeATID, EmployeeCode, FullName, DepartmentID, DepartmentName,
                        Position, CardNumber, Privilege, Email, Phone, IsStaff, IsActive
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
                """, (f"SZ-{atid}", atid, emp_code, full_name, dept_id, dept_name, position, card_num, privilege, email, phone))

            cur.execute("SELECT BiometricID FROM tbl_EmployeeBiometrics WHERE EmployeeATID = ?", (atid,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_EmployeeBiometrics
                    SET FacePhotoBase64 = COALESCE(?, FacePhotoBase64),
                        FaceTemplateBIODATA = COALESCE(?, FaceTemplateBIODATA),
                        HasFace = CASE WHEN ? = 1 THEN 1 ELSE HasFace END,
                        HasCard = ?,
                        HasFinger = CASE WHEN ? = 1 THEN 1 ELSE HasFinger END,
                        UpdatedAt = GETDATE()
                    WHERE EmployeeATID = ?
                """, (face_b64, face_biodata, has_face, has_card, has_finger, atid))
            else:
                cur.execute("""
                    INSERT INTO tbl_EmployeeBiometrics (
                        EmployeeATID, FacePhotoBase64, FaceTemplateBIODATA, HasFace, HasCard, HasFinger
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (atid, face_b64, face_biodata, has_face, has_card, has_finger))

            conn.commit()
            return {"success": True, "message": f"Đã cập nhật hồ sơ nhân sự & sinh trắc học cho {full_name} (ATID: {atid})."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def upsert_customer_card_db(data: Dict[str, Any]) -> Dict[str, Any]:
    card_num = str(data.get("CardNumber") or "").strip()
    card_code = str(data.get("CardCode") or f"CARD-{card_num}").strip()
    card_type = str(data.get("CardType") or "VISITOR").strip()
    status = str(data.get("Status") or "AVAILABLE").strip()
    notes = str(data.get("Notes") or "").strip()

    if not card_num:
        return {"success": False, "error": "Số thẻ từ RFID không được để trống."}

    try:
        with pyodbc.connect(get_connection_string(), timeout=5) as conn:
            cur = conn.cursor()
            cur.execute("SELECT CardID FROM tbl_CustomerCards WHERE CardNumber = ?", (card_num,))
            if cur.fetchone():
                cur.execute("""
                    UPDATE tbl_CustomerCards
                    SET CardCode = ?, CardType = ?, Status = ?, Notes = ?, UpdatedAt = GETDATE()
                    WHERE CardNumber = ?
                """, (card_code, card_type, status, notes, card_num))
            else:
                cur.execute("""
                    INSERT INTO tbl_CustomerCards (CardCode, CardNumber, CardType, Status, IsSyncedToDevices, Notes)
                    VALUES (?, ?, ?, ?, 1, ?)
                """, (card_code, card_num, card_type, status, notes))
            conn.commit()
            return {"success": True, "message": f"Đã lưu thẻ {card_num} vào kho thẻ."}
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
