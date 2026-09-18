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

import time
import threading

logger = logging.getLogger("storage")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

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

    # ---------------- Visitor Management ----------------

    def get_active_visitors(self) -> List[Dict[str, Any]]:
        return _read_json(ACTIVE_VISITORS_FILE, [])

    def get_visitor_history(self, limit: int = 500) -> List[Dict[str, Any]]:
        history = _read_json(VISITOR_HISTORY_FILE, [])
        return sorted(history, key=lambda x: x.get("checkin_time", ""), reverse=True)[:limit]

    def add_visitor(self, visitor_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Adds a visitor to the active visitors list.
        Supports full CCCD QR parsed data and manual visitor inputs.
        """
        active = self.get_active_visitors()
        card_num = str(visitor_data.get("card_number", "")).strip()
        cccd_num = str(visitor_data.get("cccd_number", "")).strip() or str(visitor_data.get("id_number", "")).strip()

        # Check if card is already registered as active (if card provided)
        if card_num:
            for item in active:
                if str(item.get("card_number", "")).strip() == card_num:
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
            "department": visitor_data.get("department", "").strip(),
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

        active.append(record)
        _write_json(ACTIVE_VISITORS_FILE, active)

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
        """Returns cached company departments list."""
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
        """Returns employees, optionally filtered by department name."""
        all_emps = _read_json(EMPLOYEES_FILE, [])
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

        saved_logs = _read_json(DAILY_SCANS_FILE, [])

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

        added_count = 0
        for l in new_logs:
            if "CheckTime" not in l and "Time" in l:
                l["CheckTime"] = l["Time"]
            chk = str(l.get("CheckTime") or l.get("Time") or "")
            who = str(l.get("EmployeeATID") or l.get("FullName") or "")
            dev = str(l.get("SerialNumber") or l.get("DeviceSerialNumber") or "")
            key = f"{chk}_{who}_{dev}"
            if key not in seen_keys:
                seen_keys.add(key)
                merged.append(l)
                added_count += 1

        if added_count > 0:
            merged.sort(key=lambda x: str(x.get("CheckTime", "")), reverse=True)
            if len(merged) > 50000:
                merged = merged[:50000]
            _write_json(DAILY_SCANS_FILE, merged)

        return [l for l in merged if str(l.get("CheckTime", "")).startswith(today_str)]

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
        """Returns all accumulated scans recorded for target_date (defaults to today)."""
        date_str = target_date or datetime.now().strftime("%Y-%m-%d")
        saved_logs = _read_json(DAILY_SCANS_FILE, [])
        return [l for l in saved_logs if str(l.get("CheckTime", "")).startswith(date_str)]

    def get_available_dates(self) -> List[str]:
        """Returns all unique dates (YYYY-MM-DD) available in scan and visitor history."""
        saved_logs = _read_json(DAILY_SCANS_FILE, [])
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

        for l in sorted_scans:
            direction = determine_scan_direction(l)
            ptype = determine_scan_person_type(l)
            is_staff = ptype["is_staff"]

            atid = str(l.get("EmployeeATID") or "").strip()
            name = str(l.get("FullName") or "").strip()
            card = str(l.get("CardNumber") or "").strip()
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
                "department": l.get("Department") or "--",
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
            d_name = l.get("Department")
            if d_name and d_name != "--":
                dept_counts[d_name] = dept_counts.get(d_name, 0) + 1

        # Who is currently inside the office?
        # Latest scan was IN -> Inside office
        staff_present = [p for p in person_latest.values() if p["is_staff"] and p["direction"] == "IN"]
        visitor_present = [p for p in person_latest.values() if not p["is_staff"] and p["direction"] == "IN"]
        visitor_checked_out = [p for p in person_latest.values() if not p["is_staff"] and p["direction"] == "OUT"]

        total_in = staff_in_scans + visitor_in_scans
        total_out = staff_out_scans + visitor_out_scans

        hourly_staff_data = [hourly_staff_map[f"{h:02d}"] for h in range(6, 23)]
        hourly_visitor_data = [hourly_visitor_map[f"{h:02d}"] for h in range(6, 23)]

        top_departments = sorted(
            [{"name": k, "count": v} for k, v in dept_counts.items() if k and k != "--"],
            key=lambda x: x["count"],
            reverse=True
        )[:6]

        return {
            "date": selected_date,
            "is_today": is_today,
            "available_dates": self.get_available_dates(),
            "kpi": {
                "staff_count": len(staff_present),
                "staff_present": len(staff_present),
                "staff_unique_today": len(staff_unique),
                "staff_in_scans": staff_in_scans,
                "staff_out_scans": staff_out_scans,
                "staff_scans_total": staff_in_scans + staff_out_scans,
                "visitor_count": len(visitor_present),
                "visitors_today": len(visitor_unique),
                "active_visitors_now": len(visitor_present),
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
            "distribution": {
                "staff_total": len(staff_unique) or (staff_in_scans + staff_out_scans),
                "visitor_total": len(visitor_unique) or (visitor_in_scans + visitor_out_scans)
            },
            "top_departments": top_departments
        }

    def get_present_details(self, target_date: Optional[str] = None, category: str = "STAFF") -> List[Dict[str, Any]]:
        """
        Returns the exact list of people currently inside the office on target_date.
        category: 'STAFF' or 'VISITOR'.
        """
        now = datetime.now()
        selected_date = target_date or now.strftime("%Y-%m-%d")
        scans = self.get_saved_scans(selected_date)
        sorted_scans = sorted(scans, key=lambda x: str(x.get("CheckTime") or x.get("Time") or ""))

        # Also load active visitors for rich metadata matching
        active_visitors = self.get_active_visitors()
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

        # Sort newest entry first
        inside_list.sort(key=lambda x: x["check_time"], reverse=True)

        # Enrich visitor metadata if applicable
        if not target_staff:
            for p in inside_list:
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

        # Add 1-based STT
        for idx, item in enumerate(inside_list, 1):
            item["stt"] = idx

        return inside_list

    # ---------------- Door Action Audit Logs ----------------

    def log_door_action(self, door_id: int, door_name: str, duration_sec: int, operator: str = "Bảo vệ", success: bool = True) -> Dict[str, Any]:
        """Logs manual unlock command triggered by UI."""
        actions = _read_json(DOOR_ACTIONS_FILE, [])
        record = {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "door_id": door_id,
            "door_name": door_name,
            "duration_sec": duration_sec,
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
