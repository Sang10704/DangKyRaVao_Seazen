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
                            EmployeeATID, FullName, Department, DeviceSerialNumber, DeviceName, Direction,
                            CheckTime, VerifyMode, VerifyModeValue, InOutMode, IsStaff, SyncSource
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    END
                """, (
                    atid, dt_obj, device_sn,
                    atid, full_name, dept, device_sn, device_name, direction,
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
                    DoorID, DoorCode, DoorName, ActionType,
                    TriggerSource, RequestedBy, Reason, ExecutionStatus, Message, CreatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                action.get("door_id"),
                action.get("door_code") or "",
                action.get("door_name") or "",
                action.get("action") or "MANUAL_OPEN",
                action.get("source") or "WEB_PORTAL",
                action.get("user") or action.get("requested_by") or "Lễ tân",
                action.get("reason") or "",
                action.get("status") or "SUCCESS",
                action.get("message") or "",
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

