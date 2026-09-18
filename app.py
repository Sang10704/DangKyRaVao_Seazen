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

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS

import time
from epad_client import EpadClient
from storage import StorageManager, determine_scan_direction, determine_scan_person_type

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("server")

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
CORS(app)

# Initialize Modules
epad_client = EpadClient(config)
storage = StorageManager(config)

DOORS_CONFIG = config.get("doors", [])
DOOR_NAME_MAP = {d["id"]: d["name"] for d in DOORS_CONFIG}

# Background worker that initializes ePAD data and accumulates scans 24/7
def _background_scan_collector():
    logger.info("[Background Worker] Bắt đầu đồng bộ danh mục ePAD và tích lũy lượt quét 24/7...")
    # 1. Fetch & Cache Department Tree & Personnel
    try:
        dept_tree = epad_client.get_department_tree()
        if dept_tree:
            storage.set_department_tree(dept_tree)
            logger.info("Đã đồng bộ %d phòng ban chính thức từ ePAD", len(storage.get_departments()))
        
        emps = epad_client.get_all_employees()
        if emps:
            storage.set_employees(emps)
            logger.info("Đã đồng bộ %d nhân sự từ ePAD", len(storage.get_employees()))

        # 2. Sync 7-day Historical Scans
        hist_logs = epad_client.get_log_last_7_days()
        if hist_logs:
            cnt = storage.sync_epad_7day_logs(hist_logs)
            logger.info("Đã đồng bộ %d lượt quét lịch sử 7 ngày từ ePAD", cnt)
    except Exception as ex:
        logger.warning("Cảnh báo khi đồng bộ khởi tạo dữ liệu ePAD: %s", ex)

    # 3. Continuous 24/7 Realtime Polling with periodic 7-day refresh
    iter_count = 0
    while True:
        try:
            logs = epad_client.get_realtime_attendance_logs(limit=100)
            if logs:
                storage.merge_and_save_scans(logs)

            iter_count += 1
            # Every ~10 minutes (120 * 5s), re-fetch 7-day history so morning scans are 100% complete
            if iter_count >= 120:
                iter_count = 0
                h_logs = epad_client.get_log_last_7_days()
                if h_logs:
                    storage.sync_epad_7day_logs(h_logs)
        except Exception as e:
            logger.debug("Background scan collector warning: %s", e)
        time.sleep(5)

threading.Thread(target=_background_scan_collector, daemon=True).start()


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
    """Returns general system health, ePAD connection, and door states."""
    conn_info = epad_client.check_connection()
    active_count = len(storage.get_active_visitors())
    return jsonify({
        "status": "online",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "epad": conn_info,
        "doors": DOORS_CONFIG,
        "active_visitors_count": active_count
    })


# ---------------- Door Control APIs ----------------

@app.route("/api/door/unlock", methods=["POST"])
def unlock_door():
    """
    Unlocks a specific door or specific device channel.
    Payload: {"door_id": 1, "serial": "1313244800040", "channel_name": "Cửa Vào 1", "seconds": 3, "operator": "Bảo vệ"}
    """
    data = request.get_json() or {}
    door_id = data.get("door_id", 1)
    serial = data.get("serial", None)
    seconds = data.get("seconds", 3)
    channel_name = data.get("channel_name")
    operator = data.get("operator", "Bảo vệ trực")

    log_name = channel_name if channel_name else DOOR_NAME_MAP.get(int(door_id), f"Cửa {door_id}")
    res = epad_client.unlock_door(int(door_id), int(seconds), serial=serial)

    # Async background logging - does not block HTTP response
    threading.Thread(
        target=storage.log_door_action,
        kwargs={
            "door_id": int(door_id),
            "door_name": log_name,
            "duration_sec": int(seconds),
            "operator": operator,
            "success": res.get("success", False)
        },
        daemon=True
    ).start()

    return jsonify(res)


@app.route("/api/door/unlock_all", methods=["POST"])
def unlock_all():
    """
    Emergency or full unlock for all doors.
    Payload: {"seconds": 5, "operator": "Khẩn cấp"}
    """
    data = request.get_json() or {}
    seconds = data.get("seconds", 5)
    operator = data.get("operator", "Khẩn cấp / Mở tất cả")

    res = epad_client.unlock_all_doors(int(seconds))

    def _log_all():
        for d in DOORS_CONFIG:
            storage.log_door_action(
                door_id=d["id"],
                door_name=d["name"],
                duration_sec=int(seconds),
                operator=operator,
                success=res.get("success", False)
            )
    threading.Thread(target=_log_all, daemon=True).start()

    return jsonify(res)


@app.route("/api/door/status", methods=["GET"])
def door_status():
    """Returns real-time door open/close status from ePAD."""
    status_list = epad_client.get_door_status()
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

    # If today, grab latest scans from ePAD to merge
    if is_today:
        try:
            live = epad_client.get_realtime_attendance_logs(limit=100)
            if live:
                storage.merge_and_save_scans(live)
        except Exception as e:
            logger.debug("Live sync in realtime_logs warning: %s", e)

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
def audit_logs():
    """Returns history of manual remote door unlocks."""
    limit = int(request.args.get("limit", 50))
    actions = storage.get_door_actions(limit=limit)
    return jsonify({"actions": actions})


# ---------------- Visitor CCCD & Access Management APIs ----------------

@app.route("/api/visitor/parse_cccd", methods=["POST"])
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
def register_visitor():
    """
    Registers visitor into local database AND ePAD access control system.
    Pushes authorizations (Door 1 Làn Vào, Door 2 Làn Ra) directly to SenseFace 4A devices.
    """
    data = request.get_json() or {}
    full_name = str(data.get("full_name", "")).strip()
    cccd_num = str(data.get("cccd_number", "")).strip() or str(data.get("id_number", "")).strip()
    card_number = str(data.get("card_number", "")).strip()

    if not full_name and not cccd_num:
        return jsonify({"success": False, "error": "Vui lòng nhập họ tên hoặc quét mã CCCD"}), 400

    # 1. Register customer into official ePAD HR_CustomerInfo & sync permissions to door devices
    epad_sync_info = "Chưa kết nối ePAD"
    epad_atid = None
    try:
        epad_res = epad_client.register_customer_epad(data, auto_sync=True)
        if epad_res.get("success"):
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
        return jsonify({"success": False, "error": str(ve)}), 400

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
        epad_client.unlock_door(door_id=1, auto_off_seconds=3)
        storage.log_door_action(
            door_id=1,
            door_name="Cửa Làn VÀO",
            duration_sec=3,
            operator=f"Tự động khi đăng ký khách {full_name}",
            success=True
        )

    return jsonify({
        "success": True,
        "visitor": record,
        "epad_sync": epad_sync_info,
        "message": f"Đã đăng ký thành công cho khách {full_name or cccd_num}. Đã lưu CSDL & đồng bộ thiết bị cửa."
    })


@app.route("/api/visitor/fast_checkout", methods=["POST"])
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

    # If visitor was holding an RFID card, release / return card in ePAD so it can be reused immediately
    target_card = record.get("card_number")
    epad_return_msg = "Không dùng thẻ"
    if target_card:
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
        epad_client.unlock_door(door_id=2, auto_off_seconds=3)
        storage.log_door_action(
            door_id=2,
            door_name="Cửa Làn RA",
            duration_sec=3,
            operator=f"Tự động khi checkout khách {record.get('full_name')}",
            success=True
        )

    return jsonify({
        "success": True,
        "visitor": record,
        "epad_card_status": epad_return_msg,
        "message": f"Đã check-out thành công cho khách {record.get('full_name')} (Thời gian lưu lại: {record.get('duration_str')})"
    })


@app.route("/api/analytics/dashboard", methods=["GET"])
def get_dashboard_analytics():
    """
    Returns aggregated office monitoring metrics and hourly charts data for any selected date.
    Query param: ?date=YYYY-MM-DD (defaults to today)
    """
    target_date = request.args.get("date")
    now_str = datetime.now().strftime("%Y-%m-%d")
    is_today = not target_date or target_date == now_str

    logs = []
    if is_today:
        try:
            logs = epad_client.get_realtime_attendance_logs(limit=100)
        except Exception:
            logs = []

    analytics = storage.get_dashboard_analytics(target_date=target_date, realtime_logs=logs)
    return jsonify({"success": True, "analytics": analytics})


@app.route("/api/analytics/present_details", methods=["GET"])
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

    # If today, sync latest rolling buffer first
    if is_today:
        try:
            live = epad_client.get_realtime_attendance_logs(limit=100)
            if live:
                storage.merge_and_save_scans(live)
        except Exception:
            pass

    category_key = "STAFF" if cat_type != "visitor" else "VISITOR"
    items = storage.get_present_details(target_date=target_date, category=category_key)

    title = "Danh Sách Nhân Viên Đang Có Mặt Trong Văn Phòng" if category_key == "STAFF" else "Danh Sách Khách Đang Có Mặt Trong Văn Phòng"

    return jsonify({
        "success": True,
        "date": target_date,
        "type": cat_type,
        "category": category_key,
        "title": title,
        "count": len(items),
        "items": items
    })


# ---------------- Department & Employee Lookup APIs ----------------

@app.route("/api/departments", methods=["GET"])
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
def get_employees():
    """
    Returns employees list, optionally filtered by department.
    Query param: ?department=SeaZen+Tech
    """
    dept = request.args.get("department")
    emps = storage.get_employees(department=dept)
    if not emps and not dept:
        try:
            all_raw = epad_client.get_all_employees()
            if all_raw:
                storage.set_employees(all_raw)
                emps = storage.get_employees(department=dept)
        except Exception as e:
            logger.warning("Error getting employees: %s", e)
    return jsonify({"success": True, "department": dept, "count": len(emps), "employees": emps})


@app.route("/api/sync/epad_history", methods=["POST"])
def sync_epad_history():
    """Manually triggers 7-day historical logs and personnel sync from ePAD."""
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
            "message": f"Đã đồng bộ thành công {synced_count} lượt quét lịch sử và danh mục nhân sự từ ePAD"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# Backward compatible route for checkin
@app.route("/api/visitor/checkin", methods=["POST"])
def visitor_checkin():
    return register_visitor()


# Backward compatible route for checkout
@app.route("/api/visitor/checkout", methods=["POST"])
def visitor_checkout():
    return fast_checkout()


@app.route("/api/visitors/active", methods=["GET"])
def get_active_visitors():
    return jsonify({"visitors": storage.get_active_visitors()})


@app.route("/api/visitors/history", methods=["GET"])
def get_visitor_history():
    limit = int(request.args.get("limit", 200))
    return jsonify({"history": storage.get_visitor_history(limit=limit)})


# ---------------- Excel Export Route ----------------

@app.route("/api/export/visitors", methods=["GET"])
def export_visitors():
    export_path = os.path.join(BASE_DIR, "data", "Bao_Cao_Khach_Ra_Vao.xlsx")
    storage.export_visitors_excel(export_path)
    return send_file(
        export_path,
        as_attachment=True,
        download_name=f"Bao_Cao_Khach_Ra_Vao_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    )


# ---------------- Application Entry Point ----------------

if __name__ == "__main__":
    server_cfg = config.get("server", {})
    host = server_cfg.get("host", "0.0.0.0")
    port = server_cfg.get("port", 6868)
    debug = server_cfg.get("debug", False)

    print(f"\n==================================================")
    print(f"  SEAZEN SMART ACCESS CONTROL SERVER")
    print(f"  Running on: http://localhost:{port}")
    print(f"  ePAD Server: {config.get('epad', {}).get('api_base')}")
    print(f"==================================================\n")

    app.run(host=host, port=port, debug=debug)
