"""
Data Storage & Persistence Layer for SeaZen Smart Access Control.
Provides JSON-based file storage for Active Visitors, Visitor History, and Door Action Audit Logs.
Includes modular hooks for future SharePoint Online synchronization.
"""

import os
import json
import uuid
from datetime import datetime
import logging
from typing import Dict, Any, List, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from werkzeug.security import generate_password_hash, check_password_hash

import time
import threading

try:
    import db_mssql
    MSSQL_AVAILABLE = True
except Exception:
    db_mssql = None
    MSSQL_AVAILABLE = False

logger = logging.getLogger("storage")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

USERS_FILE = os.path.join(DATA_DIR, "users.json")
ACTIVE_VISITORS_FILE = os.path.join(DATA_DIR, "active_visitors.json")
VISITOR_HISTORY_FILE = os.path.join(DATA_DIR, "visitor_history.json")
DOOR_ACTIONS_FILE = os.path.join(DATA_DIR, "door_actions.json")
DAILY_SCANS_FILE = os.path.join(DATA_DIR, "daily_scans.json")
DEPARTMENTS_FILE = os.path.join(DATA_DIR, "departments.json")
EMPLOYEES_FILE = os.path.join(DATA_DIR, "employees.json")

_file_locks: Dict[str, threading.RLock] = {}
_global_lock = threading.RLock()


def _get_lock(path: str) -> threading.RLock:
    with _global_lock:
        if path not in _file_locks:
            _file_locks[path] = threading.RLock()
        return _file_locks[path]


def _read_json(file_path: str, default_val: Any = None) -> Any:
    if not os.path.exists(file_path):
        return default_val if default_val is not None else []
    lock = _get_lock(file_path)
    with lock:
        for attempt in range(5):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                if attempt == 4:
                    logger.error("Error reading %s: %s", file_path, e)
                    return default_val if default_val is not None else []
                time.sleep(0.05)


def _write_json(file_path: str, data: Any) -> None:
    lock = _get_lock(file_path)
    with lock:
        tmp_file = file_path + ".tmp"
        try:
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            for attempt in range(6):
                try:
                    if os.path.exists(file_path):
                        os.replace(tmp_file, file_path)
                    else:
                        os.rename(tmp_file, file_path)
                    return
                except (PermissionError, OSError):
                    if attempt == 5:
                        # Fallback: direct write
                        with open(file_path, "w", encoding="utf-8") as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        try:
                            if os.path.exists(tmp_file): os.remove(tmp_file)
                        except Exception:
                            pass
                        return
                    time.sleep(0.08)
        except Exception as e:
            logger.error("Error writing to %s: %s", file_path, e)


IN_SERIALS = {"1313244800040", "1313244800129"}
OUT_SERIALS = {"1313244800122", "1313244800130"}


def determine_scan_direction(scan: Dict[str, Any]) -> str:
    """
    Phân định chính xác hướng di chuyển: Lượt VÀO (IN) hay Lượt RA (OUT).
    Ưu tiên 1: Tên máy/cổng ('vào' -> IN, 'ra' -> OUT).
    Ưu tiên 2: Serial number của thiết bị vật lý SenseFace 4A.
    """
    dev_name = str(scan.get("DeviceName") or "").lower()
    sn = str(scan.get("SerialNumber") or scan.get("DeviceSerialNumber") or "").strip()

    if "vào" in dev_name or "vao" in dev_name:
        return "IN"
    if "ra" in dev_name:
        return "OUT"
    if sn in IN_SERIALS:
        return "IN"
    if sn in OUT_SERIALS:
        return "OUT"

    inout = str(scan.get("InOutMode", "")).lower()
    if inout == "out" or scan.get("InOutModeValue") == 1:
        return "OUT"
    return "IN"


def determine_scan_person_type(scan: Dict[str, Any]) -> Dict[str, Any]:
    """
    Phân loại đối tượng: Nhân viên văn phòng (STAFF) vs Khách (VISITOR).
    - STAFF: Quét khuôn mặt (FaceTemplate / VerifyModeValue 15) hoặc EmployeeATID < 80000000
    - VISITOR: Quẹt thẻ RFID (Card) hoặc EmployeeATID >= 80000000 (khách tạo từ ePAD)
    """
    mode = str(scan.get("VerifyMode") or "").lower()
    val = scan.get("VerifyModeValue")
    atid = str(scan.get("EmployeeATID") or "").strip()

    is_guest_id = False
    if atid.isdigit():
        try:
            if int(atid) >= 80000000:
                is_guest_id = True
        except ValueError:
            pass

    is_face = ("face" in mode) or (val == 15)
    is_card = ("card" in mode) or (val == 1) or bool(scan.get("CardNumber"))

    if is_guest_id or (is_card and not is_face):
        return {
            "is_staff": False,
            "category": "VISITOR",
            "category_name": "Khách Đến / Thẻ RFID"
        }

    return {
        "is_staff": True,
        "category": "STAFF",
        "category_name": "Nhân Viên Văn Phòng"
    }


class StorageManager:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.sp_config = config.get("sharepoint", {})
        self.sp_enabled = self.sp_config.get("enabled", False)
        self._scans_cache: Optional[List[Dict[str, Any]]] = None
        self._scans_cache_mtime: float = 0.0
        self._scans_cache_lock = threading.RLock()
        self.seed_default_users()

    def _load_scans_cache(self) -> List[Dict[str, Any]]:
        """In-memory cache for daily scans to ensure fast concurrent reads across multiple machines."""
        with self._scans_cache_lock:
            if not os.path.exists(DAILY_SCANS_FILE):
                self._scans_cache = []
                self._scans_cache_mtime = 0.0
                return self._scans_cache
            try:
                mtime = os.path.getmtime(DAILY_SCANS_FILE)
            except OSError:
                mtime = 0.0
            if self._scans_cache is None or mtime > self._scans_cache_mtime:
                self._scans_cache = _read_json(DAILY_SCANS_FILE, [])
                self._scans_cache_mtime = mtime
            return self._scans_cache

    # ---------------- User & Authentication Management ----------------

    def seed_default_users(self) -> None:
        """Khởi tạo 2 tài khoản mặc định (admin & nhanvien) nếu users.json chưa có hoặc rỗng."""
        users = _read_json(USERS_FILE, [])
        if not users:
            admin_user = {
                "id": "usr-admin-01",
                "username": "admin",
                "email": "admin@seazen.vn",
                "password_hash": generate_password_hash("Admin@123", method="scrypt"),
                "full_name": "Quản Trị Viên Hệ Thống",
                "role": "admin",
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "is_active": True
            }
            staff_user = {
                "id": "usr-staff-01",
                "username": "nhanvien",
                "email": "nhanvien@seazen.vn",
                "password_hash": generate_password_hash("Nhanvien@123", method="scrypt"),
                "full_name": "Nhân Viên Tiếp Đón",
                "role": "staff",
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "is_active": True
            }
            users = [admin_user, staff_user]
            _write_json(USERS_FILE, users)
            logger.info("Đã khởi tạo 2 tài khoản mặc định: admin và nhanvien vào users.json")

    def get_users(self) -> List[Dict[str, Any]]:
        return _read_json(USERS_FILE, [])

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        users = self.get_users()
        for u in users:
            if u.get("id") == user_id:
                return u
        return None

    def get_user_by_credential(self, cred: str) -> Optional[Dict[str, Any]]:
        clean_cred = str(cred).strip().lower()
        if not clean_cred:
            return None
        if clean_cred == "letan":
            clean_cred = "nhanvien"
        users = self.get_users()
        for u in users:
            u_name = str(u.get("username", "")).strip().lower()
            u_email = str(u.get("email", "")).strip().lower()
            if u_name == clean_cred or u_email == clean_cred:
                return u
        return None

    def verify_user_credentials(self, username_or_email: str, password: str) -> Optional[Dict[str, Any]]:
        user = self.get_user_by_credential(username_or_email)
        if not user:
            return None
        if not user.get("is_active", True):
            return None
        pw_hash = user.get("password_hash", "")
        if pw_hash and check_password_hash(pw_hash, password):
            return user
        # Allow quick DevTest password '123' for default admin/nhanvien accounts
        if user.get("username") in ("admin", "nhanvien") and password == "123":
            return user
        return None

    # ---------------- Visitor Management ----------------

    def get_active_visitors(self) -> List[Dict[str, Any]]:
        # 1. Start with local active visitors JSON
        active_list = _read_json(ACTIVE_VISITORS_FILE, [])
        active_map: Dict[str, Dict[str, Any]] = {}
        for item in active_list:
            card_k = str(item.get("card_number") or "").strip().lower()
            clean_k = card_k.lstrip("0")
            cccd_k = str(item.get("cccd_number") or "").strip().lower()
            id_k = str(item.get("id") or "").strip().lower()
            p_key = card_k or clean_k or cccd_k or id_k
            if p_key:
                active_map[p_key] = item

        # 2. Merge from MSSQL tbl_Visitors WHERE Status = 'ACTIVE'
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_visitors = db_mssql.get_active_visitors_db()
                for dv in db_visitors:
                    c_card = str(dv.get("card_number") or "").strip().lower()
                    c_clean = c_card.lstrip("0")
                    c_cccd = str(dv.get("cccd_number") or "").strip().lower()
                    c_id = str(dv.get("id") or "").strip().lower()
                    
                    matched_k = None
                    for k in [c_card, c_clean, c_cccd, c_id]:
                        if k and k in active_map:
                            matched_k = k
                            break
                    if matched_k:
                        active_map[matched_k].update({k: v for k, v in dv.items() if v and not active_map[matched_k].get(k)})
                    else:
                        t_key = c_card or c_clean or c_cccd or c_id
                        if t_key:
                            active_map[t_key] = dv
            except Exception as e:
                logger.warning("Error fetching active visitors from MSSQL: %s", e)

        # 3. Consolidate from today's door attendance logs:
        # Any visitor who scanned IN and has not scanned OUT today is physically present
        try:
            now_dt = datetime.now()
            today_str = now_dt.strftime("%Y-%m-%d")
            present = self.get_present_details(target_date=today_str, category="VISITOR", include_active_visitors=False)
            inside_visitors = present.get("inside", [])
            for p in inside_visitors:
                card_no = str(p.get("atid") or "").strip()
                clean_c = card_no.lstrip("0")
                p_name = p.get("fullname") or f"Khách thẻ {card_no}"
                
                # Check if already in active_map
                matched = False
                for k, v in active_map.items():
                    v_card = str(v.get("card_number") or "").strip()
                    v_clean = v_card.lstrip("0")
                    if card_no and (v_card == card_no or (clean_c and v_clean == clean_c)):
                        matched = True
                        break
                    v_name = (v.get("full_name") or "").strip().lower()
                    if p_name and p_name.lower() == v_name:
                        matched = True
                        break

                if not matched and card_no:
                    cin_time = str(p.get("check_time") or "").replace("T", " ")
                    if len(cin_time) == 10:
                        cin_time += " " + p.get("time_only", "08:00:00")
                    synth_id = f"vis_{card_no}"
                    synth_item = {
                        "id": synth_id,
                        "full_name": p_name,
                        "card_number": card_no,
                        "cccd_number": "",
                        "company": "Khách Đến Tòa Nhà",
                        "department": p.get("department") if p.get("department") != "--" else "Khách Vãng Lai",
                        "host_person": "--",
                        "purpose": "Ra vào văn phòng",
                        "checkin_time": cin_time,
                        "expected_checkout_time": None,
                        "checkout_time": None,
                        "duration_str": None,
                        "status": "ACTIVE",
                        "operator": f"Cổng {p.get('device_name') or 'SenseFace'}",
                        "source": "DOOR_SCAN"
                    }
                    active_map[card_no] = synth_item
        except Exception as e:
            logger.warning("Error fetching inside visitors from door scans: %s", e)

        result = list(active_map.values())
        result.sort(key=lambda x: str(x.get("checkin_time") or ""), reverse=True)
        return result

    def get_visitor_history(self, limit: int = 500) -> List[Dict[str, Any]]:
        history = _read_json(VISITOR_HISTORY_FILE, [])
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_hist = db_mssql.get_visitor_history_db(limit=limit)
                seen_ids = {str(h.get("id") or "").strip(): True for h in history if h.get("id")}
                for dh in db_hist:
                    dh_id = str(dh.get("id") or "").strip()
                    if dh_id and dh_id not in seen_ids:
                        history.append(dh)
                        seen_ids[dh_id] = True
            except Exception as e:
                logger.warning("Error fetching visitor history from MSSQL: %s", e)

        return sorted(history, key=lambda x: x.get("checkin_time", ""), reverse=True)[:limit]

    def add_visitor(self, visitor_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Adds a visitor to the active visitors list.
        Supports full CCCD QR parsed data and manual visitor inputs.
        """
        active = self.get_active_visitors()
        card_num = str(visitor_data.get("card_number", "")).strip()
        clean_c = card_num.lstrip("0")
        cccd_num = str(visitor_data.get("cccd_number", "")).strip() or str(visitor_data.get("id_number", "")).strip()

        # Check if card is already registered as active (if card provided)
        if card_num:
            for item in active:
                item_card = str(item.get("card_number", "")).strip()
                item_clean = item_card.lstrip("0")
                if item_card and (item_card == card_num or (clean_c and item_clean == clean_c)):
                    raise ValueError(f"Thẻ {card_num} đang được sử dụng bởi khách: {item.get('full_name')}!")

        # Check if CCCD is already registered as active (if CCCD provided)
        if cccd_num:
            for item in active:
                existing_cccd = str(item.get("cccd_number", "")).strip() or str(item.get("id_number", "")).strip()
                if existing_cccd and existing_cccd == cccd_num:
                    raise ValueError(f"Số CCCD {cccd_num} ({item.get('full_name')}) đã được đăng ký và đang có mặt trong tòa nhà!")

        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        today_str = now.strftime("%Y-%m-%d")
        time_str = now.strftime("%H:%M:%S")

        # Parse birth date and birth year if available
        dob = str(visitor_data.get("birth_date", "")).strip()
        birth_year = str(visitor_data.get("birth_year", "")).strip()
        if not birth_year and dob:
            # If format is DD/MM/YYYY or DDMMYYYY
            clean_dob = dob.replace("/", "").replace("-", "")
            if len(clean_dob) == 8:
                birth_year = clean_dob[4:]

        cin_d = str(visitor_data.get("checkin_date", "")).strip() or today_str
        cin_t = str(visitor_data.get("checkin_time", "")).strip() or time_str[:5]
        if len(cin_t) == 5:
            cin_t += ":00"
        checkin_full = f"{cin_d} {cin_t}".strip()

        cout_d = str(visitor_data.get("expected_checkout_date", "")).strip() or cin_d
        cout_t = str(visitor_data.get("expected_checkout_time", "")).strip() or "16:45"
        if len(cout_t) == 5:
            cout_t += ":00"
        expected_checkout_full = f"{cout_d} {cout_t}".strip()

        record = {
            "id": str(uuid.uuid4())[:8],
            "cccd_number": cccd_num,
            "full_name": visitor_data.get("full_name", "").strip(),
            "birth_date": dob,
            "birth_year": birth_year,
            "phone": visitor_data.get("phone", "").strip(),
            "company": visitor_data.get("company", "").strip(),
            "host_person": visitor_data.get("host_person", "").strip(),
            "host_phone": visitor_data.get("host_phone", "").strip(),
            "department": visitor_data.get("department", "").strip(),
            "access_area": visitor_data.get("access_area", "").strip(),
            "note": visitor_data.get("note", "").strip(),
            "purpose": visitor_data.get("purpose", "").strip() or visitor_data.get("reason", "").strip(),
            "vehicle_number": visitor_data.get("vehicle_number", "").strip(),
            "card_number": card_num,
            "checkin_time": checkin_full,
            "expected_checkout_time": expected_checkout_full,
            "checkout_time": None,
            "duration_str": None,
            "status": "ACTIVE",
            "operator": visitor_data.get("operator", "Bảo vệ")
        }

        # Save to local JSON
        active_saved = _read_json(ACTIVE_VISITORS_FILE, [])
        active_saved.append(record)
        _write_json(ACTIVE_VISITORS_FILE, active_saved)

        # Hook for MSSQL
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_mssql.insert_visitor_db(record)
            except Exception as ex:
                logger.warning("Failed to insert visitor to MSSQL: %s", ex)

        # Hook for SharePoint
        if self.sp_enabled:
            self._sync_visitor_to_sharepoint(record, is_checkout=False)

        return record

    def checkout_visitor(self, query_key: str) -> Optional[Dict[str, Any]]:
        """
        Completes visitor visit and moves record to history.
        Matches by id, cccd_number, card_number, or cmnd_old.
        """
        active = self.get_active_visitors()
        query = str(query_key).strip().lower()
        if not query:
            return None

        clean_query = query.lstrip("0")
        matched = None
        remaining = []

        for item in active:
            item_id = str(item.get("id", "")).strip().lower()
            item_card = str(item.get("card_number", "")).strip().lower()
            clean_item_card = item_card.lstrip("0")
            item_cccd = str(item.get("cccd_number", "")).strip().lower()
            item_phone = str(item.get("phone", "")).strip().lower()

            is_match = False
            if matched is None:
                if item_id == query:
                    is_match = True
                elif item_card and (item_card == query or (clean_item_card and clean_item_card == clean_query)):
                    is_match = True
                elif item_cccd and (item_cccd == query or (len(query) >= 9 and query in item_cccd)):
                    is_match = True
                elif item_phone and len(query) >= 9 and item_phone == query:
                    is_match = True

            if is_match:
                matched = item
            else:
                remaining.append(item)

        if not matched:
            logger.warning("[CHECKOUT] Không tìm thấy khách với query='%s' trong %d khách active", query, len(active))
            return None

        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        matched["checkout_time"] = now_str
        matched["status"] = "COMPLETED"

        # Calculate duration
        try:
            t1 = datetime.strptime(matched["checkin_time"], "%Y-%m-%d %H:%M:%S")
            t2 = datetime.strptime(now_str, "%Y-%m-%d %H:%M:%S")
            mins = int((t2 - t1).total_seconds() / 60)
            hours, remainder_mins = divmod(mins, 60)
            matched["duration_str"] = f"{hours}h {remainder_mins}m" if hours > 0 else f"{remainder_mins} phút"
        except Exception:
            matched["duration_str"] = "N/A"

        _write_json(ACTIVE_VISITORS_FILE, remaining)

        # Save to history
        history = _read_json(VISITOR_HISTORY_FILE, [])
        history.append(matched)
        _write_json(VISITOR_HISTORY_FILE, history)

        # Update MSSQL
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_mssql.checkout_visitor_db(query, now_str)
                if matched.get("card_number"):
                    db_mssql.checkout_visitor_db(matched["card_number"], now_str)
                if matched.get("id"):
                    db_mssql.checkout_visitor_db(matched["id"], now_str)
            except Exception as e:
                logger.warning("Failed to checkout visitor in MSSQL: %s", e)

        # Record an OUT attendance log so door analytics immediately update
        card_val = matched.get("card_number") or matched.get("id")
        out_scan = {
            "EmployeeATID": str(card_val),
            "FullName": matched.get("full_name") or "Khách",
            "DepartmentName": matched.get("department") or "Khách",
            "Department": matched.get("department") or "Khách",
            "DeviceName": "Làn RA trái",
            "SerialNumber": "1313244800122",
            "DoorName": "Cửa Làn RA",
            "Direction": "OUT",
            "CardNumber": matched.get("card_number") or "",
            "VerifyMode": 1,
            "Time": now_str,
            "CheckTime": now_str.replace(" ", "T"),
            "is_staff": False,
            "direction": "OUT"
        }
        try:
            self.save_scan(out_scan)
            if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
                db_mssql.insert_attendance_log(out_scan)
        except Exception as e:
            logger.warning("Failed to record OUT attendance log on checkout: %s", e)

        # Hook for SharePoint
        if self.sp_enabled:
            self._sync_visitor_to_sharepoint(matched, is_checkout=True)

        return matched

    # ---------------- Department & Personnel Cache ----------------

    def set_department_tree(self, tree: List[Dict[str, Any]]) -> None:
        """Parses and caches company department hierarchy."""
        depts = []
        def traverse(node):
            name = (node.get("Name") or "").strip()
            ntype = str(node.get("Type", "")).lower()
            nid = node.get("ID")
            if name and nid != -1 and ("dept" in ntype or "department" in ntype or nid > 0):
                depts.append({
                    "id": nid,
                    "name": name,
                    "code": str(node.get("Code", ""))
                })
            for child in node.get("ListChildrent", []):
                traverse(child)
        for it in tree:
            traverse(it)
        seen_names = set()
        clean_depts = []
        for d in depts:
            if d["name"] not in seen_names and d["name"] != "Khách":
                seen_names.add(d["name"])
                clean_depts.append(d)
        if clean_depts:
            _write_json(DEPARTMENTS_FILE, clean_depts)

    def get_departments(self) -> List[Dict[str, Any]]:
        """Returns cached company departments list, querying SQL Server if enabled."""
        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                sql_depts = db_mssql.get_departments()
                if sql_depts:
                    return [
                        {
                            "id": d["DepartmentID"],
                            "name": d["DepartmentName"],
                            "code": d.get("DepartmentCode") or "",
                            "level": d.get("Level", 1)
                        }
                        for d in sql_depts
                    ]
        except Exception as e:
            logger.debug("MSSQL get_departments fallback: %s", e)
        return _read_json(DEPARTMENTS_FILE, [])

    def set_employees(self, employees: List[Dict[str, Any]]) -> None:
        """Caches employee list with departments from ePAD."""
        cleaned = []
        for e in employees:
            fn = str(e.get("FullName", "")).strip()
            if not fn:
                continue
            cleaned.append({
                "atid": str(e.get("EmployeeATID", "")),
                "code": str(e.get("EmployeeCode", "")),
                "fullname": fn,
                "department": str(e.get("Department") or "").strip(),
                "department_index": e.get("DepartmentIndex")
            })
        if cleaned:
            _write_json(EMPLOYEES_FILE, cleaned)

    def get_employees(self, department: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns employees, querying Microsoft SQL Server first with seamless local fallback."""
        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                sql_res = db_mssql.get_employees(department=department or "", limit=2000)
                if sql_res and sql_res.get("items"):
                    return [
                        {
                            "atid": e["EmployeeATID"],
                            "code": e["EmployeeCode"],
                            "fullname": e["FullName"],
                            "department": e["DepartmentName"],
                            "department_index": e.get("DepartmentID"),
                            "has_face": e.get("HasFace", False),
                            "has_card": e.get("HasCard", False),
                            "has_finger": e.get("HasFinger", False),
                            "card_number": e.get("CardNumber", ""),
                            "face_photo": e.get("FaceImageBase64")
                        }
                        for e in sql_res["items"]
                    ]
        except Exception as e:
            logger.debug("MSSQL get_employees fallback: %s", e)

        all_emps = _read_json(EMPLOYEES_FILE, [])
        all_emps = [
            e for e in all_emps
            if str(e.get("department") or "").strip() not in ["", "Khác", "--", "None"]
            and not str(e.get("atid") or "").startswith("80000")
        ]
        if department:
            dept_clean = department.strip().lower()
            dept_core = dept_clean.replace("phòng", "").strip()
            return [
                e for e in all_emps
                if e.get("department", "").strip().lower() == dept_clean
                or (dept_core and dept_core in e.get("department", "").lower())
            ]
        return all_emps

    # ---------------- Persistent Scan Logs Cache ----------------

    def merge_and_save_scans(self, new_logs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Saves and accumulates scans in permanent storage without duplicates.
        Prevents losing scans when ePAD circular buffer shifts.
        """
        today_str = datetime.now().strftime("%Y-%m-%d")
        if not new_logs:
            return self.get_saved_scans(today_str)

        saved_logs = self._load_scans_cache()

        seen_keys = set()
        merged = []
        for l in saved_logs:
            chk = str(l.get("CheckTime") or l.get("Time") or "")
            who = str(l.get("EmployeeATID") or l.get("FullName") or "")
            dev = str(l.get("SerialNumber") or l.get("DeviceSerialNumber") or "")
            key = f"{chk}_{who}_{dev}"
            if key not in seen_keys:
                seen_keys.add(key)
                merged.append(l)

        # Build employee index for metadata enrichment
        emp_map = {}
        for emp in self.get_employees():
            atid = str(emp.get("atid") or "").strip()
            code = str(emp.get("code") or "").strip()
            fn = str(emp.get("fullname") or "").strip().lower()
            if atid:
                emp_map[atid] = emp
            if code:
                emp_map[code] = emp
            if fn:
                emp_map[fn] = emp

        added_count = 0
        for l in new_logs:
            if "CheckTime" not in l and "Time" in l:
                l["CheckTime"] = l["Time"]
            chk = str(l.get("CheckTime") or l.get("Time") or "")
            who = str(l.get("EmployeeATID") or l.get("FullName") or "")
            dev = str(l.get("SerialNumber") or l.get("DeviceSerialNumber") or "")
            key = f"{chk}_{who}_{dev}"

            atid = str(l.get("EmployeeATID") or "").strip()
            name = str(l.get("FullName") or "").strip()
            matched_emp = emp_map.get(atid) or emp_map.get(name.lower())
            if matched_emp:
                if not l.get("Department") or l.get("Department") == "--":
                    l["Department"] = matched_emp.get("department")
                if not l.get("FullName") or l.get("FullName") == "--" or str(l.get("FullName")).startswith("User "):
                    l["FullName"] = matched_emp.get("fullname")

            if key not in seen_keys:
                seen_keys.add(key)
                merged.append(l)
                added_count += 1

        if added_count > 0:
            merged.sort(key=lambda x: str(x.get("CheckTime", "")), reverse=True)
            if len(merged) > 50000:
                merged = merged[:50000]
            with self._scans_cache_lock:
                self._scans_cache = merged
                self._scans_cache_mtime = time.time()
            _write_json(DAILY_SCANS_FILE, merged)

            # Parallel write to Microsoft SQL Server tbl_AttendanceLogs
            try:
                import db_mssql
                if db_mssql.is_mssql_active():
                    inserted_db = db_mssql.insert_attendance_logs_bulk(new_logs)
                    if inserted_db > 0:
                        logger.info("[Storage] Đã lưu %d lượt quét mới vào CSDL Microsoft SQL Server", inserted_db)
            except Exception as e:
                logger.debug("[Storage] Lỗi lưu log vào MSSQL: %s", e)

        return [l for l in merged if str(l.get("CheckTime", "")).startswith(today_str)]

    def get_latest_scan_time(self) -> Optional[datetime]:
        """Returns the latest CheckTime across MSSQL or local cache for incremental harvesting."""
        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                db_latest = db_mssql.get_latest_attendance_time()
                if db_latest:
                    return db_latest
        except Exception:
            pass

        saved_logs = self._load_scans_cache()
        if saved_logs:
            for l in saved_logs:
                chk = str(l.get("CheckTime") or l.get("Time") or "")
                if chk:
                    try:
                        return datetime.strptime(chk, "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        pass
        return None

    def sync_epad_7day_logs(self, log_dict: Dict[str, List[Dict[str, Any]]]) -> int:
        """Merges historical 7-day logs from ePAD into daily_scans.json without duplicates."""
        all_new = []
        for day_str, logs in log_dict.items():
            if isinstance(logs, list):
                for item in logs:
                    if "CheckTime" not in item and "Time" in item:
                        item["CheckTime"] = item["Time"]
                    all_new.append(item)
        if all_new:
            self.merge_and_save_scans(all_new)
        return len(all_new)

    def get_saved_scans(self, target_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns all accumulated scans recorded for target_date (defaults to today) via in-memory cache."""
        date_str = target_date or datetime.now().strftime("%Y-%m-%d")
        all_logs = self._load_scans_cache()
        return [l for l in all_logs if str(l.get("CheckTime", "")).startswith(date_str)]

    def get_available_dates(self) -> List[str]:
        """Returns all unique dates (YYYY-MM-DD) available in scan and visitor history."""
        saved_logs = self._load_scans_cache()
        history = self.get_visitor_history(limit=5000)
        dates = set()
        for l in saved_logs:
            t = str(l.get("CheckTime", ""))
            if len(t) >= 10 and t[4] == '-' and t[7] == '-':
                dates.add(t[:10])
        for v in history:
            t = str(v.get("checkin_time", ""))
            if len(t) >= 10 and t[4] == '-' and t[7] == '-':
                dates.add(t[:10])
        today = datetime.now().strftime("%Y-%m-%d")
        dates.add(today)
        return sorted(list(dates), reverse=True)

    # ---------------- Dashboard & Analytics Engine ----------------

    def get_dashboard_analytics(self, target_date: Optional[str] = None, realtime_logs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Computes 100% real-time or historical KPI metrics, hourly access volume, and department analytics
        directly and reversely from the single door scan logs table (daily_scans.json).
        Guarantees:
        - total_in = staff_in_scans + visitor_in_scans
        - total_out = staff_out_scans + visitor_out_scans
        - staff_present_count: count of staff whose latest scan today was an IN scan.
        - visitor_present_count: count of visitors whose latest scan today was an IN scan.
        """
        now = datetime.now()
        selected_date = target_date or now.strftime("%Y-%m-%d")
        is_today = (selected_date == now.strftime("%Y-%m-%d"))

        # Merge latest realtime scans if provided
        if is_today and realtime_logs:
            scans_for_date = self.merge_and_save_scans(realtime_logs)
        else:
            scans_for_date = self.get_saved_scans(selected_date)

        # Sort scans chronologically ascending to calculate timeline and presence
        sorted_scans = sorted(scans_for_date, key=lambda x: str(x.get("CheckTime") or x.get("Time") or ""))

        staff_in_scans = 0
        staff_out_scans = 0
        visitor_in_scans = 0
        visitor_out_scans = 0

        staff_unique = set()
        visitor_unique = set()

        person_latest: Dict[str, Dict[str, Any]] = {}

        hourly_labels = [f"{h:02d}:00" for h in range(6, 23)]
        hourly_staff_map = {f"{h:02d}": 0 for h in range(6, 23)}
        hourly_visitor_map = {f"{h:02d}": 0 for h in range(6, 23)}
        dept_counts: Dict[str, int] = {}

        # Build employee index for department and name enrichment
        emp_map = {}
        for emp in self.get_employees():
            atid = str(emp.get("atid") or "").strip()
            code = str(emp.get("code") or "").strip()
            fn = str(emp.get("fullname") or "").strip().lower()
            if atid:
                emp_map[atid] = emp
            if code:
                emp_map[code] = emp
            if fn:
                emp_map[fn] = emp

        for l in sorted_scans:
            direction = determine_scan_direction(l)
            ptype = determine_scan_person_type(l)
            is_staff = ptype["is_staff"]

            atid = str(l.get("EmployeeATID") or "").strip()
            name = str(l.get("FullName") or "").strip()
            card = str(l.get("CardNumber") or "").strip()

            matched_emp = emp_map.get(atid) or emp_map.get(name.lower())
            d_name = l.get("Department")
            if (not d_name or d_name == "--") and matched_emp:
                d_name = matched_emp.get("department")
                l["Department"] = d_name

            if (not name or name == "--" or name.startswith("User ")) and matched_emp:
                name = matched_emp.get("fullname")
                l["FullName"] = name

            pkey = atid or name or card or "UNKNOWN"

            if is_staff:
                staff_unique.add(pkey)
                if direction == "IN":
                    staff_in_scans += 1
                else:
                    staff_out_scans += 1
            else:
                visitor_unique.add(pkey)
                if direction == "IN":
                    visitor_in_scans += 1
                else:
                    visitor_out_scans += 1

            chk_time = str(l.get("CheckTime") or l.get("Time") or "")
            person_latest[pkey] = {
                "key": pkey,
                "atid": atid,
                "fullname": name or "Chưa rõ",
                "department": d_name or "--",
                "check_time": chk_time,
                "device_name": l.get("DeviceName") or "--",
                "serial_number": l.get("SerialNumber") or "--",
                "direction": direction,
                "is_staff": is_staff,
                "verify_mode": l.get("VerifyMode") or ("FaceTemplate" if is_staff else "Card")
            }

            # Hourly distribution derived purely from CheckTime
            try:
                time_part = chk_time.split("T")[-1] if "T" in chk_time else chk_time.split(" ")[-1]
                hh = time_part.split(":")[0]
                if hh in hourly_staff_map:
                    if is_staff:
                        hourly_staff_map[hh] += 1
                    else:
                        hourly_visitor_map[hh] += 1
            except Exception:
                pass

            # Department counts
            if d_name and d_name != "--":
                dept_counts[d_name] = dept_counts.get(d_name, 0) + 1

        # Who is currently inside the office vs who has left?
        # Latest scan was IN -> Inside office
        staff_present = [p for p in person_latest.values() if p["is_staff"] and p["direction"] == "IN"]
        staff_checked_out = [p for p in person_latest.values() if p["is_staff"] and p["direction"] == "OUT"]
        visitor_present = [p for p in person_latest.values() if not p["is_staff"] and p["direction"] == "IN"]
        visitor_checked_out = [p for p in person_latest.values() if not p["is_staff"] and p["direction"] == "OUT"]

        total_in = staff_in_scans + visitor_in_scans
        total_out = staff_out_scans + visitor_out_scans

        hourly_staff_data = [hourly_staff_map[f"{h:02d}"] for h in range(6, 23)]
        hourly_visitor_data = [hourly_visitor_map[f"{h:02d}"] for h in range(6, 23)]

        top_staff_departments = sorted(
            [{"name": k, "count": v} for k, v in dept_counts.items() if k and k != "--"],
            key=lambda x: x["count"],
            reverse=True
        )[:6]

        # Calculate visitor departments from registration and checkins for the selected date
        visitor_dept_counts: Dict[str, int] = {}
        all_registered_visitors = self.get_active_visitors() + self.get_visitor_history(limit=5000)

        # Build map for fast matching by card / atid / fullname
        v_meta_by_key: Dict[str, str] = {}
        for v in all_registered_visitors:
            v_dept = (v.get("department") or "").strip()
            if v_dept and v_dept != "--":
                card = (v.get("card_number") or "").strip().lstrip("0")
                fn = (v.get("full_name") or "").strip().lower()
                if card:
                    v_meta_by_key[card] = v_dept
                if fn:
                    v_meta_by_key[fn] = v_dept

            t = str(v.get("checkin_time") or v.get("checkin_date") or "")
            if t.startswith(selected_date):
                if v_dept and v_dept != "--":
                    visitor_dept_counts[v_dept] = visitor_dept_counts.get(v_dept, 0) + 1

        # Also for any visitor in person_latest who hasn't been counted, if they have a mapped dept
        for p in person_latest.values():
            if not p["is_staff"]:
                card_key = (p.get("atid") or "").lstrip("0")
                name_key = (p.get("fullname") or "").strip().lower()
                matched_dept = v_meta_by_key.get(card_key) or v_meta_by_key.get(name_key)
                if matched_dept and matched_dept not in visitor_dept_counts:
                    visitor_dept_counts[matched_dept] = visitor_dept_counts.get(matched_dept, 0) + 1

        top_visitor_departments = sorted(
            [{"name": k, "count": v} for k, v in visitor_dept_counts.items() if k and k != "--"],
            key=lambda x: x["count"],
            reverse=True
        )[:6]

        # If we have visitor departments, prioritize visitor reception; otherwise show active staff depts
        if top_visitor_departments:
            active_top_departments = top_visitor_departments
            departments_type = "visitor"
        else:
            active_top_departments = top_staff_departments
            departments_type = "staff"

        staff_total_today = len(staff_unique)
        visitor_total_today = len(visitor_unique)

        distribution_data = {
            "staff_total": staff_total_today,
            "visitor_total": visitor_total_today,
            "staff_present": len(staff_present),
            "visitor_present": len(visitor_present),
            "staff_checked_out": len(staff_checked_out),
            "visitor_checked_out": len(visitor_checked_out),
            "total": staff_total_today + visitor_total_today
        }

        return {
            "date": selected_date,
            "is_today": is_today,
            "available_dates": self.get_available_dates(),
            "kpi": {
                "staff_count": len(staff_present),
                "staff_present": len(staff_present),
                "staff_checked_out": len(staff_checked_out),
                "staff_unique_today": len(staff_unique),
                "staff_total_today": len(staff_unique),
                "staff_in_scans": staff_in_scans,
                "staff_out_scans": staff_out_scans,
                "staff_scans_total": staff_in_scans + staff_out_scans,
                "visitor_count": len(visitor_present),
                "visitors_today": len(visitor_unique),
                "active_visitors_now": len(visitor_present),
                "visitor_present": len(visitor_present),
                "visitor_checked_out": len(visitor_checked_out),
                "visitor_in_scans": visitor_in_scans,
                "visitor_out_scans": visitor_out_scans,
                "checked_out_today": len(visitor_checked_out),
                "total_in": total_in,
                "total_out": total_out
            },
            "hourly": {
                "labels": hourly_labels,
                "staff": hourly_staff_data,
                "visitors": hourly_visitor_data
            },
            "departments": active_top_departments,
            "top_departments": active_top_departments,
            "top_visitor_departments": top_visitor_departments,
            "top_staff_departments": top_staff_departments,
            "departments_type": departments_type,
            "distribution": distribution_data,
            "donut": distribution_data
        }

    def get_present_details(self, target_date: Optional[str] = None, category: str = "STAFF", include_active_visitors: bool = True) -> Dict[str, List[Dict[str, Any]]]:
        """
        Returns the exact list of people divided into 2 lists:
        1. 'inside': Currently inside the office (latest scan was IN)
        2. 'left': Left / checked out today (latest scan was OUT)
        category: 'STAFF' or 'VISITOR'.
        """
        now = datetime.now()
        selected_date = target_date or now.strftime("%Y-%m-%d")
        scans = self.get_saved_scans(selected_date)
        sorted_scans = sorted(scans, key=lambda x: str(x.get("CheckTime") or x.get("Time") or ""))

        # Also load active visitors for rich metadata matching
        active_visitors = self.get_active_visitors() if include_active_visitors else []
        visitor_map_by_card = {}
        visitor_map_by_name = {}
        for av in active_visitors:
            card = str(av.get("card_number") or "").strip()
            if card:
                visitor_map_by_card[card] = av
            name = str(av.get("full_name") or "").strip().lower()
            if name:
                visitor_map_by_name[name] = av

        # Also load employee directory for rich department/code resolution
        employees = self.get_employees()
        emp_map = {str(e.get("code") or e.get("atid") or "").strip(): e for e in employees if e.get("code") or e.get("atid")}

        person_latest: Dict[str, Dict[str, Any]] = {}
        for l in sorted_scans:
            direction = determine_scan_direction(l)
            ptype = determine_scan_person_type(l)
            is_staff = ptype["is_staff"]

            atid = str(l.get("EmployeeATID") or "").strip()
            name = str(l.get("FullName") or "").strip()
            card = str(l.get("CardNumber") or "").strip()
            pkey = atid or name or card or "UNKNOWN"

            chk_time = str(l.get("CheckTime") or l.get("Time") or "")
            time_only = chk_time.split("T")[-1] if "T" in chk_time else (chk_time.split(" ")[-1] if " " in chk_time else chk_time)

            dept = l.get("Department") or "--"
            if (not dept or dept == "--") and atid in emp_map:
                dept = emp_map[atid].get("department") or "--"

            person_latest[pkey] = {
                "atid": atid,
                "fullname": name or "Chưa rõ",
                "department": dept,
                "check_time": chk_time,
                "time_only": time_only,
                "device_name": l.get("DeviceName") or "--",
                "serial_number": l.get("SerialNumber") or "--",
                "direction": direction,
                "is_staff": is_staff,
                "verify_mode": "Quét Khuôn Mặt" if is_staff else "Quẹt Thẻ RFID"
            }

        target_staff = (category.upper() == "STAFF")
        inside_list = [p for p in person_latest.values() if p["is_staff"] == target_staff and p["direction"] == "IN"]
        left_list = [p for p in person_latest.values() if p["is_staff"] == target_staff and p["direction"] == "OUT"]

        # Sort newest entry first
        inside_list.sort(key=lambda x: str(x.get("check_time", "")), reverse=True)
        left_list.sort(key=lambda x: str(x.get("check_time", "")), reverse=True)

        # Enrich visitor metadata if applicable
        if not target_staff:
            for p in inside_list + left_list:
                card = p.get("atid") or ""
                name_clean = p.get("fullname", "").strip().lower()
                matched_v = visitor_map_by_card.get(card) or visitor_map_by_name.get(name_clean)
                if matched_v:
                    p["company"] = matched_v.get("company") or "--"
                    p["host_person"] = matched_v.get("host_person") or "--"
                    p["phone"] = matched_v.get("phone") or "--"
                    p["cccd_number"] = matched_v.get("cccd_number") or matched_v.get("id_number") or "--"
                    if matched_v.get("department"):
                        p["department"] = matched_v.get("department")

        # Add 1-based STT and status labels
        for idx, item in enumerate(inside_list, 1):
            item["stt"] = idx
            item["status_label"] = "Đang trong VP"
            item["is_present"] = True

        for idx, item in enumerate(left_list, 1):
            item["stt"] = idx
            item["status_label"] = "Đã về"
            item["is_present"] = False

        return {
            "inside": inside_list,
            "left": left_list
        }

    # ---------------- Door Action Audit Logs ----------------

    def log_door_action(self, door_id: int, door_name: str, duration_sec: int, operator: str = "Bảo vệ", success: bool = True, action: str = "UNLOCK") -> Dict[str, Any]:
        """Logs manual unlock/lock command triggered by UI."""
        actions = _read_json(DOOR_ACTIONS_FILE, [])
        record = {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "door_id": door_id,
            "door_name": door_name,
            "duration_sec": duration_sec,
            "action": action,
            "operator": operator,
            "success": success
        }
        actions.append(record)
        # Keep latest 1000 logs
        if len(actions) > 1000:
            actions = actions[-1000:]
        _write_json(DOOR_ACTIONS_FILE, actions)

        if self.sp_enabled:
            self._sync_door_action_to_sharepoint(record)

        return record

    def get_door_actions(self, limit: int = 100) -> List[Dict[str, Any]]:
        actions = _read_json(DOOR_ACTIONS_FILE, [])
        return sorted(actions, key=lambda x: x.get("timestamp", ""), reverse=True)[:limit]

    # ---------------- SharePoint Online Integration Hook ----------------

    def _get_sharepoint_access_token(self) -> Optional[str]:
        """Loads cached SharePoint token from token_cache.bin via MSAL (same as Canteen Kiosk)."""
        cache_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "token_cache.bin")
        if not os.path.exists(cache_file):
            logger.warning("[SharePoint] Chưa tìm thấy token_cache.bin. Vui lòng chạy DANG_NHAP_SHAREPOINT.bat để đăng nhập.")
            return None

        try:
            import msal
            cache = msal.SerializableTokenCache()
            with open(cache_file, "r", encoding="utf-8") as f:
                cache.deserialize(f.read())

            tenant_id = self.sp_config.get("tenant_id", "29101901-3778-4339-827c-7d2b50914db0")
            client_id = self.sp_config.get("client_id", "04b07795-8ddb-461a-bbee-02f9e1bf7b46")
            scopes = ["https://graph.microsoft.com/.default"]

            app = msal.PublicClientApplication(
                client_id,
                authority=f"https://login.microsoftonline.com/{tenant_id}",
                token_cache=cache
            )
            accounts = app.get_accounts()
            if accounts:
                result = app.acquire_token_silent(scopes, account=accounts[0])
                if result and "access_token" in result:
                    # Save updated cache if refreshed
                    if cache.has_state_changed:
                        with open(cache_file, "w", encoding="utf-8") as f:
                            f.write(cache.serialize())
                    return result["access_token"]
            logger.warning("[SharePoint] Token trong token_cache.bin đã hết hạn hoặc không tìm thấy tài khoản.")
        except Exception as e:
            logger.error("[SharePoint] Lỗi đọc token_cache.bin: %s", e)
        return None

    def _sync_visitor_to_sharepoint(self, visitor_record: Dict[str, Any], is_checkout: bool = False):
        """
        Pushes visitor record to SharePoint Online List via Microsoft Graph API.
        Requires token_cache.bin (created via DANG_NHAP_SHAREPOINT.bat).
        """
        token = self._get_sharepoint_access_token()
        site_id = self.sp_config.get("site_id", "").strip()
        list_name = self.sp_config.get("visitor_list_name", "ACCESS_CONTROL_VISITORS")

        if not token or not site_id:
            logger.info("[SharePoint Sync] Sẵn sàng ghi nhận: %s (checkout=%s) - Chờ cấu hình site_id hoặc token", visitor_record.get("full_name"), is_checkout)
            return

        try:
            import requests
            url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_name}/items"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            cccd = visitor_record.get("cccd_number") or visitor_record.get("id_number", "")
            payload = {
                "fields": {
                    "Title": visitor_record.get("full_name", ""),
                    "CardNumber": visitor_record.get("card_number", ""),
                    "IDNumber": cccd,
                    "CCCDNumber": cccd,
                    "BirthYear": visitor_record.get("birth_year", ""),
                    "Gender": visitor_record.get("gender", ""),
                    "Address": visitor_record.get("address", ""),
                    "Phone": visitor_record.get("phone", ""),
                    "Company": visitor_record.get("company", ""),
                    "HostPerson": visitor_record.get("host_person", ""),
                    "Department": visitor_record.get("department", ""),
                    "Reason": visitor_record.get("purpose") or visitor_record.get("reason", ""),
                    "VehicleNumber": visitor_record.get("vehicle_number", ""),
                    "CheckinTime": visitor_record.get("checkin_time", ""),
                    "CheckoutTime": visitor_record.get("checkout_time", "") or "",
                    "Status": visitor_record.get("status", "ACTIVE")
                }
            }
            res = requests.post(url, json=payload, headers=headers, timeout=6)
            if res.status_code in (200, 201):
                logger.info("[SharePoint Sync] Đồng bộ khách %s thành công!", visitor_record.get("full_name"))
            else:
                logger.warning("[SharePoint Sync] Đồng bộ thất bại HTTP %s: %s", res.status_code, res.text)
        except Exception as e:
            logger.error("[SharePoint Sync] Lỗi khi gửi dữ liệu lên SharePoint: %s", e)

    def _sync_door_action_to_sharepoint(self, door_action: Dict[str, Any]):
        token = self._get_sharepoint_access_token()
        site_id = self.sp_config.get("site_id", "").strip()
        list_name = self.sp_config.get("log_list_name", "ACCESS_CONTROL_LOGS")

        if not token or not site_id:
            return

        try:
            import requests
            url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/lists/{list_name}/items"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            payload = {
                "fields": {
                    "Title": door_action.get("door_name", ""),
                    "DoorID": str(door_action.get("door_id", "")),
                    "Timestamp": door_action.get("timestamp", ""),
                    "DurationSec": str(door_action.get("duration_sec", "")),
                    "Operator": door_action.get("operator", ""),
                    "Success": str(door_action.get("success", True))
                }
            }
            requests.post(url, json=payload, headers=headers, timeout=5)
        except Exception as e:
            logger.error("[SharePoint Sync] Lỗi đồng bộ nhật ký cửa: %s", e)

    # ---------------- Excel Export ----------------

    def export_visitors_excel(self, output_path: str) -> str:
        """Exports visitor history to formatted Excel file."""
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Khách Ra Vào"

        # Chuẩn hóa các cột xuất Excel báo cáo khách ra vào
        headers = [
            "STT", "Họ Tên Khách", "Số CCCD", "Năm Sinh", "SĐT",
            "Đơn Vị / Công Ty", "Người Tiếp Đón", "Phòng Ban Đến", "Mục Đích Đến",
            "Biển Số Xe", "Mã Thẻ RFID", "Giờ Vào", "Giờ Ra Dự Kiến", "Giờ Ra Thực Tế", "Thời Lượng", "Trạng Thái"
        ]
        ws.append(headers)

        header_fill = PatternFill(start_color="0B2341", end_color="0B2341", fill_type="solid")
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

        for col_idx, col in enumerate(ws.iter_cols(min_row=1, max_row=1), start=1):
            cell = col[0]
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        all_records = self.get_active_visitors() + self.get_visitor_history()
        all_records.sort(key=lambda x: x.get("checkin_time", ""), reverse=True)

        for idx, rec in enumerate(all_records, start=1):
            cccd = rec.get("cccd_number") or ""
            ws.append([
                idx,
                rec.get("full_name", ""),
                cccd,
                rec.get("birth_year", "") or rec.get("birth_date", ""),
                rec.get("phone", ""),
                rec.get("company", ""),
                rec.get("host_person", ""),
                rec.get("department", ""),
                rec.get("purpose", ""),
                rec.get("vehicle_number", ""),
                rec.get("card_number", "") or "--",
                rec.get("checkin_time", ""),
                rec.get("expected_checkout_time", "") or "--",
                rec.get("checkout_time", "") or "--",
                rec.get("duration_str", "") or ("Đang có mặt" if rec.get("status") == "ACTIVE" else ""),
                "Đang có mặt" if rec.get("status") == "ACTIVE" else "Đã về"
            ])

        # Auto-adjust width
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

        wb.save(output_path)
        return output_path
