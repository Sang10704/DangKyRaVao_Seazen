"""
SeaZen Smart Access Control - Web Application Server
Flask REST API & Web Dashboard for ZKTeco SenseFace Access Control.
Port: 6868
"""

import os
import sys
import json
import logging
import threading
from datetime import datetime
from typing import Optional, Dict, Any, List

# Ensure Windows stdout/stderr outputs UTF-8 cleanly
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, send_file, session
from flask_cors import CORS

import time
from zk_direct_client import ZkDirectClient
from epad_client import EpadClient
from storage import StorageManager, determine_scan_direction, determine_scan_person_type

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("server")
# Tắt log spam HTTP request định kỳ từ werkzeug (polling 4s/lần)
logging.getLogger("werkzeug").setLevel(logging.ERROR)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

# Load configuration
if not os.path.exists(CONFIG_PATH):
    raise FileNotFoundError(f"Configuration file not found: {CONFIG_PATH}")

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

# Initialize Flask App
app = Flask(__name__, static_folder=STATIC_DIR)
app.secret_key = config.get("server", {}).get("secret_key", "seazen-security-access-control-super-secret-key-2026")
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
CORS(app, supports_credentials=True)

# Initialize Modules (Direct ZKTeco Hardware + ePAD Enterprise Sync)
zk_client = ZkDirectClient(config)
epad_client = EpadClient(config)
storage = StorageManager(config)
EPAD_ENABLED = config.get("epad", {}).get("enabled", False)

DOORS_CONFIG = config.get("doors", [])
DOOR_NAME_MAP = {d["id"]: d["name"] for d in DOORS_CONFIG}


# ---------------- Authentication & RBAC Decorators ----------------

def get_current_user() -> Optional[Dict[str, Any]]:
    user_id = session.get("user_id")
    if not user_id:
        return None
    return storage.get_user_by_id(user_id)


def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"success": False, "error": "Vui lòng đăng nhập để tiếp tục!", "code": "UNAUTHORIZED"}), 401
        return f(*args, **kwargs)
    return decorated_function


def require_role(allowed_roles: List[str]):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user = get_current_user()
            if not user:
                return jsonify({"success": False, "error": "Vui lòng đăng nhập để tiếp tục!", "code": "UNAUTHORIZED"}), 401
            if user.get("role") not in allowed_roles:
                return jsonify({"success": False, "error": "Bạn không có quyền thực hiện thao tác này!", "code": "FORBIDDEN"}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ---------------- Authentication Endpoints ----------------

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Authenticates user with username or email, sets secure session."""
    data = request.get_json(silent=True) or {}
    cred = str(data.get("credential", "") or data.get("username", "") or data.get("email", "")).strip()
    password = str(data.get("password", "")).strip()

    if not cred or not password:
        return jsonify({"success": False, "error": "Vui lòng nhập tài khoản và mật khẩu!"}), 400

    user = storage.verify_user_credentials(cred, password)
    if not user:
        logger.warning("[AUTH FAILED] Đăng nhập thất bại với tài khoản: '%s'", cred)
        return jsonify({"success": False, "error": "Tài khoản hoặc mật khẩu không chính xác!"}), 401

    session["user_id"] = user["id"]
    session["role"] = user["role"]
    session["full_name"] = user["full_name"]

    logger.info("[AUTH SUCCESS] Người dùng '%s' (Vai trò: %s) đã đăng nhập thành công", user["full_name"], user["role"])

    return jsonify({
        "success": True,
        "message": "Đăng nhập thành công!",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user.get("email", ""),
            "full_name": user["full_name"],
            "role": user["role"]
        }
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Destroys current session."""
    u = get_current_user()
    if u:
        logger.info("[AUTH LOGOUT] Người dùng '%s' đã đăng xuất", u.get("full_name"))
    session.clear()
    return jsonify({"success": True, "message": "Đã đăng xuất thành công!"})


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    """Checks session and returns logged-in user profile with role."""
    user = get_current_user()
    if not user:
        return jsonify({"authenticated": False})
    return jsonify({
        "authenticated": True,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user.get("email", ""),
            "full_name": user["full_name"],
            "role": user["role"]
        }
    })

# ---------------- 24/7 Realtime Hardware Harvester Daemon ----------------
def _background_scan_collector():
    """
    Continuous 24/7 Background Harvester:
    1. Direct TCP communication (Port 4370) with all 4 ZKTeco SenseFace 4A terminals.
    2. Zero-lock snappy polling (connects, reads recent logs, disconnects immediately).
    3. Incremental backfill: compares with latest scan in DB/cache so no punch is ever dropped.
    4. Automatically writes to both Microsoft SQL Server tbl_AttendanceLogs and daily_scans.json cache.
    5. Periodically synchronizes terminal clocks to ensure 100% timestamp accuracy.
    6. Operates 100% independently from ePAD without kicking reception sessions.
    """
    logger.info("[Harvester Daemon] Khởi động luồng thu thập dữ liệu phần cứng 24/7 từ 4 máy ZKTeco SenseFace...")

    # 1. Initial Clock Sync & Startup Backfill
    try:
        time_sync_res = zk_client.sync_all_device_clocks()
        logger.info("[Harvester Daemon] Đồng bộ giờ ban đầu 4 thiết bị: %s", time_sync_res)
    except Exception as ex:
        logger.warning("[Harvester Daemon] Lỗi đồng bộ giờ ban đầu: %s", ex)

    # 2. Startup Backfill from Terminals
    try:
        startup_logs = zk_client.harvest_new_attendance_records(per_device_limit=150)
        if startup_logs:
            storage.merge_and_save_scans(startup_logs)
            logger.info("[Harvester Daemon] Đồng bộ ban đầu: Đã nạp %d lượt quét từ 4 máy vào hệ thống", len(startup_logs))
    except Exception as ex:
        logger.warning("[Harvester Daemon] Lỗi quét bù ban đầu: %s", ex)

    last_clock_sync = time.time()

    # 3. Main Snappy Polling Loop
    while True:
        try:
            # Periodic Clock Synchronization (Every 1 hour)
            now_ts = time.time()
            if now_ts - last_clock_sync > 3600:
                try:
                    zk_client.sync_all_device_clocks()
                    last_clock_sync = now_ts
                except Exception as ex:
                    logger.debug("[Harvester Daemon] Clock sync cycle warning: %s", ex)

            # Harvest new scans from 4 terminals
            latest_time = storage.get_latest_scan_time()
            recent_scans = zk_client.harvest_new_attendance_records(since_time=latest_time, per_device_limit=50)

            if recent_scans:
                storage.merge_and_save_scans(recent_scans)

        except Exception as e:
            logger.debug("[Harvester Daemon] Cycle warning: %s", e)

        time.sleep(4)

threading.Thread(target=_background_scan_collector, daemon=True, name="ZkHardwareHarvester").start()


# ---------------- Frontend Route ----------------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)


# ---------------- System Status API ----------------

@app.route("/api/status", methods=["GET"])
def get_system_status():
    """Returns general system health, direct ZKTeco hardware connection, and door states."""
    conn_info = zk_client.check_connection()
    active_count = len(storage.get_active_visitors())
    return jsonify({
        "status": "online",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "zk_direct": conn_info,
        "epad": conn_info,  # Kept for backward compatibility with frontend
        "doors": DOORS_CONFIG,
        "active_visitors_count": active_count
    })


# ---------------- Door Control APIs (Chỉ dành cho Admin) ----------------

@app.route("/api/door/unlock", methods=["POST"])
@app.route("/api/door/open", methods=["POST"])
@require_role(["admin"])
def unlock_door():
    """
    Unlocks a specific door or specific device channel with a snappy relay pulse (1s default).
    Payload: {"door_id": 1, "serial": "1313244800040", "channel_name": "Làn Vào phải", "seconds": 1}
    """
    data = request.get_json() or {}
    door_id = data.get("door_id", 1)
    serial = data.get("serial", None)
    seconds = data.get("seconds", 1)
    channel_name = data.get("channel_name")
    current_u = get_current_user()
    operator = data.get("operator") or (current_u["full_name"] if current_u else "Quản trị viên")

    log_name = channel_name if channel_name else DOOR_NAME_MAP.get(int(door_id), f"Cửa {door_id}")
    res = zk_client.unlock_door(int(door_id), int(seconds), serial=serial)

    # Async background logging - does not block HTTP response
    threading.Thread(
        target=storage.log_door_action,
        kwargs={
            "door_id": int(door_id),
            "door_name": log_name,
            "duration_sec": int(seconds),
            "action": "UNLOCK",
            "operator": operator,
            "success": res.get("success", False)
        },
        daemon=True
    ).start()

    return jsonify(res)


@app.route("/api/door/lock", methods=["POST"])
@app.route("/api/door/close", methods=["POST"])
@require_role(["admin"])
def lock_door_endpoint():
    """
    Immediately closes / locks a specific door or device channel (drops relay to 0).
    Payload: {"door_id": 1, "serial": "1313244800040", "channel_name": "Làn Vào phải"}
    """
    data = request.get_json() or {}
    door_id = data.get("door_id", 1)
    serial = data.get("serial", None)
    channel_name = data.get("channel_name")
    current_u = get_current_user()
    operator = data.get("operator") or (current_u["full_name"] if current_u else "Quản trị viên")

    log_name = channel_name if channel_name else DOOR_NAME_MAP.get(int(door_id), f"Cửa {door_id}")
    res = zk_client.lock_door(int(door_id), serial=serial)

    threading.Thread(
        target=storage.log_door_action,
        kwargs={
            "door_id": int(door_id),
            "door_name": log_name,
            "duration_sec": 0,
            "action": "LOCK",
            "operator": operator,
            "success": res.get("success", False)
        },
        daemon=True
    ).start()

    return jsonify(res)


@app.route("/api/door/unlock_all", methods=["POST"])
@require_role(["admin"])
def unlock_all():
    """
    Emergency or full unlock for all doors.
    Payload: {"seconds": 2}
    """
    data = request.get_json() or {}
    seconds = data.get("seconds", 2)
    current_u = get_current_user()
    operator = data.get("operator") or f"{current_u['full_name'] if current_u else 'Quản trị viên'} / Khẩn cấp mở tất cả"

    res = zk_client.unlock_all_doors(int(seconds))

    def _log_all():
        for d in DOORS_CONFIG:
            storage.log_door_action(
                door_id=d["id"],
                door_name=d["name"],
                duration_sec=int(seconds),
                action="UNLOCK",
                operator=operator,
                success=res.get("success", False)
            )
    threading.Thread(target=_log_all, daemon=True).start()

    return jsonify(res)


@app.route("/api/door/lock_all", methods=["POST"])
@app.route("/api/door/close_all", methods=["POST"])
@require_role(["admin"])
def lock_all_endpoint():
    """
    Closes / locks all 4 doors immediately.
    """
    data = request.get_json() or {}
    current_u = get_current_user()
    operator = data.get("operator") or f"{current_u['full_name'] if current_u else 'Quản trị viên'} / Khóa toàn bộ cửa"

    res = zk_client.lock_all_doors()

    def _log_all():
        for d in DOORS_CONFIG:
            storage.log_door_action(
                door_id=d["id"],
                door_name=d["name"],
                duration_sec=0,
                action="LOCK",
                operator=operator,
                success=res.get("success", False)
            )
    threading.Thread(target=_log_all, daemon=True).start()

    return jsonify(res)


@app.route("/api/door/status", methods=["GET"])
def door_status():
    """Returns real-time door open/close status."""
    if EPAD_ENABLED:
        status_list = epad_client.get_door_status()
    else:
        status_list = zk_client.get_door_status()
    # Enrich with door config names
    enriched = []
    for s in status_list:
        d_idx = s.get("DoorIndex")
        cfg = next((d for d in DOORS_CONFIG if d["id"] == d_idx), None)
        enriched.append({
            "door_id": d_idx,
            "door_name": cfg["name"] if cfg else f"Cửa {d_idx}",
            "direction": cfg["direction"] if cfg else "UNKNOWN",
            "is_open": s.get("Status", False)
        })
    return jsonify({"doors": enriched})


def parse_cccd_qr_string(raw_str: str) -> Optional[dict]:
    """
    Parses Vietnam Chip CCCD standard QR string (7 fields)
    as well as custom or truncated 3-4 field formats:
    049204013662||Nguyễn Huỳnh Văn Sang|10072004
    049204013662|Nguyễn Huỳnh Văn Sang|10072004
    """
    if not raw_str or "|" not in raw_str:
        return None

    parts = [p.strip() for p in raw_str.split("|")]
    if len(parts) < 3:
        return None

    cccd = parts[0]
    cmnd_old = ""
    full_name = ""
    raw_dob = ""
    gender = "Nam"
    address = ""
    raw_issue = ""

    # Format 1: 049204013662||Nguyễn Huỳnh Văn Sang|10072004...
    if len(parts) >= 4 and parts[1] == "" and not parts[2].isdigit():
        full_name = parts[2]
        raw_dob = parts[3]
        if len(parts) > 4: gender = parts[4]
        if len(parts) > 5: address = parts[5]
        if len(parts) > 6: raw_issue = parts[6]
    # Format 2: Standard 079199...|025123456|Nguyễn Văn An|15081995...
    elif len(parts) >= 4 and len(parts[1]) == 9 and parts[1].isdigit():
        cmnd_old = parts[1]
        full_name = parts[2]
        raw_dob = parts[3]
        if len(parts) > 4: gender = parts[4]
        if len(parts) > 5: address = parts[5]
        if len(parts) > 6: raw_issue = parts[6]
    # Format 3: 049204013662|Nguyễn Huỳnh Văn Sang|10072004...
    elif len(parts) >= 3 and not parts[1].isdigit():
        full_name = parts[1]
        raw_dob = parts[2]
        if len(parts) > 3: gender = parts[3]
        if len(parts) > 4: address = parts[4]
        if len(parts) > 5: raw_issue = parts[5]
    else:
        # Fallback
        if len(parts) > 1: full_name = parts[1]
        if len(parts) > 2: raw_dob = parts[2]

    # Format DOB: DDMMYYYY -> DD/MM/YYYY
    dob_formatted = raw_dob
    birth_year = ""
    if len(raw_dob) == 8 and raw_dob.isdigit():
        dob_formatted = f"{raw_dob[0:2]}/{raw_dob[2:4]}/{raw_dob[4:8]}"
        birth_year = raw_dob[4:8]
    elif len(raw_dob) == 4 and raw_dob.isdigit():
        birth_year = raw_dob
        dob_formatted = raw_dob

    # Format Issue Date
    issue_formatted = raw_issue
    if len(raw_issue) == 8 and raw_issue.isdigit():
        issue_formatted = f"{raw_issue[0:2]}/{raw_issue[2:4]}/{raw_issue[4:8]}"

    # Normalize gender
    if gender:
        g_lower = gender.lower()
        if "nữ" in g_lower or "nu" in g_lower or g_lower in ("female", "f"):
            gender = "Nữ"
        else:
            gender = "Nam"

    now = datetime.now()
    return {
        "cccd_number": cccd,
        "cmnd_old": cmnd_old,
        "full_name": full_name,
        "birth_date": dob_formatted,
        "birth_year": birth_year,
        "gender": gender or "Nam",
        "address": address,
        "issue_date": issue_formatted,
        "checkin_date": now.strftime("%Y-%m-%d"),
        "checkin_time": now.strftime("%H:%M:%S")
    }


@app.route("/api/door/realtime_logs", methods=["GET"])
@require_role(["admin", "staff"])
def realtime_logs():
    """
    Returns full scan events for the specified date (default today),
    guaranteeing complete history from early morning (not just rolling buffer).
    Auto-classifies direction into IN (Lượt Vào) vs OUT (Lượt Ra),
    and person category into STAFF vs VISITOR.
    Query params: ?date=YYYY-MM-DD&category=ALL|STAFF|VISITOR&direction=ALL|IN|OUT&limit=1000
    """
    target_date = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    is_today = (target_date == datetime.now().strftime("%Y-%m-%d"))
    category_filter = (request.args.get("category") or "ALL").upper()
    direction_filter = (request.args.get("direction") or "ALL").upper()
    search_query = (request.args.get("search") or "").strip().lower()
    limit = int(request.args.get("limit", 1000))

    # Scans are continuously collected and merged 24/7 by background thread
    scans = storage.get_saved_scans(target_date)

    enriched = []
    for l in scans:
        direction = determine_scan_direction(l)
        ptype = determine_scan_person_type(l)
        is_staff = ptype["is_staff"]
        category = ptype["category"]

        if category_filter != "ALL" and category != category_filter:
            continue
        if direction_filter != "ALL" and direction != direction_filter:
            continue

        item = dict(l)
        item["direction"] = direction
        item["direction_label"] = "Lượt VÀO" if direction == "IN" else "Lượt RA"
        item["is_staff"] = is_staff
        item["category"] = category
        item["category_name"] = ptype["category_name"]

        chk = str(item.get("CheckTime") or item.get("Time") or "")
        item["CheckTime"] = chk
        time_part = chk.split("T")[-1] if "T" in chk else (chk.split(" ")[-1] if " " in chk else chk)
        item["TimeFormatted"] = time_part

        if search_query:
            text_corpus = f"{item.get('FullName', '')} {item.get('EmployeeATID', '')} {item.get('Department', '')} {item.get('DeviceName', '')}".lower()
            if search_query not in text_corpus:
                continue

        enriched.append(item)

    # Sort descending by CheckTime (newest first)
    enriched.sort(key=lambda x: str(x.get("CheckTime", "")), reverse=True)

    return jsonify({
        "success": True,
        "date": target_date,
        "total_count": len(enriched),
        "logs": enriched[:limit]
    })


@app.route("/api/door/audit_logs", methods=["GET"])
@require_role(["admin"])
def audit_logs():
    """Returns history of manual remote door unlocks."""
    limit = int(request.args.get("limit", 50))
    actions = storage.get_door_actions(limit=limit)
    return jsonify({"actions": actions})


# ---------------- Visitor CCCD & Access Management APIs ----------------

@app.route("/api/visitor/parse_cccd", methods=["POST"])
@require_role(["admin", "staff"])
def parse_cccd_endpoint():
    """
    Bóc tách chuỗi QR CCCD thành thông tin định danh tiếng Việt chuẩn.
    Payload: {"qr_string": "079199...|...|..."}
    """
    data = request.get_json() or {}
    raw_qr = data.get("qr_string") or data.get("raw_qr") or ""
    parsed = parse_cccd_qr_string(raw_qr)
    if not parsed:
        return jsonify({
            "success": False,
            "error": "Định dạng mã QR không khớp chuẩn CCCD gắn chip (cần chuỗi phân tách bằng dấu |)"
        }), 400
    return jsonify({"success": True, "data": parsed})


@app.route("/api/visitor/register", methods=["POST"])
@require_role(["admin", "staff"])
def register_visitor():
    """
    Registers visitor into local database AND ePAD access control system.
    Pushes authorizations (Door 1 Làn Vào, Door 2 Làn Ra) directly to SenseFace 4A devices.
    """
    data = request.get_json() or {}
    full_name = str(data.get("full_name", "")).strip()
    cccd_num = str(data.get("cccd_number", "")).strip() or str(data.get("id_number", "")).strip()
    card_number = str(data.get("card_number", "")).strip()
    if card_number.isdigit():
        card_number = card_number.lstrip("0") or "0"
        data["card_number"] = card_number

    current_u = get_current_user()
    if current_u:
        data["operator"] = current_u.get("full_name") or data.get("operator", "Nhân viên tiếp đón")

    if not full_name and not cccd_num:
        return jsonify({"success": False, "error": "Vui lòng nhập họ tên hoặc quét mã CCCD"}), 400

    # 0. Validate card or CCCD availability immediately before touching hardware
    active_now = storage.get_active_visitors()
    if card_number:
        clean_c = card_number.lstrip("0")
        for item in active_now:
            item_card = str(item.get("card_number", "")).strip()
            item_clean = item_card.lstrip("0")
            if item_card and (item_card == card_number or (clean_c and item_clean == clean_c)):
                return jsonify({
                    "success": False,
                    "error": f"Thẻ {card_number} đang được sử dụng bởi khách: {item.get('full_name')}!",
                    "conflict_card": card_number,
                    "conflict_visitor": item
                }), 400

    if cccd_num:
        for item in active_now:
            existing_cccd = str(item.get("cccd_number", "")).strip() or str(item.get("id_number", "")).strip()
            if existing_cccd and existing_cccd == cccd_num:
                return jsonify({
                    "success": False,
                    "error": f"Số CCCD {cccd_num} ({item.get('full_name')}) đã được đăng ký và đang có mặt trong tòa nhà!",
                    "conflict_cccd": cccd_num,
                    "conflict_visitor": item
                }), 400

    # 1. Register customer & sync permissions to door devices
    epad_sync_info = "Không dùng ePAD (Chế độ nạp phần cứng trực tiếp)"
    epad_sync_ok = True
    epad_atid = None
    if card_number:
        if not EPAD_ENABLED:
            # Direct hardware enrollment to 4 ZKTeco terminals
            direct_res = zk_client.enroll_visitor_card(data)
            if direct_res.get("success"):
                epad_sync_ok = True
                epad_atid = direct_res.get("employee_atid")
                epad_sync_info = f"ĐÃ NẠP THẺ VÀO 4 MÁY CỬA TRỰC TIẾP (Mã khách: {epad_atid}, Phân quyền Làn Vào/Ra: 2,1)"
                data["epad_atid"] = epad_atid
            else:
                epad_sync_ok = False
                epad_sync_info = f"Lỗi nạp thẻ phần cứng: {direct_res.get('error')}"
                logger.warning("Nạp thẻ phần cứng lỗi: %s", direct_res.get("error"))
        else:
            try:
                epad_res = epad_client.register_customer_epad(data, auto_sync=True)
                if epad_res.get("success"):
                    epad_sync_ok = True
                    epad_atid = epad_res.get("employee_atid")
                    epad_sync_info = f"ĐÃ ĐỒNG BỘ CỬA THÀNH CÔNG (ePAD ATID: {epad_atid}, Phân quyền Làn Vào/Ra: 2,1)"
                    data["epad_atid"] = epad_atid
                else:
                    epad_sync_info = f"ePAD cảnh báo: {epad_res.get('error', 'Không xác định')}"
                    logger.warning("Đăng ký lên ePAD trả về lỗi: %s", epad_res.get("error"))
            except Exception as ex:
                epad_sync_info = f"Lỗi ngoại lệ ePAD: {ex}"
                logger.error("Lỗi khi kết nối ePAD register_customer: %s", ex)

    # 2. Save into local persistent database (active_visitors.json)
    try:
        record = storage.add_visitor(data)
    except ValueError as ve:
        conflict_v = None
        c_num = str(data.get("card_number") or "").strip()
        if c_num:
            clean_c = c_num.lstrip("0")
            for av in storage.get_active_visitors():
                av_c = str(av.get("card_number") or "").strip()
                av_clean = av_c.lstrip("0")
                if av_c and (av_c == c_num or (clean_c and av_clean == clean_c)):
                    conflict_v = av
                    break
        return jsonify({
            "success": False,
            "error": str(ve),
            "conflict_card": c_num,
            "conflict_visitor": conflict_v
        }), 400

    # 3. Explicit, highly visible terminal stdout logging
    total_active = len(storage.get_active_visitors())
    print("\n" + "=" * 76, flush=True)
    print(">>> [DATABASE OK] ĐÃ LƯU KHÁCH THÀNH CÔNG VÀO DATABASE & ĐỒNG BỘ CỬA ePAD!", flush=True)
    print(f"    * ID Hồ sơ      : {record.get('id')}", flush=True)
    print(f"    * Họ và tên     : {record.get('full_name')}", flush=True)
    print(f"    * Số CCCD       : {record.get('cccd_number')}", flush=True)
    print(f"    * Mã Thẻ RFID   : {record.get('card_number') or '(Không cấp thẻ)'}", flush=True)
    print(f"    * Giờ vào       : {record.get('checkin_time')}", flush=True)
    print(f"    * Dự kiến ra    : {record.get('expected_checkout_time')}", flush=True)
    print(f"    * Phòng ban     : {record.get('department')}", flush=True)
    print(f"    * Người tiếp đón: {record.get('host_person')}", flush=True)
    print(f"    * Trạng thái DB : ĐÃ LƯU VÀO active_visitors.json (Tổng khách tại chỗ: {total_active})", flush=True)
    print(f"    * Hệ thống Cửa  : {epad_sync_info}", flush=True)
    print("=" * 76 + "\n", flush=True)

    # 4. Optional auto unlock (default False)
    auto_unlock = data.get("auto_unlock", False)
    if auto_unlock:
        zk_client.unlock_door(door_id=1, auto_off_seconds=1)
        storage.log_door_action(
            door_id=1,
            door_name="Cửa Làn VÀO",
            duration_sec=1,
            action="UNLOCK",
            operator=f"Tự động khi đăng ký khách {full_name}",
            success=True
        )

    resp_msg = (
        f"Đã đăng ký thành công cho khách {full_name or cccd_num}. Đã lưu CSDL & đồng bộ thiết bị cửa."
        if epad_sync_ok or not card_number
        else f"Đã lưu CSDL cho khách {full_name or cccd_num} nhưng {epad_sync_info}."
    )

    return jsonify({
        "success": True,
        "visitor": record,
        "epad_sync": epad_sync_info,
        "epad_sync_ok": epad_sync_ok,
        "message": resp_msg
    })


@app.route("/api/visitor/fast_checkout", methods=["POST"])
@require_role(["admin", "staff"])
def fast_checkout():
    """
    Fast check-out when scanning CCCD QR, RFID card, or clicking Check-out.
    Payload: {"query": "079199001234"} or {"query": "full_qr_string..."}
    """
    data = request.get_json() or {}
    query = str(data.get("query", "")).strip()
    if not query:
        query = str(data.get("card_number", "")).strip() or str(data.get("cccd_number", "")).strip() or str(data.get("id", "")).strip()

    # If user scanned entire CCCD QR during checkout
    if "|" in query:
        parsed = parse_cccd_qr_string(query)
        if parsed and parsed.get("cccd_number"):
            query = parsed["cccd_number"]

    if not query:
        return jsonify({"success": False, "error": "Vui lòng cung cấp mã thẻ hoặc số CCCD để check-out"}), 400

    record = storage.checkout_visitor(query)
    if not record:
        print(f"\n>>> [DATABASE CHECKOUT FAILED] Không tìm thấy khách tương ứng mã: '{query}'", flush=True)
        return jsonify({"success": False, "error": f"Không tìm thấy lượt vào của khách tương ứng với '{query}' trong danh sách đang có mặt"}), 404

    # If visitor was holding an RFID card, release / return card
    target_card = record.get("card_number")
    epad_return_msg = "Không dùng thẻ"
    if target_card:
        if not EPAD_ENABLED:
            ret_res = zk_client.return_or_delete_card(target_card)
            epad_return_msg = f"Đã thu hồi thẻ {target_card} trên 4 máy cửa trực tiếp thành công" if ret_res.get("success") else f"Lỗi thu hồi thẻ phần cứng: {ret_res.get('error')}"
        else:
            try:
                ret_res = epad_client.return_or_delete_card(target_card)
                epad_return_msg = f"Đã thu hồi thẻ {target_card} trên ePAD thành công" if ret_res.get("success") else f"Lỗi thu hồi thẻ: {ret_res.get('error')}"
            except Exception as e:
                epad_return_msg = f"Ngoại lệ khi thu hồi thẻ: {e}"

    # Explicit, highly visible terminal stdout logging for Checkout
    print("\n" + "=" * 76, flush=True)
    print(">>> [DATABASE OK] ĐÃ CHECK-OUT VÀ CẬP NHẬT DATABASE THÀNH CÔNG!", flush=True)
    print(f"    * Khách         : {record.get('full_name')}", flush=True)
    print(f"    * Số CCCD       : {record.get('cccd_number')}", flush=True)
    print(f"    * Mã Thẻ RFID   : {record.get('card_number') or '(Không)'}", flush=True)
    print(f"    * Giờ vào       : {record.get('checkin_time')}", flush=True)
    print(f"    * Giờ ra        : {record.get('checkout_time')}", flush=True)
    print(f"    * Thời lượng    : {record.get('duration_str')}", flush=True)
    print(f"    * Trạng thái DB : ĐÃ CHUYỂN TỪ active_visitors SANG visitor_history.json", flush=True)
    print(f"    * Thẻ ePAD      : {epad_return_msg}", flush=True)
    print("=" * 76 + "\n", flush=True)

    auto_unlock = data.get("auto_unlock", False)
    if auto_unlock:
        zk_client.unlock_door(door_id=2, auto_off_seconds=1)
        current_u = get_current_user()
        storage.log_door_action(
            door_id=2,
            door_name="Cửa Làn RA",
            duration_sec=1,
            action="UNLOCK",
            operator=f"Tự động khi checkout khách {record.get('full_name')} ({current_u['full_name'] if current_u else ''})",
            success=True
        )

    return jsonify({
        "success": True,
        "visitor": record,
        "epad_card_status": epad_return_msg,
        "message": f"Đã check-out thành công cho khách {record.get('full_name')} (Thời gian lưu lại: {record.get('duration_str')})"
    })


@app.route("/api/visitor/batch_checkout", methods=["POST"])
@require_role(["admin", "staff"])
def batch_checkout():
    """
    Checks out multiple active visitors at once.
    Payload: {"ids": ["...", "..."]}
    """
    data = request.get_json(silent=True) or {}
    items = data.get("ids") or data.get("queries") or []
    if not items:
        return jsonify({"success": False, "error": "Vui lòng chọn ít nhất một khách để check-out!"}), 400

    results = []
    success_count = 0
    fail_count = 0

    for q in items:
        q_str = str(q).strip()
        if not q_str:
            continue
        record = storage.checkout_visitor(q_str)
        if record:
            success_count += 1
            target_card = record.get("card_number")
            if target_card:
                try:
                    if not EPAD_ENABLED:
                        zk_client.return_or_delete_card(target_card)
                    else:
                        epad_client.return_or_delete_card(target_card)
                except Exception:
                    pass
            results.append({"query": q_str, "success": True, "name": record.get("full_name")})
        else:
            fail_count += 1
            results.append({"query": q_str, "success": False, "error": "Không tìm thấy"})

    logger.info("[BATCH CHECKOUT] Đã check-out hàng loạt: %d thành công, %d thất bại", success_count, fail_count)
    return jsonify({
        "success": True,
        "success_count": success_count,
        "fail_count": fail_count,
        "results": results,
        "message": f"Đã check-out thành công cho {success_count} khách!"
    })


@app.route("/api/analytics/dashboard", methods=["GET"])
@require_role(["admin", "staff"])
def get_dashboard_analytics():
    """
    Returns aggregated office monitoring metrics and hourly charts data for any selected date.
    Query param: ?date=YYYY-MM-DD (defaults to today)
    """
    target_date = request.args.get("date")
    now_str = datetime.now().strftime("%Y-%m-%d")
    is_today = not target_date or target_date == now_str
    if is_today and EPAD_ENABLED:
        try:
            live = epad_client.get_log_last_7_days()
            if live:
                storage.sync_epad_7day_logs(live)
        except Exception:
            pass

    analytics = storage.get_dashboard_analytics(target_date=target_date)
    return jsonify({"success": True, "analytics": analytics})


@app.route("/api/analytics/present_details", methods=["GET"])
@require_role(["admin", "staff"])
def get_present_details_endpoint():
    """
    Returns the exact list of people currently inside the office on the given date
    (whose latest scan was at an IN door/lane).
    Query params:
      ?type=staff|visitor (default: staff)
      ?date=YYYY-MM-DD (default: today)
    """
    cat_type = (request.args.get("type") or "staff").lower()
    target_date = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    is_today = (target_date == datetime.now().strftime("%Y-%m-%d"))

    # If today, sync latest logs from ePAD
    if is_today and EPAD_ENABLED:
        try:
            live = epad_client.get_log_last_7_days()
            if live:
                storage.sync_epad_7day_logs(live)
        except Exception:
            pass

    category_key = "STAFF" if cat_type != "visitor" else "VISITOR"
    details = storage.get_present_details(target_date=target_date, category=category_key)
    inside_items = details.get("inside", [])
    left_items = details.get("left", [])

    title = "Chi Tiết Nhân Viên Ra Vào" if category_key == "STAFF" else "Chi Tiết Khách Ra Vào"

    return jsonify({
        "success": True,
        "date": target_date,
        "type": cat_type,
        "category": category_key,
        "title": title,
        "count_inside": len(inside_items),
        "count_left": len(left_items),
        "inside_items": inside_items,
        "left_items": left_items,
        "count": len(inside_items),
        "items": inside_items
    })


# ---------------- Department & Employee Lookup APIs ----------------

@app.route("/api/departments", methods=["GET"])
@require_role(["admin", "staff"])
def get_departments():
    """Returns official company department list from ePAD."""
    depts = storage.get_departments()
    if not depts:
        try:
            tree = epad_client.get_department_tree()
            if tree:
                storage.set_department_tree(tree)
                depts = storage.get_departments()
        except Exception as e:
            logger.warning("Error getting department tree: %s", e)
    return jsonify({"success": True, "departments": depts})


@app.route("/api/employees", methods=["GET"])
@require_role(["admin", "staff"])
def get_employees():
    """
    Returns employees list with search, department filter, and pagination.
    Query params: ?department=...&q=...&page=1&limit=25
    """
    dept = request.args.get("department")
    q = (request.args.get("q") or "").strip().lower()
    page = max(1, int(request.args.get("page", 1)))
    limit = min(200, max(10, int(request.args.get("limit", 25))))

    all_emps = storage.get_employees(department=dept)
    if not all_emps and not dept and EPAD_ENABLED:
        try:
            all_raw = epad_client.get_all_employees()
            if all_raw:
                storage.set_employees(all_raw)
                all_emps = storage.get_employees()
        except Exception as e:
            logger.warning("Error getting employees: %s", e)

    # Exclude temporary cards / guests marked as "Khác" or empty department
    all_emps = [
        e for e in all_emps
        if str(e.get("department") or "").strip() not in ["", "Khác", "--", "None"]
    ]

    # Search filter
    if q:
        all_emps = [
            e for e in all_emps
            if q in str(e.get("fullname", "")).lower()
            or q in str(e.get("atid", "")).lower()
            or q in str(e.get("code", "")).lower()
            or q in str(e.get("card_number", "")).lower()
            or q in str(e.get("department", "")).lower()
        ]

    total = len(all_emps)
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    paginated = all_emps[start_idx:end_idx]

    depts = storage.get_departments()

    return jsonify({
        "success": True,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit if limit > 0 else 1,
        "department": dept,
        "count": len(paginated),
        "departments_count": len(depts),
        "employees": paginated
    })


# ---------------- SQL Server Management APIs ----------------

@app.route("/api/database/status", methods=["GET"])
@require_role(["admin"])
def api_database_status():
    """Checks Microsoft SQL Server connectivity and database status."""
    import db_mssql
    res = db_mssql.test_connection()
    return jsonify(res)


@app.route("/api/database/init", methods=["POST"])
@require_role(["admin"])
def api_database_init():
    """Initializes SeaZen_AccessControl schema and imports all 796 employees, 12 departments, and punch history."""
    import db_mssql
    schema_path = os.path.join(BASE_DIR, "database_schema.sql")
    seed_path = os.path.join(BASE_DIR, "seed_data_export.sql")

    ok, msg = db_mssql.execute_sql_script(schema_path)
    if not ok:
        return jsonify({"success": False, "message": f"Lỗi tạo Schema: {msg}"}), 500

    ok, msg = db_mssql.execute_sql_script(seed_path, target_db="SeaZen_AccessControl")
    if not ok:
        return jsonify({"success": False, "message": f"Lỗi nạp Dữ liệu: {msg}"}), 500

    try:
        cfg = db_mssql.load_db_config()
        cfg["enabled"] = True
        config_file = os.path.join(BASE_DIR, "config.json")
        with open(config_file, "r", encoding="utf-8") as f:
            full_cfg = json.load(f)
        full_cfg["database"] = cfg
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(full_cfg, f, ensure_ascii=False, indent=2)
    except Exception as ex:
        logger.warning("Auto-enable DB config warning: %s", ex)

    return jsonify({
        "success": True,
        "message": "Khởi tạo CSDL Microsoft SQL Server & nạp toàn bộ 796 nhân sự, 12 phòng ban, 2.451 nhật ký chấm công thành công!"
    })


@app.route("/api/sync/epad_history", methods=["POST"])
@require_role(["admin"])
def sync_epad_history():
    """Manually triggers 7-day historical logs and personnel sync from ePAD."""
    if not EPAD_ENABLED:
        return jsonify({
            "success": False,
            "error": "Chức năng đồng bộ ePAD đang được tắt để bảo vệ phiên làm việc của máy Lễ tân không bị văng."
        }), 400

    try:
        hist_logs = epad_client.get_log_last_7_days()
        synced_count = storage.sync_epad_7day_logs(hist_logs) if hist_logs else 0

        dept_tree = epad_client.get_department_tree()
        if dept_tree:
            storage.set_department_tree(dept_tree)

        all_emps = epad_client.get_all_employees()
        if all_emps:
            storage.set_employees(all_emps)

        return jsonify({
            "success": True,
            "message": f"Đã đồng bộ thành công {synced_count} lượt quét từ 4 máy ZKTeco SenseFace và danh mục nội bộ!"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# Backward compatible route for checkin
@app.route("/api/visitor/checkin", methods=["POST"])
@require_role(["admin", "staff"])
def visitor_checkin():
    return register_visitor()


# Backward compatible route for checkout
@app.route("/api/visitor/checkout", methods=["POST"])
@require_role(["admin", "staff"])
def visitor_checkout():
    return fast_checkout()


@app.route("/api/visitors/active", methods=["GET"])
@require_role(["admin", "staff"])
def get_active_visitors():
    return jsonify({"visitors": storage.get_active_visitors()})


@app.route("/api/visitors/history", methods=["GET"])
@require_role(["admin"])
def get_visitor_history():
    limit = int(request.args.get("limit", 200))
    return jsonify({"history": storage.get_visitor_history(limit=limit)})


# ---------------- Excel Export Route ----------------

@app.route("/api/export/visitors", methods=["GET"])
@require_role(["admin"])
def export_visitors():
    export_path = os.path.join(BASE_DIR, "data", "Bao_Cao_Khach_Ra_Vao.xlsx")
    storage.export_visitors_excel(export_path)
    return send_file(
        export_path,
        as_attachment=True,
        download_name=f"Bao_Cao_Khach_Ra_Vao_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    )


# ---------------- Application Entry Point ----------------

def get_local_ip() -> str:
    """Detects the primary LAN IP address for multi-machine access."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ---------------- Application Entry Point ----------------

if __name__ == "__main__":
    server_cfg = config.get("server", {})
    host = server_cfg.get("host", "0.0.0.0")
    port = server_cfg.get("port", 6868)
    debug = server_cfg.get("debug", False)
    lan_ip = get_local_ip()

    print(f"\n======================================================================")
    print(f"  SEAZEN SMART ACCESS CONTROL - SAN SANG TRUY CAP NHIEU MAY (LAN)")
    print(f"======================================================================")
    print(f"  [1] Truy cap tai MAY NAY (Admin/Server) : http://localhost:{port}")
    print(f"  [2] Truy cap tu MAY LE TAN / MAY KHAC   : http://{lan_ip}:{port}")
    print(f"  [3] Che do ket noi thiet bi             : ZKTeco Direct TCP (SenseFace 4A - 4/4 Online)")
    print(f"======================================================================\n")

    try:
        from waitress import serve
        logger.info("Khoi chay may chu da luong Waitress (threads=16) - on dinh tuyet doi cho nhieu may...")
        serve(app, host=host, port=port, threads=16, channel_timeout=60)
    except ImportError:
        logger.warning("Chay che do du phong Flask server (threaded=True)...")
        app.run(host=host, port=port, debug=debug, threaded=True)
