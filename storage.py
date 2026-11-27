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
PENDING_VISITORS_FILE = os.path.join(DATA_DIR, "pending_visitors.json")
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


def _read_json(file_path: str, default_val: Any = None, raise_on_error: bool = False) -> Any:
    if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
        return default_val if default_val is not None else []
    lock = _get_lock(file_path)
    with lock:
        last_err = None
        for attempt in range(5):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                last_err = e
                if attempt == 4:
                    logger.error("Error reading %s: %s", file_path, e)
                    if raise_on_error:
                        raise RuntimeError(f"Failed to read non-empty JSON file {file_path}: {e}") from e
                    return default_val if default_val is not None else []
                time.sleep(0.05)


def _write_json(file_path: str, data: Any) -> None:
    lock = _get_lock(file_path)
    with lock:
        tmp_file = f"{file_path}.{threading.get_ident()}.tmp"
        try:
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            for attempt in range(6):
                try:
                    os.replace(tmp_file, file_path)
                    return
                except (PermissionError, OSError):
                    if attempt == 5:
                        with open(file_path, "w", encoding="utf-8") as f:
                            json.dump(data, f, ensure_ascii=False, indent=2)
                        try:
                            if os.path.exists(tmp_file):
                                os.remove(tmp_file)
                        except Exception:
                            pass
                        return
                    time.sleep(0.08)
        except Exception as e:
            logger.error("Error writing to %s: %s", file_path, e)
            try:
                if os.path.exists(tmp_file):
                    os.remove(tmp_file)
            except Exception:
                pass


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
    - VISITOR: Mã 56235..56254 (slot khách), >= 80000000, is_staff=False rõ ràng,
      hoặc quẹt thẻ vãng lai không thuộc danh bạ nhân viên.
    - STAFF: Nhân viên SeaZen (kể cả khi quét khuôn mặt hay quẹt thẻ nhân viên).
    """
    mode = str(scan.get("VerifyMode") or "").lower()
    val = scan.get("VerifyModeValue")
    atid = str(scan.get("EmployeeATID") or "").strip()

    is_guest_id = False
    if atid.isdigit():
        try:
            n_atid = int(atid)
            if n_atid >= 80000000 or (56235 <= n_atid <= 56254):
                is_guest_id = True
        except ValueError:
            pass

    explicit_is_staff = scan.get("is_staff")
    is_face = ("face" in mode) or (val == 15)
    is_card = ("card" in mode) or (val == 1) or bool(scan.get("CardNumber"))

    if is_guest_id or explicit_is_staff is False or (is_card and not is_face and explicit_is_staff is not True):
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


SAME_LANE_SPAM_WINDOW_SEC = 10


def _parse_scan_dt(rec: Dict[str, Any]) -> Optional[datetime]:
    raw = str(rec.get("CheckTime") or rec.get("Time") or "").replace("T", " ").strip()[:19]
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _scan_person_lane_key(rec: Dict[str, Any]):
    who = str(rec.get("EmployeeATID") or rec.get("FullName") or "").strip()
    who_key = (who.lstrip("0") or who) if who.isdigit() else who.lower()
    sn = str(rec.get("SerialNumber") or rec.get("DeviceSerialNumber") or "").strip()
    dev_name = str(rec.get("DeviceName") or "").strip().lower()
    return who_key, (sn or dev_name)


def collapse_same_lane_spam(scans: List[Dict[str, Any]], window_sec: int = SAME_LANE_SPAM_WINDOW_SEC) -> List[Dict[str, Any]]:
    """Collapses rapid repeat scans of the same person on the exact same lane within window_sec into 1 event."""
    if not scans or len(scans) <= 1 or window_sec <= 0:
        return list(scans)
    asc = sorted(scans, key=lambda x: str(x.get("CheckTime") or x.get("Time") or "").replace("T", " "))
    kept: List[Dict[str, Any]] = []
    last_burst_ts: Dict[tuple, datetime] = {}
    for rec in asc:
        dt = _parse_scan_dt(rec)
        who_key, lane_key = _scan_person_lane_key(rec)
        if not dt or not who_key or not lane_key:
            kept.append(rec)
            continue
        burst_k = (who_key, lane_key)
        prev_dt = last_burst_ts.get(burst_k)
        if prev_dt is not None and 0 <= (dt - prev_dt).total_seconds() <= window_sec:
            last_burst_ts[burst_k] = dt
            continue
        last_burst_ts[burst_k] = dt
        kept.append(rec)
    kept.sort(key=lambda x: str(x.get("CheckTime") or x.get("Time") or "").replace("T", " "), reverse=True)
    return kept


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

    HARDCODED_USERS: Dict[str, Dict[str, Any]] = {
        "usr-seazen-admin": {
            "id": "usr-seazen-admin",
            "username": "SeazenAdmin",
            "email": "admin@seazen.com.vn",
            "full_name": "Quản Trị Viên Hệ Thống (SeazenAdmin)",
            "role": "admin",
            "allowed_pages": ["ALL"],
            "is_active": True,
        },
        "usr-seazen-letan": {
            "id": "usr-seazen-letan",
            "username": "Letan",
            "email": "letan@seazen.com.vn",
            "full_name": "Bàn Tiếp Đón Lễ Tân (Letan)",
            "role": "staff",
            "allowed_pages": ["/visitors"],
            "is_active": True,
        },
        "usr-seazen-khach": {
            "id": "usr-seazen-khach",
            "username": "Khach",
            "email": "khach@seazen.com.vn",
            "full_name": "Phòng Ban Đặt Lịch Khách (Khach)",
            "role": "guest_inviter",
            "allowed_pages": ["/appointments"],
            "is_active": True,
        },
    }

    def seed_default_users(self) -> None:
        """Khởi tạo 3 tài khoản mặc định vào users.json CHỈ KHI file chưa tồn tại hoặc rỗng."""
        if os.path.exists(USERS_FILE) and os.path.getsize(USERS_FILE) > 10:
            try:
                existing = _read_json(USERS_FILE, [], raise_on_error=True)
                if isinstance(existing, list) and len(existing) > 0:
                    return
            except Exception:
                return
        now_s = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        default_users = [
            {
                "id": "usr-seazen-admin",
                "username": "SeazenAdmin",
                "email": "admin@seazen.com.vn",
                "password_hash": generate_password_hash("SeazenAdmin@1516", method="scrypt"),
                "full_name": "Quản Trị Viên Hệ Thống (SeazenAdmin)",
                "role": "admin",
                "allowed_pages": ["ALL"],
                "created_at": now_s,
                "is_active": True,
            },
            {
                "id": "usr-seazen-letan",
                "username": "Letan",
                "email": "letan@seazen.com.vn",
                "password_hash": generate_password_hash("Letan@1516", method="scrypt"),
                "full_name": "Bàn Tiếp Đón Lễ Tân (Letan)",
                "role": "staff",
                "allowed_pages": ["/visitors"],
                "created_at": now_s,
                "is_active": True,
            },
            {
                "id": "usr-seazen-khach",
                "username": "Khach",
                "email": "khach@seazen.com.vn",
                "password_hash": generate_password_hash("Khach@1516", method="scrypt"),
                "full_name": "Phòng Ban Đặt Lịch Khách (Khach)",
                "role": "guest_inviter",
                "allowed_pages": ["/appointments"],
                "created_at": now_s,
                "is_active": True,
            },
        ]
        _write_json(USERS_FILE, default_users)

    def get_users(self) -> List[Dict[str, Any]]:
        users = _read_json(USERS_FILE, [])
        if isinstance(users, list) and users:
            return users
        return list(self.HARDCODED_USERS.values())

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        users = _read_json(USERS_FILE, [])
        if isinstance(users, list):
            for u in users:
                if u.get("id") == user_id:
                    return dict(u) if u.get("is_active", True) else None
        if user_id in self.HARDCODED_USERS:
            return dict(self.HARDCODED_USERS[user_id])
        return None

    def get_user_by_credential(self, cred: str) -> Optional[Dict[str, Any]]:
        clean_cred = str(cred).strip().lower()
        if not clean_cred:
            return None
        users = _read_json(USERS_FILE, [])
        if isinstance(users, list):
            for u in users:
                u_name = str(u.get("username", "")).strip().lower()
                u_email = str(u.get("email", "")).strip().lower()
                if u_name == clean_cred or u_email == clean_cred:
                    return dict(u)
        return None

    def verify_user_credentials(self, username_or_email: str, password: str) -> Optional[Dict[str, Any]]:
        pw = str(password or "")
        if not str(username_or_email or "").strip() or not pw:
            return None
        user = self.get_user_by_credential(username_or_email)
        if not user or not user.get("is_active", True):
            return None
        pw_hash = user.get("password_hash", "")
        if pw_hash and check_password_hash(pw_hash, pw):
            return user
        return None

    # ---------------- Pending Appointments & Card Swap ----------------

    def get_pending_visitors(self) -> List[Dict[str, Any]]:
        pending_map: Dict[str, Dict[str, Any]] = {}
        for p in _read_json(PENDING_VISITORS_FILE, []):
            pid = str(p.get("id") or "").strip()
            if pid:
                pending_map[pid] = p
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                for p in db_mssql.get_pending_visitors_db():
                    pid = str(p.get("id") or "").strip()
                    if pid:
                        pending_map[pid] = p
            except Exception as e:
                logger.warning("get_pending_visitors MSSQL warning: %s", e)
        res = list(pending_map.values())
        res.sort(key=lambda x: str(x.get("checkin_time") or ""))
        return res

    def add_pending_visitor(self, v_data: Dict[str, Any]) -> Dict[str, Any]:
        rec = dict(v_data)
        rec["status"] = "PENDING"
        if not rec.get("id"):
            rec["id"] = f"apt_{int(time.time() * 1000) % 10000000}"
        with _get_lock(PENDING_VISITORS_FILE):
            pending_list = _read_json(PENDING_VISITORS_FILE, [], raise_on_error=True)
            pending_list = [x for x in pending_list if x.get("id") != rec["id"]]
            pending_list.insert(0, rec)
            _write_json(PENDING_VISITORS_FILE, pending_list)
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_mssql.insert_visitor_db(rec)
            except Exception as e:
                logger.warning("add_pending_visitor MSSQL warning: %s", e)
        return rec

    def delete_pending_visitor(self, visitor_id: str) -> bool:
        vid = str(visitor_id or "").strip()
        with _get_lock(PENDING_VISITORS_FILE):
            pending_list = _read_json(PENDING_VISITORS_FILE, [], raise_on_error=True)
            kept = [x for x in pending_list if str(x.get("id") or "") != vid and str(x.get("parent_visitor_id") or "") != vid]
            removed = len(kept) != len(pending_list)
            if removed:
                _write_json(PENDING_VISITORS_FILE, kept)
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                if db_mssql.delete_pending_visitor_db(vid):
                    removed = True
            except Exception:
                pass
        return removed

    def activate_pending_visitor(self, old_visitor_id: str, new_visitor_id: str, card_number: str, operator: str = "Lễ tân") -> Optional[Dict[str, Any]]:
        vid = str(old_visitor_id or "").strip()
        target = None
        for p in self.get_pending_visitors():
            if str(p.get("id") or "") == vid:
                target = dict(p)
                break
        if not target:
            return None
        target["id"] = str(new_visitor_id or vid)
        target["epad_atid"] = str(new_visitor_id or "")
        target["card_number"] = str(card_number or "").strip()
        target["status"] = "ACTIVE"
        target["operator"] = operator

        with _get_lock(PENDING_VISITORS_FILE), _get_lock(ACTIVE_VISITORS_FILE):
            pending_list = _read_json(PENDING_VISITORS_FILE, [], raise_on_error=True)
            kept_pending = []
            activated_companions = []
            for x in pending_list:
                x_id = str(x.get("id") or "")
                x_pid = str(x.get("parent_visitor_id") or "")
                if x_id == vid:
                    continue
                if x_pid == vid:
                    comp = dict(x)
                    comp["parent_visitor_id"] = target["id"]
                    comp["status"] = "ACTIVE"
                    comp["operator"] = operator
                    activated_companions.append(comp)
                else:
                    kept_pending.append(x)
            _write_json(PENDING_VISITORS_FILE, kept_pending)

            active_list = _read_json(ACTIVE_VISITORS_FILE, [], raise_on_error=True)
            active_ids = {target["id"]} | {str(c.get("id") or "") for c in activated_companions}
            active_list = [x for x in active_list if str(x.get("id") or "") not in active_ids]
            for comp in reversed(activated_companions):
                active_list.insert(0, comp)
            active_list.insert(0, target)
            _write_json(ACTIVE_VISITORS_FILE, active_list)

        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_mssql.activate_pending_visitor_db(vid, target["id"], target["card_number"], operator)
            except Exception as e:
                logger.warning("activate_pending_visitor MSSQL warning: %s", e)
        return target

    def swap_visitor_card(self, visitor_id: str, old_card: str, new_card: str, new_visitor_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        vid = str(visitor_id or "").strip()
        updated_rec = None
        with _get_lock(ACTIVE_VISITORS_FILE):
            active_list = _read_json(ACTIVE_VISITORS_FILE, [], raise_on_error=True)
            for v in active_list:
                if str(v.get("id") or "") == vid or (old_card and str(v.get("card_number") or "") == str(old_card)):
                    v["card_number"] = str(new_card)
                    if new_visitor_id:
                        v["epad_atid"] = str(new_visitor_id)
                        v["id"] = str(new_visitor_id)
                    updated_rec = dict(v)
                    break
            if updated_rec:
                _write_json(ACTIVE_VISITORS_FILE, active_list)
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                db_mssql.swap_visitor_card_db(vid, old_card, new_card, new_visitor_id=new_visitor_id)
            except Exception as e:
                logger.warning("swap_visitor_card MSSQL warning: %s", e)
        if not updated_rec:
            for v in self.get_active_visitors():
                if str(v.get("id") or "") == vid or (old_card and str(v.get("card_number") or "") == str(old_card)):
                    updated_rec = dict(v)
                    updated_rec["card_number"] = str(new_card)
                    if new_visitor_id:
                        updated_rec["epad_atid"] = str(new_visitor_id)
                        updated_rec["id"] = str(new_visitor_id)
                    break
        return updated_rec

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

                    # Skip synthesized vis_ slot row if a real registered visitor already holds that epad_atid/card
                    if c_id.startswith("vis_"):
                        slot_clean = c_id[4:].lstrip("0") or c_clean
                        dup_real = False
                        for existing_v in active_map.values():
                            ev_epad = str(existing_v.get("epad_atid") or "").strip().lstrip("0")
                            ev_card = str(existing_v.get("card_number") or "").strip().lstrip("0")
                            if slot_clean and (ev_epad == slot_clean or ev_card == slot_clean):
                                dup_real = True
                                break
                        if dup_real:
                            continue

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
                
                # Check if already in active_map (by card_number, epad_atid, id, or full_name)
                matched = False
                for k, v in active_map.items():
                    v_card = str(v.get("card_number") or "").strip()
                    v_clean = v_card.lstrip("0")
                    v_epad = str(v.get("epad_atid") or "").strip()
                    v_epad_clean = v_epad.lstrip("0")
                    v_id = str(v.get("id") or "").strip()
                    v_id_clean = v_id.lstrip("0")
                    if card_no and (
                        v_card == card_no
                        or (clean_c and v_clean == clean_c)
                        or (v_epad and (v_epad == card_no or (clean_c and v_epad_clean == clean_c)))
                        or (v_id and (v_id == card_no or (clean_c and v_id_clean == clean_c)))
                    ):
                        matched = True
                        break
                    v_name = (v.get("full_name") or "").strip().lower()
                    if p_name and p_name.lower() == v_name:
                        matched = True
                        break

                # Read-only view: never synthesize/insert ghost vis_* rows into SQL or active_map
                # during a GET call; door scans are enriched on matched active visitors only.
        except Exception as e:
            logger.warning("Error fetching inside visitors from door scans: %s", e)

        result = list(active_map.values())
        result = self._enrich_visitor_gate_timeline(result, is_history=False)
        result.sort(key=lambda x: str(x.get("checkin_time") or ""), reverse=True)
        return result

    @staticmethod
    def _parse_dt_flex(raw_str: Any) -> Optional[datetime]:
        s = str(raw_str or "").replace("T", " ").strip()
        if not s:
            return None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(s[:len(fmt) + 2].strip(), fmt)
            except Exception:
                continue
        if len(s) >= 19:
            try:
                return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
            except Exception:
                pass
        return None

    @staticmethod
    def _format_duration_vi(total_minutes: int) -> str:
        mins = max(0, int(total_minutes))
        days, rem_h = divmod(mins, 1440)
        hours, rmins = divmod(rem_h, 60)
        if days > 0:
            return f"{days} ngày {hours}g {rmins}p" if hours > 0 else f"{days} ngày {rmins}p"
        if hours > 0:
            return f"{hours}g {rmins:02d}p"
        return f"{rmins} phút"

    def _enrich_visitor_gate_timeline(self, visitors: List[Dict[str, Any]], is_history: bool = False) -> List[Dict[str, Any]]:
        """
        Enriches each visitor with:
        - Live or total duration inside the company (elapsed_minutes, elapsed_label)
        - Actual turnstile IN/OUT scan timestamps (gate_first_in_time, gate_last_out_time, in_scan_count, out_scan_count)
        - >15-minute Overdue / Unreturned-Card-After-Exit Alerts (overdue_alert, overdue_reason, overdue_minutes, alert_message)
        """
        if not visitors:
            return visitors

        now = datetime.now()
        dates_needed = {now.strftime("%Y-%m-%d")}
        for v in visitors:
            cin_s = str(v.get("checkin_time") or "")
            if len(cin_s) >= 10 and cin_s[4] == "-":
                dates_needed.add(cin_s[:10])

        # Load relevant scan logs across dates (prefer fast per-date files)
        all_scans: List[Dict[str, Any]] = []
        for d_iso in sorted(dates_needed):
            try:
                all_scans.extend(self.get_saved_scans(d_iso))
            except Exception:
                pass

        # Index visitor-related scan events by normalized ATID, card, and visitor name
        scans_by_key: Dict[str, List[Dict[str, Any]]] = {}
        for l in all_scans:
            ptype = determine_scan_person_type(l)
            if ptype.get("is_staff", False):
                continue
            chk = str(l.get("CheckTime") or l.get("Time") or "").replace("T", " ").strip()
            dt = self._parse_dt_flex(chk)
            if not dt:
                continue
            direction = determine_scan_direction(l)
            ev = {
                "dt": dt,
                "time_str": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "direction": direction,
                "device_name": str(l.get("DeviceName") or "--"),
            }
            keys = set()
            for raw_k in (l.get("EmployeeATID"), l.get("CardNumber")):
                ks = str(raw_k or "").strip()
                if ks:
                    keys.add(ks)
                    if ks.isdigit():
                        keys.add(ks.lstrip("0") or "0")
            fn_k = str(l.get("FullName") or "").strip().lower()
            if fn_k and not fn_k.startswith("nv ") and not fn_k.startswith("khách đến"):
                keys.add(f"name:{fn_k}")
            for k in keys:
                scans_by_key.setdefault(k, []).append(ev)

        from datetime import timedelta
        for v in visitors:
            cin_dt = self._parse_dt_flex(v.get("checkin_time")) or now
            cout_dt = self._parse_dt_flex(v.get("checkout_time")) if is_history or v.get("checkout_time") else None
            exp_dt = self._parse_dt_flex(v.get("expected_checkout_time"))

            end_ref = cout_dt if cout_dt else now
            elapsed_mins = max(0, int((end_ref - cin_dt).total_seconds() // 60))
            v["elapsed_minutes"] = elapsed_mins
            v["elapsed_label"] = self._format_duration_vi(elapsed_mins)
            if not v.get("duration_str") and cout_dt:
                v["duration_str"] = v["elapsed_label"]

            # Match door scan events belonging to this visit window
            cand_keys = set()
            for raw_k in (v.get("card_number"), v.get("epad_atid"), v.get("id")):
                ks = str(raw_k or "").strip()
                if ks:
                    if ks.startswith("vis_"):
                        ks = ks[4:]
                    cand_keys.add(ks)
                    if ks.isdigit():
                        cand_keys.add(ks.lstrip("0") or "0")
            fn_lower = str(v.get("full_name") or "").strip().lower()
            if fn_lower and not fn_lower.startswith("nv "):
                cand_keys.add(f"name:{fn_lower}")

            matched_events: List[Dict[str, Any]] = []
            seen_ev = set()
            win_start = cin_dt - timedelta(minutes=2)
            win_end = (cout_dt + timedelta(minutes=2)) if cout_dt else (now + timedelta(minutes=2))
            for k in cand_keys:
                for ev in scans_by_key.get(k, []):
                    if win_start <= ev["dt"] <= win_end:
                        sig = (ev["time_str"], ev["direction"], ev["device_name"])
                        if sig not in seen_ev:
                            seen_ev.add(sig)
                            matched_events.append(ev)

            matched_events.sort(key=lambda e: e["dt"])
            in_evs = [e for e in matched_events if e["direction"] == "IN"]
            out_evs = [e for e in matched_events if e["direction"] == "OUT"]

            v["in_scan_count"] = len(in_evs)
            v["out_scan_count"] = len(out_evs)
            v["gate_first_in_time"] = in_evs[0]["time_str"] if in_evs else ""
            v["gate_first_in_device"] = in_evs[0]["device_name"] if in_evs else ""
            v["gate_last_out_time"] = out_evs[-1]["time_str"] if out_evs else ""
            v["gate_last_out_device"] = out_evs[-1]["device_name"] if out_evs else ""
            v["gate_last_scan_time"] = matched_events[-1]["time_str"] if matched_events else ""
            v["gate_last_scan_direction"] = matched_events[-1]["direction"] if matched_events else ""
            v["gate_last_scan_device"] = matched_events[-1]["device_name"] if matched_events else ""

            # Compute >15-minute unreturned-card / overstay alert for ACTIVE visitors
            v["overdue_alert"] = False
            v["overdue_reason"] = None
            v["overdue_minutes"] = 0
            v["alert_message"] = ""
            v["gate_out_recent_minutes"] = None

            if not is_history and str(v.get("status") or "ACTIVE").upper() == "ACTIVE":
                if out_evs and v["gate_last_scan_direction"] == "OUT":
                    mins_since_out = max(0, int((now - out_evs[-1]["dt"]).total_seconds() // 60))
                    if mins_since_out >= 15:
                        v["overdue_alert"] = True
                        v["overdue_reason"] = "GATE_OUT_NO_CARD_RETURN"
                        v["overdue_minutes"] = mins_since_out
                        v["alert_message"] = (
                            f"Đã quét {out_evs[-1]['device_name']} lúc {out_evs[-1]['dt'].strftime('%H:%M')} "
                            f"({mins_since_out} phút trước) nhưng chưa trả thẻ — Yêu cầu Check-out!"
                        )
                    else:
                        v["gate_out_recent_minutes"] = mins_since_out
                elif exp_dt and now > (exp_dt + timedelta(minutes=15)):
                    mins_past = int((now - exp_dt).total_seconds() // 60)
                    v["overdue_alert"] = True
                    v["overdue_reason"] = "PAST_EXPECTED_TIME"
                    v["overdue_minutes"] = mins_past
                    v["alert_message"] = (
                        f"Đã quá giờ dự kiến ra ({exp_dt.strftime('%H:%M')}) {mins_past} phút chưa trả thẻ — Yêu cầu Check-out!"
                    )
                elif cin_dt.date() < now.date() and elapsed_mins >= 15:
                    v["overdue_alert"] = True
                    v["overdue_reason"] = "PREVIOUS_DAY_UNRETURNED"
                    v["overdue_minutes"] = elapsed_mins
                    v["alert_message"] = (
                        f"Khách vào từ {cin_dt.strftime('%d/%m %H:%M')} chưa trả thẻ — Yêu cầu Check-out!"
                    )

        return visitors

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

        sorted_hist = sorted(history, key=lambda x: x.get("checkin_time", ""), reverse=True)[:limit]
        return self._enrich_visitor_gate_timeline(sorted_hist, is_history=True)

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

        cin_d = str(visitor_data.get("checkin_date") or visitor_data.get("from_date") or "").strip() or today_str
        cin_t = str(visitor_data.get("checkin_time") or visitor_data.get("from_time") or "").strip().replace("T", " ") or time_str[:5]
        if " " in cin_t and len(cin_t) >= 15:
            checkin_full = cin_t if len(cin_t) >= 19 else f"{cin_t}:00"
        else:
            if len(cin_t) == 5:
                cin_t += ":00"
            checkin_full = f"{cin_d} {cin_t}".strip()

        cout_d = str(visitor_data.get("expected_checkout_date") or visitor_data.get("to_date") or "").strip() or cin_d
        cout_t = str(visitor_data.get("expected_checkout_time") or visitor_data.get("to_time") or "").strip().replace("T", " ") or "17:30"
        if " " in cout_t and len(cout_t) >= 15:
            expected_checkout_full = cout_t if len(cout_t) >= 19 else f"{cout_t}:00"
        else:
            if len(cout_t) == 5:
                cout_t += ":00"
            expected_checkout_full = f"{cout_d} {cout_t}".strip()

        record = {
            "id": str(visitor_data.get("id") or visitor_data.get("epad_atid") or str(uuid.uuid4())[:8]),
            "epad_atid": str(visitor_data.get("epad_atid") or ""),
            "sp_item_id": visitor_data.get("sp_item_id"),
            "parent_visitor_id": str(visitor_data.get("parent_visitor_id") or ""),
            "parent_visitor_name": str(visitor_data.get("parent_visitor_name") or ""),
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
            "note": str(visitor_data.get("note") or visitor_data.get("notes") or "").strip(),
            "use_phone": bool(visitor_data.get("use_phone")),
            "purpose": visitor_data.get("purpose", "").strip() or visitor_data.get("reason", "").strip(),
            "vehicle_number": visitor_data.get("vehicle_number", "").strip(),
            "card_number": card_num,
            "checkin_time": checkin_full,
            "expected_checkout_time": expected_checkout_full,
            "checkout_time": None,
            "duration_str": None,
            "status": str(visitor_data.get("status") or "ACTIVE").strip().upper(),
            "operator": visitor_data.get("operator", "Bảo vệ")
        }

        # Save to local JSON under file lock
        with _get_lock(ACTIVE_VISITORS_FILE):
            active_saved = _read_json(ACTIVE_VISITORS_FILE, [], raise_on_error=True)
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
        Matches by id, cccd_number, card_number, or phone.
        """
        query = str(query_key or "").strip().lower()
        if not query:
            return None

        clean_query = query.lstrip("0") if query.isdigit() else query
        matched = None
        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        with _get_lock(ACTIVE_VISITORS_FILE), _get_lock(VISITOR_HISTORY_FILE):
            active = self.get_active_visitors()
            remaining = []

            for item in active:
                item_id = str(item.get("id", "")).strip().lower()
                item_card = str(item.get("card_number", "")).strip().lower()
                clean_item_card = item_card.lstrip("0") if item_card.isdigit() else item_card
                item_cccd = str(item.get("cccd_number", "")).strip().lower()
                item_phone = str(item.get("phone", "")).strip().lower()

                is_match = False
                if matched is None:
                    if item_id == query:
                        is_match = True
                    elif item_card and (item_card == query or (clean_query and clean_item_card and clean_item_card == clean_query)):
                        is_match = True
                    elif item_cccd and item_cccd == query:
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

            matched["checkout_time"] = now_str
            matched["status"] = "COMPLETED"

            try:
                t1 = self._parse_dt_flex(matched.get("checkin_time"))
                if t1:
                    mins = int((now - t1).total_seconds() / 60)
                    matched["duration_str"] = self._format_duration_vi(mins)
                else:
                    matched["duration_str"] = "N/A"
            except Exception:
                matched["duration_str"] = "N/A"

            for r_item in remaining:
                for k_tmp in ("overdue_alert", "overdue_reason", "overdue_minutes", "alert_message", "gate_out_recent_minutes"):
                    r_item.pop(k_tmp, None)
            for k_tmp in ("overdue_alert", "overdue_reason", "overdue_minutes", "alert_message", "gate_out_recent_minutes"):
                matched.pop(k_tmp, None)

            _write_json(ACTIVE_VISITORS_FILE, remaining)

            history = _read_json(VISITOR_HISTORY_FILE, [], raise_on_error=True)
            history.append(matched)
            _write_json(VISITOR_HISTORY_FILE, history)

        # Update MSSQL: prefer exact VisitorID match so colliding slots/cards never check out a different guest
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                if matched.get("id"):
                    db_mssql.checkout_visitor_db(matched["id"], now_str)
                elif matched.get("card_number"):
                    db_mssql.checkout_visitor_db(matched["card_number"], now_str)
                else:
                    db_mssql.checkout_visitor_db(query, now_str)
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
            self.merge_and_save_scans([out_scan])
        except Exception as e:
            logger.warning("Failed to record OUT attendance log on checkout: %s", e)

        # Hook for SharePoint
        if self.sp_enabled:
            self._sync_visitor_to_sharepoint(matched, is_checkout=True)

        return matched

    def checkout_visitor_group(self, query_key: str) -> List[Dict[str, Any]]:
        """
        Checks out a primary visitor along with all active companions linked via parent_visitor_id.
        Returns list of all checked-out visitor records.
        """
        first_rec = self.checkout_visitor(query_key)
        if not first_rec:
            return []
        checked_out = [first_rec]
        parent_id = str(first_rec.get("id") or "").strip()
        if not parent_id:
            return checked_out

        active_left = self.get_active_visitors()
        companion_ids = [
            str(item.get("id") or "").strip()
            for item in active_left
            if str(item.get("parent_visitor_id") or "").strip() == parent_id
        ]
        for cid in companion_ids:
            if cid:
                c_rec = self.checkout_visitor(cid)
                if c_rec:
                    checked_out.append(c_rec)
        return checked_out

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
                            "level": d.get("Level", 1),
                            "location": d.get("Location") or "",
                            "description": d.get("Description") or "",
                            "staff_count": int(d.get("StaffCount") or 0),
                            "DepartmentID": d["DepartmentID"],
                            "DepartmentName": d["DepartmentName"],
                            "DepartmentCode": d.get("DepartmentCode") or "",
                            "Location": d.get("Location") or "",
                            "Description": d.get("Description") or "",
                            "StaffCount": int(d.get("StaffCount") or 0),
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

    def get_employees(self, department: Optional[str] = None, include_inactive: bool = False) -> List[Dict[str, Any]]:
        """Returns employees, querying Microsoft SQL Server first with seamless local fallback."""
        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                sql_res = db_mssql.get_employees(department=department or "", limit=2000, include_inactive=include_inactive)
                if sql_res and sql_res.get("success") is not False and "items" in sql_res:
                    return [
                        {
                            "atid": e["EmployeeATID"],
                            "code": e["EmployeeCode"],
                            "fullname": e["FullName"],
                            "department": e["DepartmentName"],
                            "department_index": e.get("DepartmentID"),
                            "position": e.get("Position", ""),
                            "privilege": e.get("Privilege", 0),
                            "gender": e.get("Gender", ""),
                            "email": e.get("Email", ""),
                            "phone": e.get("Phone", ""),
                            "joined_date": e.get("JoinedDate", ""),
                            "is_active": e.get("IsActive", True),
                            "has_face": e.get("HasFace", False),
                            "has_card": e.get("HasCard", False),
                            "has_finger": e.get("HasFinger", False),
                            "finger_count": e.get("FingerCount", 0),
                            "face_version": e.get("FaceVersion", ""),
                            "last_synced": e.get("LastSyncedToDevices", ""),
                            "last_scan_time": e.get("LastScanTime", ""),
                            "last_verify_mode": e.get("LastVerifyMode", ""),
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
        Holds _scans_cache_lock across read-merge-write so concurrent scans never drop each other.
        """
        today_str = datetime.now().strftime("%Y-%m-%d")
        if not new_logs:
            return self.get_saved_scans(today_str)

        # Build lightweight employee index outside scan cache lock
        emp_map = {}
        try:
            emp_source = _read_json(EMPLOYEES_FILE, [])
            if not emp_source:
                emp_source = self.get_employees()
            for emp in emp_source:
                atid = str(emp.get("atid") or "").strip()
                code = str(emp.get("code") or "").strip()
                fn = str(emp.get("fullname") or "").strip().lower()
                if atid:
                    emp_map[atid] = emp
                if code:
                    emp_map[code] = emp
                if fn:
                    emp_map[fn] = emp
        except Exception:
            pass

        with self._scans_cache_lock:
            saved_logs = self._load_scans_cache()

            seen_keys = set()
            lane_times: Dict[tuple, List[datetime]] = {}
            merged = []
            for l in saved_logs:
                chk = str(l.get("CheckTime") or l.get("Time") or "").replace("T", " ").strip()[:19]
                who = str(l.get("EmployeeATID") or l.get("FullName") or "").strip()
                who_key = who.lstrip("0") or who if who.isdigit() else who
                dev = str(l.get("SerialNumber") or l.get("DeviceSerialNumber") or "").strip()
                key = f"{chk}_{who_key}_{dev}"
                if key not in seen_keys:
                    seen_keys.add(key)
                    merged.append(l)
                    dt_exist = _parse_scan_dt(l)
                    pk, lk = _scan_person_lane_key(l)
                    if dt_exist and pk and lk:
                        lane_times.setdefault((pk, lk), []).append(dt_exist)

            added_count = 0
            actually_added = []
            ordered_new = sorted(
                new_logs,
                key=lambda x: str(x.get("CheckTime") or x.get("Time") or "").replace("T", " ")
            )
            for l in ordered_new:
                if "CheckTime" not in l and "Time" in l:
                    l["CheckTime"] = l["Time"]
                chk = str(l.get("CheckTime") or l.get("Time") or "").replace("T", " ").strip()[:19]
                who = str(l.get("EmployeeATID") or l.get("FullName") or "").strip()
                who_key = who.lstrip("0") or who if who.isdigit() else who
                dev = str(l.get("SerialNumber") or l.get("DeviceSerialNumber") or "").strip()
                key = f"{chk}_{who_key}_{dev}"

                if key in seen_keys:
                    continue

                dt_new = _parse_scan_dt(l)
                pk, lk = _scan_person_lane_key(l)
                if dt_new and pk and lk:
                    if any(abs((dt_new - prev_dt).total_seconds()) <= SAME_LANE_SPAM_WINDOW_SEC for prev_dt in lane_times.get((pk, lk), ())):
                        continue

                atid = str(l.get("EmployeeATID") or "").strip()
                name = str(l.get("FullName") or "").strip()
                matched_emp = emp_map.get(atid) or emp_map.get(atid.lstrip("0")) or emp_map.get(name.lower())
                if matched_emp:
                    if not l.get("Department") or l.get("Department") == "--":
                        l["Department"] = matched_emp.get("department")
                    if not l.get("FullName") or l.get("FullName") == "--" or str(l.get("FullName")).startswith("User "):
                        l["FullName"] = matched_emp.get("fullname")

                seen_keys.add(key)
                if dt_new and pk and lk:
                    lane_times.setdefault((pk, lk), []).append(dt_new)
                merged.append(l)
                actually_added.append(l)
                added_count += 1

            if added_count > 0:
                merged.sort(key=lambda x: str(x.get("CheckTime", "")).replace("T", " "), reverse=True)
                if len(merged) > 50000:
                    merged = merged[:50000]
                _write_json(DAILY_SCANS_FILE, merged)
                self._scans_cache = merged
                try:
                    self._scans_cache_mtime = os.path.getmtime(DAILY_SCANS_FILE)
                except OSError:
                    self._scans_cache_mtime = time.time()

        if added_count > 0:
            # Parallel write to Microsoft SQL Server tbl_AttendanceLogs
            try:
                import db_mssql
                if db_mssql.is_mssql_active():
                    inserted_db = db_mssql.insert_attendance_logs_bulk(actually_added)
                    if inserted_db > 0:
                        logger.info("[Storage] Đã lưu %d lượt quét mới vào CSDL Microsoft SQL Server", inserted_db)
            except Exception as e:
                logger.debug("[Storage] Lỗi lưu log vào MSSQL: %s", e)

            # Asynchronous Write-Through to SharePoint Online List 'VMS SEAZEN - NHẬT KÝ QUẸT THẺ' & 'TỔNG HỢP CHẤM CÔNG'
            try:
                import sharepoint_vms_sync
                recent_day_prefix = today_str
                realtime_batch = [
                    sc for sc in actually_added
                    if str(sc.get("CheckTime") or sc.get("Time") or "").replace("T", " ").startswith(recent_day_prefix)
                ]
                if realtime_batch:
                    sharepoint_vms_sync.push_live_scans_to_sharepoint_async(realtime_batch)
            except Exception as sp_err:
                logger.debug("[Storage] SharePoint async push skipped: %s", sp_err)

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
                chk = str(l.get("CheckTime") or l.get("Time") or "").replace("T", " ").strip()[:19]
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
                    if isinstance(item, dict):
                        if "CheckTime" not in item and "Time" in item:
                            item["CheckTime"] = item["Time"]
                        item.setdefault("SyncSource", "ADMS_PUSH_BRIDGE")
                        all_new.append(item)
        if all_new:
            self.merge_and_save_scans(all_new)
        return len(all_new)

    def get_saved_scans(self, target_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns accumulated scans recorded for target_date ('ALL' returns all cached dates)."""
        date_str = (target_date or "").strip() or datetime.now().strftime("%Y-%m-%d")
        is_all = date_str.upper() == "ALL"
        all_logs = self._load_scans_cache()
        filtered = list(all_logs) if is_all else [
            l for l in all_logs
            if str(l.get("CheckTime") or l.get("Time") or "").startswith(date_str)
        ]

        def _norm_scan_who(rec: Dict[str, Any]) -> str:
            w = str(rec.get("EmployeeATID") or rec.get("FullName") or "").strip()
            return (w.lstrip("0") or w) if w.isdigit() else w

        seen_keys = {
            f"{str(l.get('CheckTime') or l.get('Time') or '').replace('T', ' ')[:19]}_{_norm_scan_who(l)}_{l.get('SerialNumber') or l.get('DeviceSerialNumber', '')}"
            for l in filtered
        }
        if not is_all:
            try:
                import db_mssql
                if db_mssql.is_mssql_active():
                    db_logs = db_mssql.get_attendance_logs_by_date_db(date_str)
                    for dl in db_logs:
                        k = f"{str(dl.get('CheckTime', '')).replace('T', ' ')[:19]}_{_norm_scan_who(dl)}_{dl.get('SerialNumber', '')}"
                        if k not in seen_keys:
                            seen_keys.add(k)
                            filtered.append(dl)
            except Exception:
                pass
        return collapse_same_lane_spam(filtered, window_sec=SAME_LANE_SPAM_WINDOW_SEC)

    def get_available_dates(self) -> List[str]:
        """Returns all unique dates (YYYY-MM-DD) available in scan and visitor history in <20ms."""
        dates = set()
        for l in self._load_scans_cache():
            t = str(l.get("CheckTime", ""))
            if len(t) >= 10 and t[4] == '-' and t[7] == '-':
                dates.add(t[:10])
        for v in _read_json(VISITOR_HISTORY_FILE, []):
            t = str(v.get("checkin_time", ""))
            if len(t) >= 10 and t[4] == '-' and t[7] == '-':
                dates.add(t[:10])
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                import pyodbc
                with pyodbc.connect(db_mssql.get_connection_string(), timeout=3) as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT DISTINCT CONVERT(VARCHAR(10), CheckTime, 120) FROM tbl_AttendanceLogs WHERE CheckTime IS NOT NULL")
                    for r in cur.fetchall():
                        if r[0]:
                            dates.add(str(r[0])[:10])
                    cur.execute("SELECT DISTINCT CONVERT(VARCHAR(10), CheckinTime, 120) FROM tbl_Visitors WHERE CheckinTime IS NOT NULL")
                    for r in cur.fetchall():
                        if r[0]:
                            dates.add(str(r[0])[:10])
            except Exception:
                pass
        dates.add(datetime.now().strftime("%Y-%m-%d"))
        return sorted(list(dates), reverse=True)

    # ---------------- Dashboard & Analytics Engine ----------------

    def _build_visitor_slot_index(self):
        """Builds active and newest-first historical visitor lookup maps keyed by normalized slot/id/card."""
        active_by_slot: Dict[str, Dict[str, Any]] = {}
        hist_by_slot: Dict[str, List[Dict[str, Any]]] = {}

        def _index_entry(target_map, v: Dict[str, Any], as_list: bool = False):
            vn = str(v.get("full_name") or "").strip()
            if not vn or vn.lower().startswith("khach ") or vn.lower() in ("chưa rõ", "chua ro", "---", "unknown"):
                return
            keys = (
                str(v.get("epad_atid") or "").strip().lstrip("0"),
                str(v.get("id") or "").strip().lstrip("0"),
                str(v.get("card_number") or "").strip().lstrip("0"),
            )
            for k in keys:
                if not k:
                    continue
                if as_list:
                    target_map.setdefault(k, []).append(v)
                elif k not in target_map:
                    target_map[k] = v

        for v in (self.get_active_visitors() or []):
            _index_entry(active_by_slot, v, as_list=False)
        for v in (self.get_visitor_history(limit=300) or []):
            _index_entry(hist_by_slot, v, as_list=True)
        return active_by_slot, hist_by_slot

    @staticmethod
    def resolve_visitor_for_scan(raw_atid: str, chk_time: str, active_by_slot: Dict[str, Dict[str, Any]], hist_by_slot: Dict[str, List[Dict[str, Any]]], is_placeholder_name: bool = True):
        """Matches a non-staff scan to the exact active or time-window historical visitor holding that slot."""
        raw_s = str(raw_atid or "").strip()
        norm_s = raw_s.lstrip("0") or raw_s
        chk_norm = str(chk_time or "").replace("T", " ").strip()[:19]

        act_v = active_by_slot.get(norm_s) or active_by_slot.get(raw_s)
        act_cin = str(act_v.get("checkin_time") or "").replace("T", " ")[:19] if act_v else ""
        if act_v and (not act_cin or chk_norm >= act_cin):
            return act_v, True

        cand_list = hist_by_slot.get(norm_s) or hist_by_slot.get(raw_s) or []
        for hv in cand_list:
            cin = str(hv.get("checkin_time") or "").replace("T", " ")[:19]
            cout = str(hv.get("checkout_time") or "").replace("T", " ")[:19]
            if cin and chk_norm[:10] == cin[:10] and chk_norm >= cin and (not cout or chk_norm <= cout):
                return hv, True

        if is_placeholder_name and cand_list:
            for hv in cand_list:
                if chk_norm[:10] == str(hv.get("checkin_time") or "")[:10]:
                    return hv, False
            return cand_list[0], False

        return None, False

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

        # Build employee & visitor lookup maps (avoids 5MB JPEG/subquery load every 3s)
        emp_map = {}
        for emp in _read_json(EMPLOYEES_FILE, []):
            atid = str(emp.get("atid") or "").strip()
            code = str(emp.get("code") or "").strip()
            fn = str(emp.get("fullname") or "").strip().lower()
            if atid:
                emp_map[atid] = emp
            if code:
                emp_map[code] = emp
            if fn:
                emp_map[fn] = emp

        vis_active_by_slot, vis_hist_by_slot = self._build_visitor_slot_index()

        for l in sorted_scans:
            direction = determine_scan_direction(l)
            ptype = determine_scan_person_type(l)
            is_staff = ptype["is_staff"]

            atid = str(l.get("EmployeeATID") or "").strip()
            name = str(l.get("FullName") or "").strip()
            card = str(l.get("CardNumber") or "").strip()
            chk_time = str(l.get("CheckTime") or l.get("Time") or "")

            matched_emp = emp_map.get(atid) or emp_map.get(atid.lstrip("0")) or emp_map.get(name.lower())
            d_name = l.get("Department")
            if (not d_name or d_name == "--") and matched_emp:
                d_name = matched_emp.get("department")

            if (not name or name == "--" or name.startswith("User ")) and matched_emp:
                name = matched_emp.get("fullname")

            norm_atid = atid.lstrip("0") if atid.isdigit() else atid
            if not is_staff:
                is_ph = (not name or name == "--" or name.lower().startswith("khach ") or name.lower() in ("chưa rõ", "chua ro", "---", "unknown"))
                matched_v, exact_win = self.resolve_visitor_for_scan(atid, chk_time, vis_active_by_slot, vis_hist_by_slot, is_placeholder_name=is_ph)
                if matched_v:
                    if matched_v.get("full_name") and (exact_win or is_ph):
                        name = matched_v["full_name"]
                    if matched_v.get("department") and (exact_win or not d_name or str(d_name).strip() in ("--", "Chỉ Huy Đội")):
                        d_name = matched_v["department"]

            pkey = norm_atid or name or card or "UNKNOWN"

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

        # Calculate visitor departments from active visitors + lightweight history for selected_date
        visitor_dept_counts: Dict[str, int] = {}
        raw_hist = _read_json(VISITOR_HISTORY_FILE, [])
        if MSSQL_AVAILABLE and db_mssql and db_mssql.is_mssql_active():
            try:
                import pyodbc
                with pyodbc.connect(db_mssql.get_connection_string(), timeout=3) as conn:
                    cur = conn.cursor()
                    cur.execute("""
                        SELECT FullName, CardNumber, Department, CONVERT(VARCHAR(19), CheckinTime, 120)
                        FROM tbl_Visitors
                        WHERE CAST(CheckinTime AS DATE) = ?
                    """, (selected_date,))
                    for r in cur.fetchall():
                        raw_hist.append({
                            "full_name": r[0] or "",
                            "card_number": r[1] or "",
                            "department": r[2] or "",
                            "checkin_time": r[3] or "",
                        })
            except Exception:
                pass
        all_registered_visitors = []
        seen_vis_dept = set()
        for v in (self.get_active_visitors() + raw_hist):
            vk = f"{str(v.get('full_name') or '').strip().lower()}_{str(v.get('card_number') or '').strip().lstrip('0')}_{str(v.get('checkin_time') or '')[:16]}"
            if vk not in seen_vis_dept:
                seen_vis_dept.add(vk)
                all_registered_visitors.append(v)

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
            "currently_inside_staff": len(staff_present),
            "currently_inside_visitors": len(visitor_present),
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

        # Load visitor slot indexes (active + newest-first history) for rich metadata matching
        vis_active_by_slot, vis_hist_by_slot = self._build_visitor_slot_index() if include_active_visitors else ({}, {})
        visitor_map_by_name = {
            str(av.get("full_name") or "").strip().lower(): av
            for av in vis_active_by_slot.values()
            if av.get("full_name")
        }

        # Load lightweight employee directory metadata (avoid querying FacePhotoBase64 blobs when JSON cache exists)
        employees = _read_json(EMPLOYEES_FILE, [])
        if not employees:
            employees = self.get_employees()
        emp_map = {}
        for e in employees:
            for k_raw in (e.get("code"), e.get("atid")):
                ks = str(k_raw or "").strip()
                if ks:
                    emp_map[ks] = e
                    emp_map[ks.lstrip("0")] = e

        person_latest: Dict[str, Dict[str, Any]] = {}
        for l in sorted_scans:
            direction = determine_scan_direction(l)
            ptype = determine_scan_person_type(l)
            is_staff = ptype["is_staff"]

            atid = str(l.get("EmployeeATID") or "").strip()
            name = str(l.get("FullName") or "").strip()
            card = str(l.get("CardNumber") or "").strip()
            norm_atid = atid.lstrip("0") if atid.isdigit() else atid
            pkey = norm_atid or name or card or "UNKNOWN"

            chk_time = str(l.get("CheckTime") or l.get("Time") or "")
            time_only = chk_time.split("T")[-1] if "T" in chk_time else (chk_time.split(" ")[-1] if " " in chk_time else chk_time)

            matched_emp = emp_map.get(atid) or emp_map.get(norm_atid) or emp_map.get(name.lower())
            dept = l.get("Department") or "--"
            if (not dept or dept == "--") and matched_emp:
                dept = matched_emp.get("department") or "--"
            if (not name or name == "--" or name.startswith("User ")) and matched_emp:
                name = matched_emp.get("fullname") or name

            matched_vis = None
            if not is_staff and include_active_visitors:
                is_ph = (not name or name == "--" or name.lower().startswith("khach ") or name.lower() in ("chưa rõ", "chua ro", "---", "unknown"))
                matched_vis, exact_win = self.resolve_visitor_for_scan(atid, chk_time, vis_active_by_slot, vis_hist_by_slot, is_placeholder_name=is_ph)
                if matched_vis:
                    if matched_vis.get("full_name") and (exact_win or is_ph):
                        name = matched_vis["full_name"]
                    if matched_vis.get("department") and (exact_win or not dept or str(dept).strip() in ("--", "Chỉ Huy Đội")):
                        dept = matched_vis["department"]

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
                "verify_mode": "Quét Khuôn Mặt" if is_staff else "Quẹt Thẻ RFID",
                "_matched_vis": matched_vis,
            }

        target_staff = (category.upper() == "STAFF")
        inside_list = [p for p in person_latest.values() if p["is_staff"] == target_staff and p["direction"] == "IN"]
        left_list = [p for p in person_latest.values() if p["is_staff"] == target_staff and p["direction"] == "OUT"]

        # Sort newest entry first
        inside_list.sort(key=lambda x: str(x.get("check_time", "")), reverse=True)
        left_list.sort(key=lambda x: str(x.get("check_time", "")), reverse=True)

        # Enrich visitor metadata and drop internal helper key
        for p in inside_list + left_list:
            matched_v = p.pop("_matched_vis", None)
            if not target_staff:
                if not matched_v:
                    name_clean = p.get("fullname", "").strip().lower()
                    matched_v = visitor_map_by_name.get(name_clean)
                if matched_v:
                    p["company"] = matched_v.get("company") or "--"
                    p["host_person"] = matched_v.get("host_person") or "--"
                    p["phone"] = matched_v.get("phone") or "--"
                    p["cccd_number"] = matched_v.get("cccd_number") or matched_v.get("id_number") or "--"
                    if matched_v.get("department") and str(p.get("department") or "") in ("", "--", "Chỉ Huy Đội"):
                        p["department"] = matched_v["department"]

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
        """Logs manual unlock/lock command triggered by UI into JSON, SQL Server, and SharePoint Online in real time."""
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        record = {
            "id": str(uuid.uuid4())[:8],
            "timestamp": now_ts,
            "door_id": door_id,
            "door_name": door_name,
            "duration_sec": duration_sec,
            "action": action,
            "operator": operator,
            "success": success
        }
        with _get_lock(DOOR_ACTIONS_FILE):
            actions = _read_json(DOOR_ACTIONS_FILE, [], raise_on_error=True)
            actions.append(record)
            if len(actions) > 1000:
                actions = actions[-1000:]
            _write_json(DOOR_ACTIONS_FILE, actions)

        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                db_mssql.log_door_audit_db(
                    door_id=door_id,
                    door_name=door_name,
                    action=action,
                    duration_sec=duration_sec,
                    operator=operator,
                    success=success,
                    timestamp_str=now_ts
                )
        except Exception as db_err:
            logger.debug("log_door_audit_db skip: %s", db_err)

        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_door_audit_async(record)
        except Exception as sp_err:
            logger.debug("push_door_audit_async skip: %s", sp_err)

        return record

    def get_door_actions(self, limit: int = 100) -> List[Dict[str, Any]]:
        actions = _read_json(DOOR_ACTIONS_FILE, [])
        return sorted(actions, key=lambda x: x.get("timestamp", ""), reverse=True)[:limit]

    # ---------------- SharePoint Online Integration Hook (SEAZENHR-PORTAL App) ----------------

    def _get_sharepoint_access_token(self) -> Optional[str]:
        """Delegates to SEAZENHR-PORTAL (0390280b-12b8-49c4-adbf-a9c2b8bccfb5) OAuth2 Bearer Token."""
        try:
            import sharepoint_vms_sync
            tok = sharepoint_vms_sync.get_sharepoint_tokens()
            return tok.get("sp_token") if tok.get("ok") else None
        except Exception:
            return None

    def _sync_visitor_to_sharepoint(self, visitor_record: Dict[str, Any], is_checkout: bool = False):
        """Delegates real-time visitor sync to sharepoint_vms_sync (VMS SEAZEN - KHÁCH RA VÀO)."""
        try:
            import sharepoint_vms_sync
            if is_checkout:
                sharepoint_vms_sync.checkout_visitor_on_sharepoint_async(visitor_record)
            else:
                sharepoint_vms_sync.push_table_async("tbl_Visitors", 200)
        except Exception as e:
            logger.debug("_sync_visitor_to_sharepoint skip: %s", e)

    def _sync_door_action_to_sharepoint(self, door_action: Dict[str, Any]):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_door_audit_async(door_action)
        except Exception as e:
            logger.debug("_sync_door_action_to_sharepoint skip: %s", e)

    # ---------------- Excel Export ----------------

    def export_visitors_excel(self, output_target: Any) -> Any:
        """Exports visitor history to formatted Excel file path or writable stream (BytesIO)."""
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

        seen_exp = set()
        all_records = []
        for rec in (self.get_active_visitors() + self.get_visitor_history()):
            rec_key = f"{rec.get('id')}_{rec.get('checkin_time')}"
            if rec_key not in seen_exp:
                seen_exp.add(rec_key)
                all_records.append(rec)
        all_records.sort(key=lambda x: str(x.get("checkin_time") or ""), reverse=True)

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

        wb.save(output_target)
        return output_target
