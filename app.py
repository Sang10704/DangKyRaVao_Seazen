"""
SeaZen Smart Access Control - Web Application Server
Flask REST API & Web Dashboard for ZKTeco SenseFace Access Control.
Port: 6868
"""

import os
import sys
import json
import socket
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
REACT_DIST_DIR = os.path.join(BASE_DIR, "ui", "frontend", "dist")
STATIC_DIR = REACT_DIST_DIR
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
    if session.get("logged_out"):
        return None
    user_id = session.get("user_id")
    if user_id:
        u = storage.get_user_by_id(user_id)
        if u:
            return u
    return None


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

    session.pop("logged_out", None)
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
            "role": user["role"],
            "allowed_pages": user.get("allowed_pages", ["ALL"] if user["role"] == "admin" else ["/visitors"])
        }
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Destroys current session and marks explicit logout."""
    u = get_current_user()
    if u:
        logger.info("[AUTH LOGOUT] Người dùng '%s' đã đăng xuất", u.get("full_name"))
    session.clear()
    session["logged_out"] = True
    return jsonify({"success": True, "message": "Đã đăng xuất thành công!"})


def _get_server_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("172.16.56.139", 4370))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            return ip
    except Exception:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "127.0.0.1"


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    """Checks session and returns logged-in user profile with role."""
    user = get_current_user()
    if not user:
        return jsonify({"authenticated": False})
    host_port = request.host.split(":")[1] if ":" in str(request.host or "") else ("6869" if _IS_DEV_MODE else "6868")
    lan_ip = _get_server_lan_ip()
    pc_name = (os.environ.get("COMPUTERNAME") or socket.gethostname() or lan_ip).strip()
    return jsonify({
        "authenticated": True,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user.get("email", ""),
            "full_name": user["full_name"],
            "role": user["role"],
            "allowed_pages": user.get("allowed_pages", ["ALL"] if user["role"] == "admin" else ["/visitors"]),
            "lan_url": f"http://{pc_name}:{host_port}",
            "lan_ip_url": f"http://{lan_ip}:{host_port}",
        }
    })

# ---------------- 24/7 Realtime Hardware Harvester Daemon ----------------
def _background_scan_collector():
    """
    Continuous 24/7 Background Harvester:
    1. Starts 4 persistent TCP 4370 Real-Time Event Listeners (CMD_REG_EVENT: EF_ATTLOG | EF_VERIFY)
       to capture every face/card scan on ZKTeco SenseFace 4A in <50ms (even in push-ac mode).
    2. Fallback periodic check of static AttLog buffer every 15s.
    3. Writes immediately to both Microsoft SQL Server (tbl_AttendanceLogs + tbl_DailyTimekeeping)
       and daily_scans.json cache.
    4. Operates 100% independently from ePAD (zero ePAD API calls).
    """
    logger.info("[Harvester Daemon] Khởi động luồng bắt sự kiện trực tiếp 24/7 (TCP 4370 reg_event) từ 4 máy ZKTeco SenseFace...")

    # 1. Start persistent real-time event listeners on all 4 ZKTeco terminals
    try:
        zk_client.start_live_event_listeners(storage.merge_and_save_scans)
    except Exception as ex:
        logger.warning("[Harvester Daemon] Lỗi khởi tạo live event listeners: %s", ex)

    # 2. Initial Read-Only Clock Audit & Startup Backfill
    try:
        time_sync_res = zk_client.sync_all_device_clocks()
        logger.info("[Harvester Daemon] Đối soát giờ ban đầu 4 thiết bị: %s", time_sync_res.get("mode"))
    except Exception as ex:
        logger.warning("[Harvester Daemon] Lỗi đối soát giờ ban đầu: %s", ex)

    try:
        startup_logs = zk_client.harvest_new_attendance_records(per_device_limit=200)
        if startup_logs:
            storage.merge_and_save_scans(startup_logs)
            logger.info("[Harvester Daemon] Đồng bộ ban đầu TCP 4370: Đã nạp %d lượt quét từ 4 máy vào hệ thống", len(startup_logs))
    except Exception as ex:
        logger.warning("[Harvester Daemon] Lỗi quét bù ban đầu TCP 4370: %s", ex)

    # 2b. Initial 7-day & Today ADMS Push Mirror Backfill (captures rtlog pushed to WebServerIP=172.16.56.2:4004)
    try:
        logs_7d = epad_client.get_log_last_7_days()
        if logs_7d:
            added_7d = storage.sync_epad_7day_logs(logs_7d)
            logger.info("[Harvester Daemon] Đồng bộ ADMS Push 7 ngày gần nhất: +%d bản ghi mới", added_7d)
    except Exception as ex:
        logger.debug("[Harvester Daemon] ADMS 7-day backfill skipped: %s", ex)

    last_clock_sync = time.time()
    last_7d_sync = time.time()

    # 3. Continuous Hybrid Check Loop (4s interval for ADMS rtlog mirror + TCP 4370 fallback)
    while True:
        try:
            now_ts = time.time()
            if now_ts - last_clock_sync > 3600:
                try:
                    zk_client.sync_all_device_clocks()
                    last_clock_sync = now_ts
                except Exception as ex:
                    logger.debug("[Harvester Daemon] Clock audit cycle warning: %s", ex)

            # Pull latest real-time ADMS Push rtlog events (since 4 terminals have DeviceType=acc -> WebServerIP=172.16.56.2)
            try:
                rt_push_logs = epad_client.get_realtime_attendance_logs(limit=60)
                if rt_push_logs:
                    storage.merge_and_save_scans(rt_push_logs)
            except Exception:
                pass

            # Every 30s, also reconcile today's full bucket from 7-day endpoint so zero scans are ever missed
            if now_ts - last_7d_sync > 30:
                last_7d_sync = now_ts
                try:
                    logs_7d = epad_client.get_log_last_7_days()
                    if logs_7d:
                        storage.sync_epad_7day_logs(logs_7d)
                except Exception:
                    pass

            recent_scans = zk_client.harvest_new_attendance_records(per_device_limit=50)
            if recent_scans:
                storage.merge_and_save_scans(recent_scans)

        except Exception as e:
            logger.debug("[Harvester Daemon] Cycle warning: %s", e)

        time.sleep(4)


_IS_DEV_MODE = os.environ.get("VMS_ENV", "").strip().lower() == "dev"
if not _IS_DEV_MODE and os.environ.get("VMS_DISABLE_HARVESTER", "") != "1":
    threading.Thread(target=_background_scan_collector, daemon=True, name="ZkHardwareHarvester").start()
else:
    logger.info("[Dev Mode] Đã tắt Harvester TCP 4370 để chạy song song an toàn với Server chính.")


def _sharepoint_realtime_reconciler():
    """
    Continuous background reconciler for SharePoint Online (ONESEAZEN):
    1. Waits 6s after server start and performs a full reconciliation across all 18 'VMS SEAZEN - ...' lists
       so Employees (117), Biometrics (117), DailyTimekeeping, AttendanceLogs, DoorAuditLogs, and Visitors are 100% populated.
    2. Every 60 seconds, incrementally reconciles live tables (AttendanceLogs, DailyTimekeeping, Visitors,
       DoorAuditLogs, DeviceCommands, Devices) so nothing can ever fall behind even after offline drops.
    """
    time.sleep(6)
    try:
        import sharepoint_vms_sync
        tok = sharepoint_vms_sync.get_sharepoint_tokens()
        if tok.get("ok"):
            logger.info("[SharePoint Reconciler] Bắt đầu đồng bộ tổng thể 18 danh sách VMS SEAZEN lên ONESEAZEN (%s)...", tok.get("account"))
            sharepoint_vms_sync.sync_all_active_lists(full_attendance_limit=350, timekeeping_limit=400)
            sharepoint_vms_sync.sync_master_employees_from_sharepoint(force=False)
            logger.info("[SharePoint Reconciler] Đã hoàn tất đồng bộ tổng thể 18 danh sách lên SharePoint!")
        else:
            logger.warning("[SharePoint Reconciler] Chưa có MSAL token, sẽ thử lại sau: %s", tok.get("error"))
    except Exception as ex:
        logger.warning("[SharePoint Reconciler] Lỗi đồng bộ ban đầu: %s", ex)

    live_tables = [
        ("tbl_AttendanceLogs", 200),
        ("tbl_DailyTimekeeping", 250),
        ("tbl_Visitors", 100),
        ("tbl_DoorAuditLogs", 100),
        ("tbl_DeviceCommands", 100),
        ("tbl_Devices", 20),
    ]
    while True:
        time.sleep(60)
        try:
            import sharepoint_vms_sync
            tok = sharepoint_vms_sync.get_sharepoint_tokens()
            if not tok.get("ok"):
                continue
            with sharepoint_vms_sync._SP_SYNC_LOCK:
                for tbl, lim in live_tables:
                    try:
                        sharepoint_vms_sync.sync_table_to_sharepoint(tbl, max_rows=lim)
                    except Exception:
                        pass
            try:
                sharepoint_vms_sync.sync_master_employees_from_sharepoint(force=False)
                sharepoint_vms_sync.pull_preregistered_guests_from_sharepoint(storage, min_interval_seconds=30)
            except Exception:
                pass
        except Exception as e:
            logger.debug("[SharePoint Reconciler] Cycle warning: %s", e)


if not _IS_DEV_MODE and os.environ.get("VMS_DISABLE_SP_SYNC", "") != "1":
    threading.Thread(target=_sharepoint_realtime_reconciler, daemon=True, name="SharePointRealtimeReconciler").start()
else:
    logger.info("[Dev Mode] Đã tắt SharePoint Reconciler để tránh ghi đè từ máy chỉnh sửa.")


def _card_expiry_scheduler():
    """
    Runs every 30s in Production:
    - Enrolls SCHEDULED visitor cards when ValidFrom arrives.
    - Keeps cards valid until 23:59:59 of ValidTo calendar day, then revokes on 4 ZKTeco devices
      past 23:59:59 so cards cannot be reused the next day.
    """
    time.sleep(10)
    while True:
        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                db_mssql.process_card_expiry_and_schedule_db(zk_client=zk_client)
        except Exception as e:
            logger.debug("[CardExpiryScheduler] warning: %s", e)
        time.sleep(30)


if not _IS_DEV_MODE and os.environ.get("VMS_DISABLE_HARVESTER", "") != "1":
    threading.Thread(target=_card_expiry_scheduler, daemon=True, name="CardExpiryScheduler").start()


def _is_loopback_request() -> bool:
    """Allows access ONLY from the local Server machine (127.0.0.1 / ::1), never over LAN."""
    if request.headers.get("X-Forwarded-For") or request.headers.get("X-Real-IP"):
        return False
    remote = str(request.remote_addr or "").strip()
    return remote in ("127.0.0.1", "::1", "::ffff:127.0.0.1")


@app.route("/api/server/m365-status", methods=["GET"])
def api_server_m365_status():
    if not _is_loopback_request():
        return jsonify({"success": False, "error": "Chỉ máy Server cục bộ mới được phép truy cập."}), 403
    try:
        import sharepoint_vms_sync
        tok = sharepoint_vms_sync.get_sharepoint_tokens(allow_interactive=False)
        return jsonify({"success": True, **tok})
    except Exception as e:
        return jsonify({"success": False, "ok": False, "error": str(e)}), 500


@app.route("/api/server/m365-auth", methods=["POST"])
def api_server_m365_auth():
    if not _is_loopback_request():
        return jsonify({"success": False, "error": "Chỉ máy Server cục bộ mới được phép đăng nhập Token Microsoft."}), 403
    try:
        import sharepoint_vms_sync
        tok = sharepoint_vms_sync.get_sharepoint_tokens(allow_interactive=True)
        return jsonify({"success": bool(tok.get("ok")), **tok})
    except Exception as e:
        return jsonify({"success": False, "ok": False, "error": str(e)}), 500


# ---------------- Built-in ZKTeco ADMS Push Receiver (/iclock/*) ----------------

@app.route("/iclock/cdata", methods=["GET", "POST"])
def iclock_cdata():
    """
    Native ZKTeco ADMS / Push-AC Receiver (DeviceType=acc).
    When any of the 4 SenseFace 4A terminals has WebServerIP pointed to this server,
    it pushes real-time scan events (table=rtlog / ATTLOG) directly here.
    """
    sn = (request.args.get("SN") or "").strip()
    table = (request.args.get("table") or "").strip().lower()
    if request.method == "GET":
        return (
            f"GET OPTION FROM: {sn}\r\n"
            "Stamp=9999\r\nOpStamp=9999\r\nErrorDelay=30\r\nDelay=2\r\n"
            "Realtime=1\r\nEncrypt=0\r\nServerVer=3.1.2\r\nPushProtVer=2.4.1\r\n",
            200,
            {"Content-Type": "text/plain"}
        )

    raw_body = request.get_data(as_text=True) or ""
    if table in ("rtlog", "attlog", "transaction") and raw_body.strip():
        sn_map = {
            "1313244800040": ("Làn VÀO phải", "IN"),
            "1313244800129": ("Làn VÀO trái", "IN"),
            "1313244800122": ("Làn RA trái", "OUT"),
            "1313244800130": ("Làn RA phải", "OUT"),
        }
        dev_name, direction = sn_map.get(sn, (f"Cổng {sn}", "IN"))
        parsed_records = []
        for line in raw_body.splitlines():
            line = line.strip()
            if not line:
                continue
            kv = {}
            for part in line.split("\t"):
                if "=" in part:
                    k, v = part.split("=", 1)
                    kv[k.strip().lower()] = v.strip()
            pin = kv.get("pin") or ""
            chk_time = kv.get("time") or ""
            card_no = kv.get("cardno") or ""
            vtype = int(kv.get("verifytype") or 15) if str(kv.get("verifytype") or "").isdigit() else 15
            if not pin or pin == "0" or not chk_time:
                continue
            p_info = zk_client._lookup_person(pin)
            is_staff = p_info.get("is_staff", True)
            mode_str = "Card" if (card_no and card_no != "0") or vtype in (1, 2, 3, 4) else "FaceTemplate"
            parsed_records.append({
                "EmployeeATID": p_info.get("atid") or pin,
                "FullName": p_info.get("fullname", f"Nhân sự {pin}"),
                "Department": p_info.get("department", "Nhân sự SeaZen"),
                "SerialNumber": sn,
                "DeviceSerialNumber": sn,
                "DeviceName": dev_name,
                "Direction": direction,
                "CheckTime": chk_time,
                "Time": chk_time,
                "CardNumber": card_no if card_no != "0" else "",
                "VerifyMode": mode_str,
                "VerifyModeValue": vtype,
                "is_staff": is_staff,
                "SyncSource": "ADMS_DIRECT_PUSH"
            })
        if parsed_records:
            storage.merge_and_save_scans(parsed_records)
    return ("OK", 200, {"Content-Type": "text/plain"})


@app.route("/iclock/getrequest", methods=["GET", "POST"])
@app.route("/iclock/devicecmd", methods=["GET", "POST"])
@app.route("/iclock/registry", methods=["GET", "POST"])
def iclock_commands():
    return ("OK", 200, {"Content-Type": "text/plain"})


# ---------------- Frontend Route (React 18 + Vite SPA) ----------------


@app.route("/")
def index():
    return send_from_directory(REACT_DIST_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    if os.path.isfile(os.path.join(REACT_DIST_DIR, path)):
        return send_from_directory(REACT_DIST_DIR, path)
    return send_from_directory(REACT_DIST_DIR, "index.html")


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

    # Build fast lookup from active + recent visitors so 562xx hardware slots always show real Guest Name & RFID Card
    visitor_by_slot = {}
    try:
        all_vis = (storage.get_active_visitors() or []) + (storage.get_visitor_history(limit=300) or [])
        for v in all_vis:
            v_name = str(v.get("full_name") or "").strip()
            if not v_name or v_name.lower().startswith("khach ") or v_name.lower() in ("chưa rõ", "chua ro", "---", "unknown"):
                continue
            v_id = str(v.get("id") or "").strip().lstrip("0")
            v_epad = str(v.get("epad_atid") or "").strip().lstrip("0")
            v_card = str(v.get("card_number") or "").strip().lstrip("0")
            for k in (v_epad, v_id, v_card):
                if k and k not in visitor_by_slot:
                    visitor_by_slot[k] = v
    except Exception:
        pass

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
        raw_atid = str(item.get("EmployeeATID") or "").strip()
        norm_atid = raw_atid.lstrip("0") or raw_atid
        raw_name = str(item.get("FullName") or "").strip()
        if (not is_staff) and (not raw_name or raw_name.lower().startswith("khach ") or raw_name.lower() in ("chưa rõ", "chua ro", "---", "unknown")):
            matched_v = visitor_by_slot.get(norm_atid) or visitor_by_slot.get(raw_atid)
            if matched_v:
                if matched_v.get("full_name"):
                    item["FullName"] = matched_v["full_name"]
                if matched_v.get("card_number") and not item.get("CardNumber"):
                    item["CardNumber"] = matched_v["card_number"]
                if matched_v.get("department") and str(item.get("Department") or "").strip() in ("", "--", "Chỉ Huy Đội"):
                    item["Department"] = matched_v["department"]

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
@require_role(["admin", "staff", "guest_inviter"])
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


@app.route("/api/visitors/frequent", methods=["GET"])
@app.route("/api/visitor/frequent", methods=["GET"])
@require_role(["admin", "staff", "guest_inviter"])
def get_frequent_visitors_endpoint():
    """
    Returns deduplicated directory of returning/frequent visitors (by CCCD or FullName)
    for instant subtle autocomplete on FullName and CCCD inputs.
    """
    import re
    freq_path = os.path.join(BASE_DIR, "data", "frequent_visitors.json")
    profiles: Dict[str, Dict[str, Any]] = {}

    def _clean(val: Any) -> str:
        s = str(val or "").strip()
        return "" if s in ("0", "--", "---", "None", "null", "NoDepartment") else s

    def _norm_dob(raw: Any) -> str:
        s = str(raw or "").strip()
        if not s or s.startswith("0001") or s == "1995-01-01":
            return ""
        if "T" in s:
            s = s.split("T")[0]
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
        if m:
            return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"
        digits = re.sub(r"\D", "", s)
        if len(digits) == 8:
            return f"{digits[:2]}/{digits[2:4]}/{digits[4:]}"
        if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
            return s
        return ""

    if os.path.exists(freq_path):
        try:
            with open(freq_path, "r", encoding="utf-8") as f:
                seed_items = json.load(f) or []
            for it in seed_items:
                k = (_clean(it.get("cccd_number")).upper() or _clean(it.get("full_name")).lower())
                if k:
                    profiles[k] = dict(it)
        except Exception:
            pass

    recent_list = storage.get_visitor_history(limit=300) + storage.get_active_visitors()
    for v in recent_list:
        fn = _clean(v.get("full_name") or v.get("FullName"))
        cccd = _clean(v.get("cccd_number") or v.get("CCCDNumber"))
        if not fn and not cccd:
            continue
        if fn.startswith("NV 000") or fn.startswith("Khách thẻ"):
            continue
        k = cccd.upper() if cccd else fn.lower()
        dob = _norm_dob(v.get("birth_date") or v.get("BirthDate"))
        ph = _clean(v.get("phone") or v.get("Phone"))
        comp = _clean(v.get("company") or v.get("Company"))
        dept = _clean(v.get("department") or v.get("Department") or v.get("HostDepartment"))
        host = _clean(v.get("host_person") or v.get("HostPerson"))
        if "(" in host:
            host = host.split("(")[0].strip()
        h_ph = _clean(v.get("host_phone"))
        ts = str(v.get("checkin_time") or v.get("CheckinTime") or "")[:19]

        cur = profiles.get(k)
        if not cur:
            profiles[k] = {
                "full_name": fn,
                "cccd_number": cccd,
                "birth_date": dob,
                "phone": ph,
                "company": comp,
                "department": dept,
                "host_person": host,
                "host_phone": h_ph,
                "visit_count": 1,
                "last_visit": ts,
            }
        else:
            if fn and len(fn) >= len(cur.get("full_name") or ""):
                cur["full_name"] = fn
            if cccd and not cur.get("cccd_number"):
                cur["cccd_number"] = cccd
            if dob:
                cur["birth_date"] = dob
            if ph:
                cur["phone"] = ph
            if comp and comp.lower() != "khach":
                cur["company"] = comp
            if dept:
                cur["department"] = dept
            if host:
                cur["host_person"] = host
            if h_ph:
                cur["host_phone"] = h_ph
            if ts and ts > str(cur.get("last_visit") or ""):
                cur["last_visit"] = ts

    out = sorted(
        profiles.values(),
        key=lambda x: (int(x.get("visit_count") or 1), str(x.get("last_visit") or "")),
        reverse=True,
    )
    return jsonify({"success": True, "count": len(out), "visitors": out})


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

    req_checks = [
        (full_name, "Họ tên khách"),
        (str(data.get("birth_date", "")).strip(), "Ngày tháng năm sinh"),
        (cccd_num, "CMND/CCCD/Passport"),
        (str(data.get("purpose", "")).strip(), "Nội dung làm việc"),
        (str(data.get("company", "")).strip(), "Tên công ty"),
        (str(data.get("access_area", "")).strip(), "Khu vực được phép truy cập"),
        (str(data.get("department", "")).strip(), "Phòng ban liên hệ"),
        (str(data.get("host_person", "")).strip(), "Người liên hệ"),
        (str(data.get("host_phone", "")).strip(), "Số điện thoại người liên hệ"),
        (card_number, "Mã thẻ"),
    ]
    missing_labels = [lbl for val, lbl in req_checks if not val]
    if missing_labels:
        return jsonify({
            "success": False,
            "error": f"Vui lòng nhập đầy đủ các trường bắt buộc: {', '.join(missing_labels)}.",
        }), 400

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

    # 0b. Pre-validate companion cards against active holders and main visitor card
    companions_in = data.get("companions") or []
    seen_batch_cards = {card_number.lstrip("0") or "0"} if card_number else set()
    if isinstance(companions_in, list):
        for comp in companions_in:
            comp_name = str(comp.get("full_name") or "").strip() or "Nhân sự đi cùng"
            comp_card = str(comp.get("card_number") or "").strip()
            if not comp_card:
                continue
            comp_clean = comp_card.lstrip("0") or "0"
            if comp_clean in seen_batch_cards:
                return jsonify({
                    "success": False,
                    "error": f"Thẻ {comp_card} của người đi cùng ({comp_name}) bị trùng ngay trong cùng phiếu đăng ký!",
                    "conflict_card": comp_card
                }), 400
            seen_batch_cards.add(comp_clean)
            for item in active_now:
                item_card = str(item.get("card_number", "")).strip()
                item_clean = item_card.lstrip("0") or "0"
                if item_card and (item_card == comp_card or item_clean == comp_clean):
                    return jsonify({
                        "success": False,
                        "error": f"Thẻ {comp_card} gán cho {comp_name} đang được giữ bởi khách: {item.get('full_name')}!",
                        "conflict_card": comp_card,
                        "conflict_visitor": item
                    }), 400

    # 0c. Block cards explicitly marked LOST / LOCKED in Admin Card Inventory
    try:
        import db_mssql
        if db_mssql.is_mssql_active():
            cards_to_check = ([card_number] if card_number else []) + [
                str(c.get("card_number") or "").strip()
                for c in (companions_in if isinstance(companions_in, list) else [])
                if str(c.get("card_number") or "").strip()
            ]
            for chk_card in cards_to_check:
                blk = db_mssql.check_card_not_blocked_db(chk_card)
                if blk.get("blocked"):
                    return jsonify({
                        "success": False,
                        "error": blk.get("error"),
                        "blocked_card": chk_card,
                    }), 400
    except Exception:
        pass

    # 1. Register customer & sync permissions to door devices (TCP 4370 parallel across 4 devices)
    # SharePoint sync runs strictly asynchronously via storage.add_visitor() & push_table_async() so check-in never stalls.
    def _combine_dt_str(d_part, t_part, fallback_str=""):
        s_t = str(t_part or "").strip()
        if len(s_t) >= 16 and "-" in s_t[:10]:
            return s_t.replace("T", " ")[:19]
        s_d = str(d_part or "").strip()
        if s_d and s_t:
            return f"{s_d} {s_t}"[:19]
        return str(fallback_str or "").replace("T", " ")[:19]

    valid_from_str = _combine_dt_str(data.get("from_date"), data.get("from_time"), data.get("checkin_time"))
    valid_to_str = _combine_dt_str(data.get("to_date"), data.get("expected_checkout_time"), data.get("expected_checkout_time"))
    is_future_scheduled = False
    if valid_from_str:
        try:
            vf_parsed = datetime.strptime(valid_from_str[:16], "%Y-%m-%d %H:%M")
            if (vf_parsed - datetime.now()).total_seconds() > 60:
                is_future_scheduled = True
        except Exception:
            pass

    epad_sync_info = "Đã lưu hồ sơ (không cấp thẻ)"
    epad_sync_ok = True
    if card_number and is_future_scheduled:
        epad_sync_info = f"ĐÃ ĐẶT LỊCH HẸN ({valid_from_str}) — Sẽ tự động nạp thẻ vào 4 máy cửa khi đến giờ"
    elif card_number:
        direct_res = zk_client.enroll_visitor_card(data)
        if direct_res.get("success"):
            epad_sync_ok = True
            epad_atid = direct_res.get("employee_atid")
            epad_sync_info = f"ĐÃ NẠP THẺ VÀO 4 MÁY CỬA TRỰC TIẾP (Khe: {epad_atid}, Phân quyền Làn Vào/Ra: 2,1)"
            data["epad_atid"] = epad_atid
        else:
            epad_sync_ok = False
            epad_sync_info = f"Lỗi nạp thẻ phần cứng TCP 4370: {direct_res.get('error')}"
            logger.warning("Nạp thẻ phần cứng lỗi: %s", direct_res.get("error"))

        # 2b. Only call ePAD if EPAD_ENABLED is explicitly True in config.json
        if EPAD_ENABLED:
            try:
                epad_res = epad_client.register_customer_epad(data, auto_sync=True)
                if epad_res.get("success"):
                    epad_sync_ok = True
                    adms_atid = epad_res.get("employee_atid")
                    epad_sync_info = f"ĐÃ ĐỒNG BỘ KÉP (TCP 4370 + ADMS Push DoorIndexes 2,1 · ATID: {adms_atid or epad_atid})"
            except Exception as ex:
                logger.debug("ADMS dual-provisioning fallback: %s", ex)

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

    # 4. Process accompanying visitors (Thông tin nhân sự đi cùng) linked via parent_visitor_id
    companions = data.get("companions") or []
    companion_records = []
    if isinstance(companions, list):
        for comp in companions:
            c_name = str(comp.get("full_name") or "").strip()
            c_cccd = str(comp.get("cccd_number") or "").strip()
            c_card = str(comp.get("card_number") or "").strip()
            if not c_name and not c_cccd:
                continue
            comp_payload = {
                "full_name": c_name,
                "cccd_number": c_cccd,
                "birth_date": comp.get("birth_date") or "",
                "card_number": (c_card.lstrip("0") or "0") if c_card.isdigit() else c_card,
                "company": data.get("company") or "",
                "department": data.get("department") or "",
                "host_person": data.get("host_person") or "",
                "host_phone": data.get("host_phone") or "",
                "purpose": f"Đi cùng đoàn: {full_name}" + (f" - {data.get('purpose')}" if data.get("purpose") else ""),
                "operator": data.get("operator") or "Lễ tân",
                "from_date": data.get("from_date"),
                "from_time": comp.get("from_time") or data.get("from_time"),
                "to_date": data.get("to_date"),
                "expected_checkout_time": comp.get("to_time") or data.get("expected_checkout_time"),
                "parent_visitor_id": record.get("id"),
                "parent_visitor_name": full_name or cccd_num,
            }
            if comp_payload.get("card_number") and not is_future_scheduled:
                c_hw = zk_client.enroll_visitor_card(comp_payload)
                if c_hw.get("success"):
                    comp_payload["epad_atid"] = c_hw.get("employee_atid")
            try:
                c_rec = storage.add_visitor(comp_payload)
                companion_records.append(c_rec)
            except Exception as ce:
                logger.warning("Companion registration warning: %s", ce)

    # 4b. Progressive Card Onboarding (Cách 1): auto-register unseen RFID cards into tbl_CustomerCards + SharePoint
    new_cards_detected = []
    pending_photo_cards = []
    cards_touched = False
    try:
        import db_mssql
        if db_mssql.is_mssql_active():
            card_assign_jobs = []
            if card_number:
                card_assign_jobs.append((
                    card_number,
                    full_name or cccd_num,
                    cccd_num,
                    data.get("phone") or "",
                    data.get("company") or "",
                    data.get("host_person") or "",
                    data.get("host_phone") or "",
                    valid_from_str or record.get("checkin_time"),
                    valid_to_str or record.get("expected_checkout_time"),
                    "SCHEDULED" if is_future_scheduled else "ACTIVE_ON_DEVICE",
                ))
            for cr in companion_records:
                if cr.get("card_number"):
                    card_assign_jobs.append((
                        cr["card_number"],
                        cr.get("full_name") or full_name,
                        cr.get("cccd_number") or "",
                        cr.get("phone") or data.get("phone") or "",
                        cr.get("company") or data.get("company") or "",
                        data.get("host_person") or "",
                        data.get("host_phone") or "",
                        valid_from_str or cr.get("checkin_time"),
                        cr.get("expected_checkout_time") or valid_to_str,
                        "SCHEDULED" if is_future_scheduled else "ACTIVE_ON_DEVICE",
                    ))
            op_name = data.get("operator") or "Lễ tân"
            for c_num, c_holder, c_cccd, c_phone, c_comp, c_host, c_hphone, c_vf, c_vt, c_sync_st in card_assign_jobs:
                res_card = db_mssql.sync_card_assignment_on_checkin(
                    c_num, c_holder, c_cccd, op_name,
                    holder_phone=c_phone,
                    holder_company=c_comp,
                    contact_person=c_host,
                    contact_phone=c_hphone,
                    valid_from=c_vf,
                    valid_to=c_vt,
                    device_sync_state=c_sync_st,
                )
                cards_touched = True
                if res_card.get("is_new"):
                    new_cards_detected.append(res_card.get("card_number") or c_num)
                if res_card.get("needs_photo"):
                    pending_photo_cards.append(res_card.get("card_number") or c_num)
            if cards_touched:
                import sharepoint_vms_sync
                sharepoint_vms_sync.push_table_async("tbl_CustomerCards", 200)
    except Exception as card_ex:
        logger.debug("Progressive card onboarding warning: %s", card_ex)

    # 5. Optional auto unlock (default False)
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

    extra_comp_msg = f" (kèm {len(companion_records)} nhân sự đi cùng)" if companion_records else ""
    new_card_msg = (
        f" Hệ thống đã tự động thêm thẻ mới ({', '.join(new_cards_detected)}) vào Kho thẻ Admin ở trạng thái chờ ảnh bằng chứng."
        if new_cards_detected
        else ""
    )
    resp_msg = (
        f"Đã đăng ký thành công cho khách {full_name or cccd_num}{extra_comp_msg}. Đã lưu hệ thống & đồng bộ thiết bị cửa.{new_card_msg}"
        if epad_sync_ok or not card_number
        else f"Đã lưu hồ sơ cho khách {full_name or cccd_num}{extra_comp_msg} nhưng {epad_sync_info}.{new_card_msg}"
    )

    return jsonify({
        "success": True,
        "visitor": record,
        "companions": companion_records,
        "new_cards_detected": new_cards_detected,
        "pending_photo_cards": pending_photo_cards,
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

    # If visitor was holding an RFID card, release in SQL immediately and revoke on 4 terminals in background
    target_card = record.get("card_number")
    epad_return_msg = "Không dùng thẻ"
    if target_card:
        try:
            import db_mssql, sharepoint_vms_sync
            if db_mssql.release_card_on_checkout(target_card):
                sharepoint_vms_sync.push_table_async("tbl_CustomerCards", 200)
        except Exception:
            pass

        def _bg_revoke_card(c_num: str) -> None:
            try:
                zk_client.return_or_delete_card(c_num)
                if EPAD_ENABLED:
                    epad_client.return_or_delete_card(c_num)
            except Exception as ex:
                logger.debug("Background hardware revoke warning: %s", ex)

        threading.Thread(target=_bg_revoke_card, args=(target_card,), daemon=True).start()
        epad_return_msg = f"Đã giải phóng thẻ {target_card} trong SQL & đang thu hồi ngầm trên 4 máy cửa"

    # Async update SharePoint List 'VMS SEAZEN - KHÁCH RA VÀO' to CHECKED_OUT
    try:
        import sharepoint_vms_sync
        sharepoint_vms_sync.checkout_visitor_on_sharepoint_async(record)
    except Exception:
        pass

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


@app.route("/api/visitor/checkout_group", methods=["POST"])
@require_role(["admin", "staff"])
def checkout_visitor_group():
    """
    Checks out a primary visitor together with all active companions linked via parent_visitor_id.
    Releases every assigned RFID card across all 4 ZKTeco terminals.
    """
    data = request.get_json(silent=True) or {}
    q = str(data.get("query") or data.get("id") or "").strip()
    if not q:
        return jsonify({"success": False, "error": "Thiếu mã định danh khách trưởng đoàn."}), 400

    records = storage.checkout_visitor_group(q)
    if not records:
        return jsonify({"success": False, "error": f"Không tìm thấy khách đang hoạt động '{q}'"}), 404

    for rec in records:
        target_card = rec.get("card_number")
        if target_card:
            try:
                zk_client.return_or_delete_card(str(target_card))
            except Exception:
                pass
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.checkout_visitor_on_sharepoint_async(rec)
        except Exception:
            pass

    lead_name = records[0].get("full_name") or "Khách"
    return jsonify({
        "success": True,
        "count": len(records),
        "visitors": records,
        "message": f"Đã trả thẻ & Check-out toàn bộ đoàn {lead_name} ({len(records)} người)."
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
@require_role(["admin", "staff", "guest_inviter"])
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
@require_role(["admin", "staff", "guest_inviter"])
def get_employees():
    """
    Returns employees list with search, department filter, and pagination.
    Query params: ?department=...&q=...&page=1&limit=25
    """
    dept = request.args.get("department")
    q = (request.args.get("q") or "").strip().lower()
    page = max(1, int(request.args.get("page", 1)))
    limit = min(500, max(10, int(request.args.get("limit", 25))))
    include_inactive = str(request.args.get("include_inactive") or "").strip() in ("1", "true", "yes")

    all_emps = storage.get_employees(department=dept, include_inactive=include_inactive)
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


@app.route("/api/staff/onsite-reconcile", methods=["GET"])
@require_role(["admin"])
def get_onsite_staff_reconcile():
    """
    Returns cached reconciliation between local department employees (tbl_Employees),
    today's attendance (present/left/absent), and SharePoint Master_NhanVien.
    Does NOT spam SharePoint: reads local cache unless ?refresh=1 or cache missing.
    """
    target_date = (request.args.get("date") or "").strip() or None
    force_refresh = str(request.args.get("refresh") or "").strip() in ("1", "true", "yes")
    try:
        import sharepoint_vms_sync
        result = sharepoint_vms_sync.reconcile_onsite_staff(
            storage, target_date=target_date, force_refresh=force_refresh
        )
        return jsonify(result)
    except Exception as e:
        logger.error("Error in /api/staff/onsite-reconcile: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


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
    visitors = storage.get_active_visitors()
    now_dt = datetime.now()
    card_name_map = {}
    try:
        import db_mssql
        if db_mssql.is_mssql_active():
            cards_res = db_mssql.get_customer_cards_db(limit=500, include_photos=False)
            for cr in cards_res.get("rows", []):
                cnum = str(cr.get("CardNumber") or "").strip()
                cname = str(cr.get("CardName") or "").strip()
                if cnum and cname:
                    card_name_map[cnum] = cname
                    card_name_map[cnum.lstrip("0") or "0"] = cname
    except Exception:
        pass

    for v in visitors:
        v["expiry_alert_type"] = None
        v["expiry_alert_message"] = ""
        exp_raw = str(v.get("expected_checkout_time") or "").strip()
        if not exp_raw:
            continue
        exp_dt = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                exp_dt = datetime.strptime(exp_raw.replace("T", " ")[:len(fmt) + 2], fmt)
                break
            except Exception:
                continue
        if not exp_dt or now_dt < exp_dt:
            continue

        cnum = str(v.get("card_number") or "").strip()
        card_label = card_name_map.get(cnum) or card_name_map.get(cnum.lstrip("0") or "0") or cnum or "không gắn thẻ"
        v["card_display_name"] = card_label
        fname = str(v.get("full_name") or "Khách").strip()
        out_count = int(v.get("gate_out_count") or 0)
        last_out = str(v.get("gate_last_out_time") or v.get("last_gate_out_time") or v.get("gate_out_time") or "").strip()
        if out_count > 0 or last_out:
            out_hhmm = last_out[11:16] if len(last_out) >= 16 else (last_out[:5] or "đã quẹt cổng RA")
            v["expiry_alert_type"] = "EXITED_UNRETURNED"
            v["expiry_alert_message"] = (
                f"Thẻ {card_label} khách {fname} đã ra về lúc {out_hhmm} nhưng chưa check-out, "
                "kiểm tra lý do hoặc check-out. Lưu ý: Nếu kho không có thẻ đó nghĩa là có thể khách đã cầm về."
            )
        else:
            exp_hhmm = exp_dt.strftime("%H:%M")
            v["expiry_alert_type"] = "STILL_INSIDE_OVERDUE"
            v["expiry_alert_message"] = (
                f"Khách {fname} (Thẻ {card_label}) đã đến hạn {exp_hhmm} nhưng chưa check-out "
                "và chưa quẹt Làn RA — có thể vẫn đang ở trong công ty."
            )
    return jsonify({"visitors": visitors})


@app.route("/api/visitor/card/<card_key>/history", methods=["GET"])
@require_role(["admin", "staff"])
def api_visitor_card_history(card_key):
    try:
        import db_mssql
        rows = db_mssql.get_card_history_db(card_key, limit=40)
        return jsonify({"success": True, "rows": rows})
    except Exception as e:
        return jsonify({"success": False, "rows": [], "error": str(e)}), 500


@app.route("/api/visitor/appointments", methods=["GET"])
@require_role(["admin", "staff", "guest_inviter"])
def get_visitor_appointments():
    force = str(request.args.get("refresh") or "").strip() in ("1", "true", "yes")
    try:
        import sharepoint_vms_sync
        sharepoint_vms_sync.pull_preregistered_guests_from_sharepoint(
            storage, min_interval_seconds=15, force=force
        )
    except Exception:
        pass
    return jsonify({"success": True, "appointments": storage.get_pending_visitors()})


@app.route("/api/visitor/appointment", methods=["POST"])
@require_role(["admin", "staff", "guest_inviter"])
def create_visitor_appointment():
    """
    Pre-registers an invited guest WITHOUT a physical RFID card (Status = PENDING).
    Visible in both 'Khách mời & Lịch hẹn' and 'Đăng ký Khách' for 1-swipe card assignment upon arrival.
    """
    data = request.get_json() or {}
    full_name = str(data.get("full_name", "")).strip()
    cccd_num = str(data.get("cccd_number", "")).strip() or str(data.get("id_number", "")).strip()
    req_checks = [
        (full_name, "Họ tên khách"),
        (str(data.get("birth_date", "")).strip(), "Ngày tháng năm sinh"),
        (cccd_num, "CMND/CCCD/Passport"),
        (str(data.get("purpose", "")).strip(), "Nội dung làm việc"),
        (str(data.get("company", "")).strip(), "Tên công ty"),
        (str(data.get("access_area", "")).strip(), "Khu vực được phép truy cập"),
        (str(data.get("department", "")).strip(), "Phòng ban liên hệ"),
        (str(data.get("host_person", "")).strip(), "Người liên hệ"),
        (str(data.get("host_phone", "")).strip(), "Số điện thoại người liên hệ"),
    ]
    missing_labels = [lbl for val, lbl in req_checks if not val]
    if missing_labels:
        return jsonify({
            "success": False,
            "error": f"Vui lòng nhập đầy đủ các trường bắt buộc: {', '.join(missing_labels)}.",
        }), 400

    def _combine_dt(d_part, t_part, fallback=""):
        s_t = str(t_part or "").strip()
        if len(s_t) >= 16 and "-" in s_t[:10]:
            return s_t.replace("T", " ")[:19]
        s_d = str(d_part or "").strip()
        if s_d and s_t:
            return f"{s_d} {s_t}"[:19]
        return str(fallback or "").replace("T", " ")[:19]

    u = get_current_user()
    op_name = data.get("operator") or (u["full_name"] if u else "Phòng ban")
    from_str = _combine_dt(data.get("from_date"), data.get("from_time"), datetime.now().strftime("%Y-%m-%d %H:%M:00"))
    to_str = _combine_dt(data.get("to_date"), data.get("expected_checkout_time") or data.get("to_time"))

    import uuid
    main_id = f"apt_{uuid.uuid4().hex[:8]}"
    main_rec = storage.add_pending_visitor({
        "id": main_id,
        "full_name": full_name,
        "cccd_number": cccd_num,
        "birth_date": data.get("birth_date") or "",
        "phone": data.get("phone") or "",
        "card_number": "",
        "company": data.get("company") or "",
        "department": data.get("department") or "",
        "host_person": data.get("host_person") or "",
        "host_phone": data.get("host_phone") or "",
        "purpose": data.get("purpose") or "",
        "access_area": data.get("access_area") or "Sảnh Chính (Cổng Làn Vào & Làn Ra)",
        "notes": data.get("notes") or "",
        "checkin_time": from_str if len(from_str) == 19 else f"{from_str}:00" if len(from_str) == 16 else datetime.now().strftime("%Y-%m-%d %H:%M:00"),
        "expected_checkout_time": to_str if len(to_str) == 19 else (f"{to_str}:00" if len(to_str) == 16 else ""),
        "operator": op_name,
        "status": "PENDING",
    })

    comp_recs = []
    companions = data.get("companions") or []
    if isinstance(companions, list):
        for comp in companions:
            c_name = str(comp.get("full_name") or "").strip()
            c_cccd = str(comp.get("cccd_number") or "").strip()
            if not c_name and not c_cccd:
                continue
            c_rec = storage.add_pending_visitor({
                "id": f"apt_{uuid.uuid4().hex[:8]}",
                "full_name": c_name or c_cccd,
                "cccd_number": c_cccd,
                "birth_date": comp.get("birth_date") or "",
                "card_number": "",
                "company": data.get("company") or "",
                "department": data.get("department") or "",
                "host_person": data.get("host_person") or "",
                "host_phone": data.get("host_phone") or "",
                "purpose": f"Đi cùng đoàn: {full_name} - {data.get('purpose') or ''}",
                "checkin_time": comp.get("from_time") or main_rec["checkin_time"],
                "expected_checkout_time": comp.get("to_time") or main_rec["expected_checkout_time"],
                "parent_visitor_id": main_id,
                "parent_visitor_name": full_name,
                "operator": op_name,
                "status": "PENDING",
            })
            comp_recs.append(c_rec)

    try:
        import db_mssql
        if db_mssql.is_mssql_active():
            for rec in [main_rec] + comp_recs:
                ci_str = str(rec.get("checkin_time") or "")
                co_str = str(rec.get("expected_checkout_time") or "")
                db_mssql.upsert_pre_registered_guest_db({
                    "BookingCode": rec["id"],
                    "GuestFullName": rec.get("full_name") or "",
                    "GuestCCCD": rec.get("cccd_number") or "",
                    "GuestPhone": rec.get("phone") or "",
                    "GuestCompany": rec.get("company") or "",
                    "HostEmployeeName": rec.get("host_person") or "",
                    "HostDepartment": rec.get("department") or "",
                    "VisitDate": ci_str[:10] if len(ci_str) >= 10 else datetime.now().strftime("%Y-%m-%d"),
                    "StartTime": ci_str[11:16] if len(ci_str) >= 16 else "08:30",
                    "EndTime": co_str[11:16] if len(co_str) >= 16 else "17:30",
                    "Purpose": rec.get("purpose") or "",
                    "ReservedCardNumber": "",
                    "Status": "PENDING",
                })
        import sharepoint_vms_sync
        sharepoint_vms_sync.push_table_async("tbl_Visitors", 150)
        sharepoint_vms_sync.push_table_async("tbl_PreRegisteredGuests", 200)
    except Exception:
        pass

    return jsonify({
        "success": True,
        "appointment": main_rec,
        "companions": comp_recs,
        "message": f"Đã lưu lịch hẹn cho {full_name}" + (f" (+{len(comp_recs)} người đi cùng)" if comp_recs else "") + ". Khi khách đến, Lễ tân chỉ cần quẹt thẻ để cấp ngay!",
    })


@app.route("/api/visitor/appointment/<visitor_id>", methods=["DELETE"])
@require_role(["admin", "staff", "guest_inviter"])
def cancel_visitor_appointment(visitor_id):
    ok = storage.delete_pending_visitor(visitor_id)
    if not ok:
        return jsonify({"success": False, "error": "Không tìm thấy lịch hẹn ở trạng thái chờ."}), 404
    try:
        import db_mssql, sharepoint_vms_sync
        if db_mssql.is_mssql_active():
            import pyodbc
            with pyodbc.connect(db_mssql.get_connection_string(), timeout=4) as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE tbl_PreRegisteredGuests SET Status = 'CANCELLED', UpdatedAt = GETDATE() WHERE BookingCode = ?",
                    (str(visitor_id)[:50],),
                )
                conn.commit()
        sharepoint_vms_sync.push_table_async("tbl_PreRegisteredGuests", 200)
    except Exception:
        pass
    return jsonify({"success": True, "message": "Đã hủy lịch hẹn khách."})


@app.route("/api/visitor/assign_card", methods=["POST"])
@require_role(["admin", "staff"])
def assign_card_to_pending_visitor():
    """Assigns a physical RFID card to a PENDING appointment, enrolls on 4 ZKTeco devices, and activates visitor."""
    data = request.get_json() or {}
    visitor_id = str(data.get("visitor_id") or "").strip()
    card_number = str(data.get("card_number") or "").strip()
    if card_number.isdigit():
        card_number = card_number.lstrip("0") or "0"
    if not visitor_id or not card_number:
        return jsonify({"success": False, "error": "Vui lòng chọn khách và quẹt Mã thẻ RFID."}), 400

    # Check active card conflicts
    norm_c = card_number.lstrip("0") or "0"
    for av in storage.get_active_visitors():
        av_c = str(av.get("card_number") or "").strip()
        if av_c and (av_c == card_number or (av_c.isdigit() and av_c.lstrip("0") == norm_c)):
            return jsonify({
                "success": False,
                "error": f"Thẻ {card_number} đang được giữ bởi {av.get('full_name')}. Vui lòng thu hồi hoặc đổi thẻ khác.",
            }), 400

    import db_mssql
    if db_mssql.is_mssql_active():
        blk = db_mssql.check_card_not_blocked_db(card_number)
        if blk.get("blocked"):
            return jsonify({"success": False, "error": blk.get("error")}), 400

    pending_list = storage.get_pending_visitors()
    target = next((p for p in pending_list if str(p.get("id") or "") == visitor_id), None)
    if not target:
        return jsonify({"success": False, "error": "Không tìm thấy hồ sơ khách đang chờ cấp thẻ."}), 404

    u = get_current_user()
    op_name = (u["full_name"] if u else None) or "Lễ tân"

    # Enroll on 4 ZKTeco devices (unless scheduled for a future date/time > 60s away)
    is_future = False
    vf_str = str(target.get("checkin_time") or "").strip()
    if vf_str:
        try:
            vf_dt = datetime.strptime(vf_str[:16], "%Y-%m-%d %H:%M")
            if (vf_dt - datetime.now()).total_seconds() > 60:
                is_future = True
        except Exception:
            pass

    epad_atid = visitor_id
    if not is_future:
        hw_payload = dict(target)
        hw_payload["card_number"] = card_number
        hw_res = zk_client.enroll_visitor_card(hw_payload)
        if hw_res.get("success") and hw_res.get("employee_atid"):
            epad_atid = str(hw_res["employee_atid"])

    activated = storage.activate_pending_visitor(visitor_id, epad_atid, card_number, operator=op_name)
    if not activated:
        return jsonify({"success": False, "error": "Không thể kích hoạt hồ sơ khách."}), 500

    if db_mssql.is_mssql_active():
        db_mssql.sync_card_assignment_on_checkin(
            card_number,
            activated.get("full_name") or "Khách",
            activated.get("cccd_number") or "",
            op_name,
            holder_phone=activated.get("phone") or "",
            holder_company=activated.get("company") or "",
            contact_person=activated.get("host_person") or "",
            contact_phone=activated.get("host_phone") or "",
            valid_from=activated.get("checkin_time"),
            valid_to=activated.get("expected_checkout_time"),
            device_sync_state="SCHEDULED" if is_future else "ACTIVE_ON_DEVICE",
        )
        try:
            import pyodbc
            with pyodbc.connect(db_mssql.get_connection_string(), timeout=4) as conn:
                cur = conn.cursor()
                cur.execute(
                    "UPDATE tbl_PreRegisteredGuests SET Status = 'CHECKED_IN', ReservedCardNumber = ?, UpdatedAt = GETDATE() WHERE BookingCode = ?",
                    (str(card_number)[:50], str(visitor_id)[:50]),
                )
                conn.commit()
        except Exception:
            pass
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_CustomerCards", 200)
            sharepoint_vms_sync.push_table_async("tbl_Visitors", 150)
            sharepoint_vms_sync.push_table_async("tbl_PreRegisteredGuests", 200)
        except Exception:
            pass

    return jsonify({
        "success": True,
        "visitor": activated,
        "message": f"Đã cấp thẻ {card_number} và kích hoạt cửa cho {activated.get('full_name')}.",
    })


@app.route("/api/visitor/swap_card", methods=["POST"])
@require_role(["admin", "staff"])
def swap_visitor_card_endpoint():
    """
    Swaps an ACTIVE visitor's physical card on the fly:
    - Revokes old card on 4 ZKTeco devices and releases old card in tbl_CustomerCards (preserving LastHolder*).
    - Enrolls new card on 4 ZKTeco devices and updates visitor & card inventory seamlessly.
    """
    data = request.get_json() or {}
    visitor_id = str(data.get("visitor_id") or "").strip()
    old_card = str(data.get("old_card_number") or "").strip()
    new_card = str(data.get("new_card_number") or "").strip()
    if old_card.isdigit():
        old_card = old_card.lstrip("0") or "0"
    if new_card.isdigit():
        new_card = new_card.lstrip("0") or "0"

    if not visitor_id or not new_card:
        return jsonify({"success": False, "error": "Vui lòng quẹt Mã thẻ mới để đổi."}), 400
    if old_card and old_card == new_card:
        return jsonify({"success": False, "error": "Mã thẻ mới đang trùng với thẻ hiện tại."}), 400

    norm_new = new_card.lstrip("0") or "0"
    for av in storage.get_active_visitors():
        av_c = str(av.get("card_number") or "").strip()
        if av_c and (av_c == new_card or (av_c.isdigit() and av_c.lstrip("0") == norm_new)):
            return jsonify({
                "success": False,
                "error": f"Thẻ {new_card} đang được giữ bởi {av.get('full_name')}.",
            }), 400

    import db_mssql
    if db_mssql.is_mssql_active():
        blk = db_mssql.check_card_not_blocked_db(new_card)
        if blk.get("blocked"):
            return jsonify({"success": False, "error": blk.get("error")}), 400

    target = next((v for v in storage.get_active_visitors() if str(v.get("id") or "") == visitor_id), None)
    if not target:
        return jsonify({"success": False, "error": "Không tìm thấy khách đang hoạt động để đổi thẻ."}), 404

    old_card_actual = old_card or str(target.get("card_number") or "").strip()
    u = get_current_user()
    op_name = (u["full_name"] if u else None) or "Lễ tân"

    # 1. Revoke old card on hardware + release in SQL
    if old_card_actual:
        try:
            zk_client.return_or_delete_card(old_card_actual)
        except Exception:
            pass
        if db_mssql.is_mssql_active():
            db_mssql.release_card_on_checkout(
                old_card_actual, operator=op_name, notes=f"Đổi sang thẻ mới {new_card}"
            )

    # 2. Enroll new card on 4 ZKTeco devices
    hw_payload = dict(target)
    hw_payload["card_number"] = new_card
    hw_res = zk_client.enroll_visitor_card(hw_payload)
    new_epad_atid = str(hw_res.get("employee_atid") or "") if hw_res.get("success") else None

    # 3. Update visitor record + new card inventory
    updated = storage.swap_visitor_card(visitor_id, old_card_actual, new_card, new_visitor_id=new_epad_atid)
    if db_mssql.is_mssql_active():
        db_mssql.sync_card_assignment_on_checkin(
            new_card,
            target.get("full_name") or "Khách",
            target.get("cccd_number") or "",
            op_name,
            holder_phone=target.get("phone") or "",
            holder_company=target.get("company") or "",
            contact_person=target.get("host_person") or "",
            contact_phone=target.get("host_phone") or "",
            valid_from=target.get("checkin_time"),
            valid_to=target.get("expected_checkout_time"),
            device_sync_state="ACTIVE_ON_DEVICE",
        )
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_CustomerCards", 200)
            sharepoint_vms_sync.push_table_async("tbl_Visitors", 150)
        except Exception:
            pass

    return jsonify({
        "success": True,
        "visitor": updated,
        "old_card": old_card_actual,
        "new_card": new_card,
        "message": f"Đã đổi thẻ {old_card_actual or 'trống'} → {new_card} cho {target.get('full_name')} trên 4 máy cửa.",
    })


@app.route("/api/visitors/history", methods=["GET"])
@require_role(["admin", "staff"])
def get_visitor_history():
    limit = int(request.args.get("limit", 250))
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


# ---------------- Enterprise 18-Table SQL, Clock Guard, Input CRUD & SharePoint VMS APIs ----------------

@app.route("/api/clock/audit", methods=["GET"])
def api_clock_audit():
    """
    3-Way Clock Audit: Vietnam Standard Time (NTP UTC+7) vs Local PC Clock vs 4 ZKTeco Terminals.
    Never modifies any clock.
    """
    audit = zk_client.audit_all_clocks()
    return jsonify({"success": True, "audit": audit})


@app.route("/api/clock/sync_ntp", methods=["POST"])
@require_role(["admin"])
def api_clock_sync_ntp():
    """
    2-Layer Confirmed Clock Sync to Vietnam Standard Time (NTP UTC+7).
    Requires payload: {"confirm_layer1": true, "confirm_code": "CONFIRM_VN_NTP_SYNC"}
    """
    import db_mssql
    data = request.get_json(silent=True) or {}
    layer1 = bool(data.get("confirm_layer1"))
    code = str(data.get("confirm_code") or "").strip()
    u = get_current_user()
    operator = u["full_name"] if u else "Quản trị viên"

    if not layer1 or code != "CONFIRM_VN_NTP_SYNC":
        return jsonify({
            "success": False,
            "error": "Bắt buộc hoàn tất Xác nhận 2 lớp (nhập mã CONFIRM_VN_NTP_SYNC) trước khi đồng bộ giờ chuẩn Việt Nam xuống 4 máy ZKTeco."
        }), 400

    res = zk_client.sync_all_device_clocks(confirm_layer2_code="CONFIRM_VN_NTP_SYNC")
    audit = zk_client.audit_all_clocks()
    db_mssql.log_clock_sync_audit_db(
        audit_type="CONFIRMED_2LAYER_SYNC",
        audit_data=audit,
        confirm_code=code,
        operator=operator,
        status="SYNCED_TO_VN_NTP"
    )
    db_mssql.log_device_command_db(
        cmd_code="SYNC_CLOCK_VN_NTP_2LAYER",
        target_serial="ALL",
        target_name="Toàn bộ 4 máy ZKTeco SenseFace 4A",
        payload=res,
        status="COMPLETED",
        result_msg="Đã đồng bộ giờ chuẩn NTP Việt Nam (UTC+7) qua xác nhận 2 lớp.",
        operator=operator
    )
    try:
        import sharepoint_vms_sync
        sharepoint_vms_sync.push_table_async("tbl_ClockSyncAuditLogs", 50)
        sharepoint_vms_sync.push_table_async("tbl_DeviceCommands", 50)
        sharepoint_vms_sync.push_table_async("tbl_Devices", 20)
    except Exception:
        pass
    return jsonify({"success": True, "sync_result": res, "audit": audit})


@app.route("/api/sql/overview", methods=["GET"])
def api_sql_overview():
    """Returns overview and row counts for all 18 SQL Server tables in SeaZen_AccessControl."""
    import db_mssql
    conn_status = db_mssql.test_connection()
    tables = db_mssql.get_all_tables_overview()
    return jsonify({
        "success": True,
        "connection": conn_status,
        "tables": tables,
        "total_tables": len(tables),
        "total_rows": sum(t.get("row_count", 0) for t in tables)
    })


@app.route("/api/sql/table/<table_name>", methods=["GET"])
def api_sql_table_rows(table_name: str):
    """Returns rows for any of the 18 SQL Server tables."""
    import db_mssql
    limit = min(1000, max(10, int(request.args.get("limit", 200))))
    rows = db_mssql.get_table_rows(table_name, limit=limit)
    vn_label = db_mssql.ALLOWED_TABLES.get(table_name, table_name)
    return jsonify({
        "success": True,
        "table_name": table_name,
        "vn_name": vn_label,
        "sharepoint_list_name": f"VMS SEAZEN - {vn_label.upper()}",
        "count": len(rows),
        "rows": rows
    })


@app.route("/api/sync/safe_test", methods=["POST"])
@require_role(["admin", "staff"])
def api_sync_safe_test():
    """
    Runs non-destructive background sync test:
    1. Stateless ServiceId=1 read from ePAD (0% impact on reception or ePAD DB)
    2. Read-only TCP 4370 check & user/card read from 4 ZKTeco SenseFace 4A terminals
    3. Updates SeaZen_AccessControl SQL tables safely
    """
    import sync_safe_database
    try:
        res = sync_safe_database.run_all_safe_sync()
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/hrm/department", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_department():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_department_db(data)
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            threading.Thread(
                target=sharepoint_vms_sync.sync_table_to_sharepoint,
                args=("tbl_Departments", 200),
                daemon=True
            ).start()
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/hrm/employee", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_employee():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_employee_and_biometrics_db(data)
    atid = str(data.get("EmployeeATID") or "").strip()
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_Employees", 300)
            sharepoint_vms_sync.push_table_async("tbl_EmployeeBiometrics", 300)
            if atid and (data.get("FacePhotoBase64") or data.get("FaceTemplateBIODATA")):
                sharepoint_vms_sync.upload_biometric_attachment_to_sharepoint_async(
                    employee_atid=atid,
                    face_photo_b64=data.get("FacePhotoBase64"),
                    face_biodata=data.get("FaceTemplateBIODATA")
                )
        except Exception:
            pass
    if res.get("success") and data.get("sync_to_hardware"):
        u = get_current_user()
        operator = u["full_name"] if u else "Quản trị viên"
        atid = str(data.get("EmployeeATID") or "").strip()
        full_name = str(data.get("FullName") or "").strip()
        card_num = str(data.get("CardNumber") or "").strip()
        privilege = int(data.get("Privilege") or 0)
        hw_res = zk_client.upsert_employee_on_hardware(
            atid=atid,
            full_name=full_name,
            card_number=card_num,
            privilege=privilege
        )
        if hw_res.get("success"):
            db_mssql.mark_employee_hardware_synced_db(atid, card_num, privilege)
        db_mssql.log_device_command_db(
            cmd_code="UPLOAD_STAFF_TCP4370",
            target_serial="ALL",
            target_name="4 máy ZKTeco SenseFace 4A",
            payload={"EmployeeATID": atid, "FullName": full_name, "CardNumber": card_num, "Privilege": privilege},
            status="COMPLETED" if hw_res.get("success") else "FAILED",
            result_msg=hw_res.get("message") or str(hw_res),
            operator=operator
        )
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_DeviceCommands", 100)
        except Exception:
            pass
        res["hardware_sync"] = hw_res
    if res.get("success"):
        try:
            zk_client._load_person_cache()
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/hrm/employee/status", methods=["POST"])
@require_role(["admin"])
def api_toggle_employee_status():
    import db_mssql
    data = request.get_json(silent=True) or {}
    atid = str(data.get("EmployeeATID") or data.get("atid") or "").strip()
    is_active = bool(data.get("IsActive", True))
    res = db_mssql.toggle_employee_status_db(atid, is_active)
    if res.get("success"):
        try:
            zk_client._load_person_cache()
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_Employees", 300)
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/hrm/export_excel", methods=["GET"])
@require_role(["admin"])
def api_hrm_export_excel():
    """Exports structured Employee & Department HR Directory to Excel (.xlsx)."""
    import io
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    dept_filter = (request.args.get("department") or "").strip()
    q_filter = (request.args.get("q") or "").strip().lower()
    include_inactive = str(request.args.get("include_inactive") or "").strip() in ("1", "true")

    emps = storage.get_employees(department=dept_filter or None, include_inactive=include_inactive)
    if q_filter:
        emps = [
            e for e in emps
            if q_filter in f"{e.get('fullname','')} {e.get('atid','')} {e.get('code','')} {e.get('position','')} {e.get('phone','')} {e.get('email','')}".lower()
        ]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Danh Ba Nhan Su"

    ws.merge_cells("A1:I1")
    title = ws.cell(1, 1, f"DANH BẠ NHÂN SỰ SEAZEN ({len(emps)} nhân sự · {dept_filter or 'Tất cả phòng ban'})")
    title.font = Font(name="Calibri", size=14, bold=True, color="111111")
    title.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 24

    headers = ["STT", "Mã ATID", "Mã NV HR", "Họ và Tên", "Phòng ban", "Chức vụ", "Số điện thoại", "Email", "Trạng thái"]
    hdr_fill = PatternFill(start_color="111111", end_color="111111", fill_type="solid")
    hdr_font = Font(name="Calibri", size=10.5, bold=True, color="FFFFFF")
    thin = Side(style="thin", color="D1D5DB")
    brd = Border(left=thin, right=thin, top=thin, bottom=thin)

    for ci, h in enumerate(headers, 1):
        c = ws.cell(3, ci, h)
        c.fill = hdr_fill
        c.font = hdr_font
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = brd
    ws.row_dimensions[3].height = 24

    for idx, emp in enumerate(emps, start=1):
        row_n = 3 + idx
        vals = [
            idx,
            emp.get("atid", ""),
            emp.get("code", ""),
            emp.get("fullname", ""),
            emp.get("department", ""),
            emp.get("position", "") or "Nhân viên",
            emp.get("phone", "") or "—",
            emp.get("email", "") or "—",
            "Đang làm việc" if emp.get("is_active", True) else "Tạm khóa",
        ]
        for ci, val in enumerate(vals, 1):
            c = ws.cell(row_n, ci, val)
            c.border = brd
            c.alignment = Alignment(
                horizontal="center" if ci in (1, 2, 3, 9) else "left",
                vertical="center"
            )
            c.font = Font(name="Calibri", size=10.5, bold=(ci == 4))
        ws.row_dimensions[row_n].height = 20

    widths = [6, 14, 14, 28, 20, 18, 16, 28, 16]
    for ci, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(ci)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"Danh_Ba_Nhan_Su_SeaZen_{datetime.now().strftime('%Y%m%d')}.xlsx"
    )


@app.route("/api/biometrics/matrix", methods=["GET"])
@require_role(["admin"])
def api_biometrics_matrix():
    """
    Combines SQL Server tbl_Employees + tbl_EmployeeBiometrics + real-time 4-terminal
    ZKTeco SenseFace 4A user rosters + attendance verify-mode evidence.
    Query params: ?refresh=1 (triggers live TCP 4370 scan on 4 devices)
    """
    import db_mssql
    refresh = str(request.args.get("refresh") or "").strip() in ("1", "true", "yes")
    dept_filter = (request.args.get("department") or "").strip()
    q_filter = (request.args.get("q") or "").strip().lower()

    emps = storage.get_employees(department=dept_filter or None)
    hw_info = zk_client.get_hardware_biometric_matrix(refresh=refresh)
    hw_devs = hw_info.get("devices", [])
    hw_map = hw_info.get("users_by_norm_atid", {})

    # Reconcile SQL Server tbl_Devices user/face/finger counts if refreshed
    if refresh and db_mssql.is_mssql_active():
        try:
            import pyodbc
            with pyodbc.connect(db_mssql.get_connection_string(), timeout=4) as conn:
                cur = conn.cursor()
                for d in hw_devs:
                    if d.get("sn") and d.get("online"):
                        cur.execute("""
                            UPDATE tbl_Devices
                            SET UserCount = ?, FaceCount = ?, FingerCount = ?, IsOnline = 1, LastPingTime = GETDATE()
                            WHERE SerialNumber = ?
                        """, (int(d["user_count"]), int(d["face_count"]), int(d["finger_count"]), d["sn"]))
                conn.commit()
        except Exception as ex:
            logger.debug("Reconcile tbl_Devices warning: %s", ex)

    rows = []
    face_ready_count = 0
    card_ready_count = 0
    finger_ready_count = 0
    all_4_synced_count = 0

    for e in emps:
        raw_atid = str(e.get("atid") or "").strip()
        norm_k = str(int(raw_atid)) if raw_atid.isdigit() else raw_atid
        dev_presence = hw_map.get(norm_k) or hw_map.get(raw_atid) or {}

        doors_status = {}
        hw_cards = []
        hw_priv = int(e.get("privilege") or 0)
        synced_cnt = 0
        for d in hw_devs:
            ip = d["ip"]
            u_entry = dev_presence.get(ip)
            present = bool(u_entry)
            if present:
                synced_cnt += 1
                if u_entry.get("card"):
                    hw_cards.append(u_entry["card"])
                if u_entry.get("privilege", 0) > hw_priv:
                    hw_priv = u_entry["privilege"]
            doors_status[d["short_ip"]] = {
                "present": present,
                "name": d["name"],
                "uid": u_entry.get("uid") if u_entry else None,
                "card": u_entry.get("card") if u_entry else "",
                "privilege": u_entry.get("privilege", 0) if u_entry else 0,
            }

        db_card = str(e.get("card_number") or "").strip()
        effective_card = db_card or (hw_cards[0] if hw_cards else "")
        last_vmode = str(e.get("last_verify_mode") or "")
        scan_has_face = "face" in last_vmode.lower()
        scan_has_finger = "finger" in last_vmode.lower() or last_vmode == "4"

        has_face_evidence = bool(e.get("has_face") or e.get("face_photo") or scan_has_face or synced_cnt > 0)
        has_card = bool(effective_card or e.get("has_card"))
        has_finger = bool(e.get("has_finger") or scan_has_finger)

        if has_face_evidence:
            face_ready_count += 1
        if has_card:
            card_ready_count += 1
        if has_finger:
            finger_ready_count += 1
        if len(hw_devs) > 0 and synced_cnt == len(hw_devs):
            all_4_synced_count += 1

        row_obj = {
            **e,
            "card_number": effective_card,
            "db_card_number": db_card,
            "hardware_card": hw_cards[0] if hw_cards else "",
            "privilege": hw_priv,
            "db_has_face": bool(e.get("has_face")),
            "scan_verified_face": scan_has_face,
            "has_face_effective": has_face_evidence,
            "has_card_effective": has_card,
            "has_finger_effective": has_finger,
            "synced_doors_count": synced_cnt,
            "total_doors": len(hw_devs),
            "doors": doors_status,
        }

        if q_filter:
            hay = f"{row_obj.get('fullname','')} {raw_atid} {row_obj.get('code','')} {effective_card} {row_obj.get('department','')}".lower()
            if q_filter not in hay:
                continue
        rows.append(row_obj)

    return jsonify({
        "success": True,
        "devices": hw_devs,
        "summary": {
            "total_staff": len(emps),
            "face_ready": face_ready_count,
            "card_ready": card_ready_count,
            "finger_ready": finger_ready_count,
            "all_4_synced": all_4_synced_count,
        },
        "count": len(rows),
        "rows": rows
    })


@app.route("/api/biometrics/push_hardware", methods=["POST"])
@require_role(["admin"])
def api_biometrics_push_hardware():
    """Pushes one staff profile (ATID, FullName, CardNumber, Privilege) directly to all 4 ZKTeco terminals (TZ1=1)."""
    import db_mssql
    data = request.get_json(silent=True) or {}
    atid = str(data.get("EmployeeATID") or data.get("atid") or "").strip()
    full_name = str(data.get("FullName") or data.get("fullname") or "").strip()
    card_num = str(data.get("CardNumber") or data.get("card_number") or "").strip()
    privilege = int(data.get("Privilege") or data.get("privilege") or 0)

    if not atid:
        return jsonify({"success": False, "error": "Thiếu Mã ATID nhân viên để nạp thiết bị."}), 400

    hw_res = zk_client.upsert_employee_on_hardware(
        atid=atid,
        full_name=full_name or atid,
        card_number=card_num,
        privilege=privilege
    )
    if hw_res.get("success"):
        db_mssql.mark_employee_hardware_synced_db(atid, card_num or None, privilege)
        u = get_current_user()
        db_mssql.log_device_command_db(
            cmd_code="PUSH_BIOMETRICS_4DOORS",
            target_serial="ALL",
            target_name="4 máy ZKTeco SenseFace 4A",
            payload={"EmployeeATID": atid, "FullName": full_name, "CardNumber": card_num, "Privilege": privilege},
            status="COMPLETED",
            result_msg=hw_res.get("message") or "",
            operator=u["full_name"] if u else "Quản trị viên"
        )
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_EmployeeBiometrics", 300)
            sharepoint_vms_sync.push_table_async("tbl_DeviceCommands", 100)
        except Exception:
            pass
    return jsonify(hw_res), (200 if hw_res.get("success") else 500)


@app.route("/api/visitor/cards", methods=["GET"])
@require_role(["admin", "staff"])
def api_get_customer_cards():
    import db_mssql
    include_photos = str(request.args.get("include_photos", "1")).strip() not in ("0", "false", "no")
    res = db_mssql.get_customer_cards_db(limit=500, include_photos=include_photos)
    return jsonify({"success": True, **res})


@app.route("/api/visitor/card", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_customer_card():
    import db_mssql
    data = request.get_json(silent=True) or {}
    u = get_current_user()
    if u and not data.get("VerifiedBy"):
        data["VerifiedBy"] = u.get("full_name") or "Quản trị viên"
    res = db_mssql.upsert_customer_card_db(data)
    if res.get("success"):
        card_num = res.get("card_number") or str(data.get("CardNumber") or "").strip()
        card_code = res.get("card_code") or str(data.get("CardCode") or "").strip()
        if str(data.get("Status") or "").upper() in ("LOST", "LOCKED") and card_num:
            try:
                if not EPAD_ENABLED:
                    zk_client.return_or_delete_card(card_num)
            except Exception:
                pass
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_CustomerCards", 200)
            if data.get("CardPhotoBase64") and card_num:
                sharepoint_vms_sync.upload_card_evidence_attachment_async(
                    card_number=card_num,
                    card_code=card_code,
                    photo_b64=data["CardPhotoBase64"],
                    verified_by=data.get("VerifiedBy") or "Quản trị viên",
                )
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/visitor/card/upload_evidence", methods=["POST"])
@require_role(["admin", "staff"])
def api_upload_card_evidence():
    import db_mssql
    data = request.get_json(silent=True) or {}
    target = data.get("CardID") or data.get("CardNumber") or data.get("card_number") or ""
    photo_b64 = data.get("CardPhotoBase64") or data.get("photo_base64") or ""
    u = get_current_user()
    verified_by = (u.get("full_name") if u else None) or "Quản trị viên"
    res = db_mssql.upload_card_evidence_db(
        card_id_or_number=target,
        photo_b64=photo_b64,
        verified_by=verified_by,
        card_name=data.get("CardName"),
        card_code=data.get("CardCode"),
        notes=data.get("Notes"),
    )
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_CustomerCards", 200)
            if photo_b64 and len(str(photo_b64).strip()) > 25:
                sharepoint_vms_sync.upload_card_evidence_attachment_async(
                    card_number=res["card_number"],
                    card_code=res["card_code"],
                    photo_b64=photo_b64,
                    verified_by=verified_by,
                    card_name=res.get("card_name") or "",
                    evidence_status=res.get("evidence_status") or "VERIFIED",
                )
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/visitor/card/delete", methods=["POST"])
@app.route("/api/visitor/card/<card_key>", methods=["DELETE"])
@require_role(["admin", "staff"])
def api_delete_customer_card(card_key: str = ""):
    import db_mssql
    data = request.get_json(silent=True) or {}
    target = card_key or data.get("CardNumber") or data.get("CardID") or data.get("card_number") or ""
    res = db_mssql.delete_customer_card_db(target)
    if res.get("success") and res.get("card_number"):
        if not data.get("skip_hardware"):
            try:
                if not EPAD_ENABLED:
                    zk_client.return_or_delete_card(str(res["card_number"]))
            except Exception:
                pass
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.delete_customer_cards_on_sharepoint_async([{
                "card_number": res["card_number"],
                "card_code": res.get("card_code", ""),
            }])
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/visitor/cards/clear", methods=["POST"])
@require_role(["admin"])
def api_clear_customer_cards():
    import db_mssql
    data = request.get_json(silent=True) or {}
    clear_all = bool(data.get("clear_all", False))
    card_numbers = data.get("card_numbers") or []
    res = db_mssql.clear_customer_cards_db(card_numbers=card_numbers, clear_all=clear_all)
    if res.get("success"):
        deleted_items = res.get("deleted") or []
        if data.get("revoke_hardware") and not EPAD_ENABLED:
            for it in deleted_items:
                try:
                    zk_client.return_or_delete_card(str(it.get("card_number") or ""))
                except Exception:
                    pass
        try:
            import sharepoint_vms_sync
            if clear_all and not (res.get("skipped_active")):
                threading.Thread(target=sharepoint_vms_sync.clear_all_customer_cards_on_sharepoint, daemon=True).start()
            elif deleted_items:
                sharepoint_vms_sync.delete_customer_cards_on_sharepoint_async(deleted_items)
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/visitor/pre_register", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_pre_register():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_pre_registered_guest_db(data)
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_PreRegisteredGuests", 200)
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/visitor/contractor", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_contractor():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_contractor_db(data)
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_Contractors", 200)
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/access/timezone", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_timezone():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_access_timezone_db(data)
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_AccessTimezones", 50)
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/access/group", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_access_group():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_access_group_db(data)
    if res.get("success"):
        try:
            import sharepoint_vms_sync
            sharepoint_vms_sync.push_table_async("tbl_AccessGroups", 50)
        except Exception:
            pass
    return jsonify(res), (200 if res.get("success") else 400)


def _build_timekeeping_matrix_data(
    month_str: str = "",
    from_date_str: str = "",
    to_date_str: str = "",
    dept_filter: str = "",
    q_filter: str = ""
) -> Dict[str, Any]:
    """
    Builds the Employee x Day Timekeeping Pivot Matrix:
    - Standard Working Hours: 07:45 - 16:45
    - Each day cell has 2 lines:
        Line 1: Total hours (e.g. '9.1', '8.5', or '-' if only 1 scan)
        Line 2: First-In - Last-Out (e.g. '07:45 - 16:48', or '07:48 - ---')
    """
    import calendar
    from datetime import date as dt_date, timedelta
    import db_mssql

    now = datetime.now()
    if month_str and len(month_str) == 7 and "-" in month_str and not (from_date_str and to_date_str):
        y_m = month_str.split("-")
        yr, mo = int(y_m[0]), int(y_m[1])
        last_day = calendar.monthrange(yr, mo)[1]
        from_date_str = f"{yr:04d}-{mo:02d}-01"
        to_date_str = f"{yr:04d}-{mo:02d}-{last_day:02d}"

    if not from_date_str or not to_date_str:
        yr, mo = now.year, now.month
        last_day = calendar.monthrange(yr, mo)[1]
        from_date_str = from_date_str or f"{yr:04d}-{mo:02d}-01"
        to_date_str = to_date_str or f"{yr:04d}-{mo:02d}-{last_day:02d}"

    try:
        d_start = datetime.strptime(from_date_str[:10], "%Y-%m-%d").date()
        d_end = datetime.strptime(to_date_str[:10], "%Y-%m-%d").date()
    except Exception:
        d_start = dt_date(now.year, now.month, 1)
        d_end = dt_date(now.year, now.month, calendar.monthrange(now.year, now.month)[1])

    if d_end < d_start:
        d_start, d_end = d_end, d_start
    if (d_end - d_start).days > 62:
        d_end = d_start + timedelta(days=62)

    from_iso = d_start.strftime("%Y-%m-%d")
    to_iso = d_end.strftime("%Y-%m-%d")

    dow_names = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]
    days_meta = []
    cur_d = d_start
    while cur_d <= d_end:
        d_iso = cur_d.strftime("%Y-%m-%d")
        wd = cur_d.weekday()  # 0=Mon .. 6=Sun
        days_meta.append({
            "date": d_iso,
            "day_num": f"{cur_d.day:02d}",
            "month_num": f"{cur_d.month:02d}",
            "dow": dow_names[wd],
            "is_sunday": wd == 6
        })
        cur_d += timedelta(days=1)

    # 1. Load Employee Directory for accurate EmployeeCode & DepartmentName
    emp_dir: Dict[str, Dict[str, str]] = {}
    emp_json_path = os.path.join(BASE_DIR, "data", "employees.json")
    if os.path.exists(emp_json_path):
        try:
            with open(emp_json_path, "r", encoding="utf-8") as f:
                for e in json.load(f):
                    raw_id = str(e.get("atid") or e.get("code") or "").strip()
                    if not raw_id:
                        continue
                    norm_id = str(int(raw_id)) if raw_id.isdigit() else raw_id
                    fn = str(e.get("fullname") or "").strip()
                    dept = str(e.get("department") or "").strip()
                    if fn and not fn.lower().startswith("khach"):
                        emp_dir[norm_id] = {
                            "code": str(e.get("code") or norm_id).lstrip("0") or norm_id,
                            "full_name": fn,
                            "department": dept if dept and dept not in ("Khác", "--") else "HC QTNS"
                        }
        except Exception:
            pass

    if db_mssql.is_mssql_active():
        try:
            import pyodbc
            with pyodbc.connect(db_mssql.get_connection_string(), timeout=4) as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT EmployeeATID, EmployeeCode, FullName, DepartmentName
                    FROM tbl_Employees
                    WHERE IsStaff = 1 AND IsActive = 1
                """)
                for r in cur.fetchall():
                    raw_id = str(r[0] or "").strip()
                    if not raw_id:
                        continue
                    norm_id = str(int(raw_id)) if raw_id.isdigit() else raw_id
                    fn = str(r[2] or "").strip()
                    dept = str(r[3] or "").strip()
                    if not fn or fn.lower().startswith("khach") or (norm_id.isdigit() and int(norm_id) >= 56000):
                        continue
                    existing = emp_dir.get(norm_id, {})
                    emp_dir[norm_id] = {
                        "code": str(r[1] or existing.get("code") or norm_id).lstrip("0") or norm_id,
                        "full_name": fn,
                        "department": dept if dept and dept not in ("Khác", "--", "Nhân sự SeaZen") else (existing.get("department") or "HC QTNS")
                    }
        except Exception:
            pass

    # 2. Collect all scans in [from_iso .. to_iso] from both SQL Server and local cache
    # grouped_times[norm_id][date_iso] = set of "HH:MM:SS" strings
    grouped_times: Dict[str, Dict[str, set]] = {}
    fallback_meta: Dict[str, Dict[str, str]] = {}

    def _add_scan_point(raw_atid: Any, raw_name: Any, raw_dept: Any, chk_str: str) -> None:
        s_id = str(raw_atid or "").strip()
        if not s_id:
            return
        norm_id = str(int(s_id)) if s_id.isdigit() else s_id
        # Exclude visitor IDs (56235..56254, 80000000+)
        if norm_id.isdigit() and int(norm_id) >= 56000:
            return
        fn_str = str(raw_name or "").strip()
        if fn_str.lower().startswith("khach") or fn_str.lower().startswith("nv 00056"):
            return
        chk_clean = str(chk_str or "").replace("T", " ").strip()
        if len(chk_clean) < 16:
            return
        d_part = chk_clean[:10]
        t_part = chk_clean[11:19]
        if d_part < from_iso or d_part > to_iso:
            return
        grouped_times.setdefault(norm_id, {}).setdefault(d_part, set()).add(t_part)
        if norm_id not in fallback_meta and fn_str:
            fallback_meta[norm_id] = {
                "code": norm_id,
                "full_name": fn_str,
                "department": str(raw_dept or "").strip() or "HC QTNS"
            }

    # 2a. From local daily_scans.json cache
    for s in storage._load_scans_cache():
        ptype = determine_scan_person_type(s)
        if not ptype.get("is_staff", True):
            continue
        _add_scan_point(
            s.get("EmployeeATID"),
            s.get("FullName"),
            s.get("Department"),
            s.get("CheckTime") or s.get("Time") or ""
        )

    # 2b. From SQL Server tbl_AttendanceLogs & tbl_DailyTimekeeping
    if db_mssql.is_mssql_active():
        try:
            import pyodbc
            with pyodbc.connect(db_mssql.get_connection_string(), timeout=5) as conn:
                cur = conn.cursor()
                cur.execute("""
                    SELECT EmployeeATID, FullName, Department, CONVERT(VARCHAR(19), CheckTime, 120)
                    FROM tbl_AttendanceLogs
                    WHERE IsStaff = 1 AND CAST(CheckTime AS DATE) BETWEEN ? AND ?
                """, (from_iso, to_iso))
                for r in cur.fetchall():
                    _add_scan_point(r[0], r[1], r[2], r[3])

                cur.execute("""
                    SELECT EmployeeATID, FullName, DepartmentName,
                           CONVERT(VARCHAR(19), FirstInTime, 120),
                           CONVERT(VARCHAR(19), LastOutTime, 120)
                    FROM tbl_DailyTimekeeping
                    WHERE WorkDate BETWEEN ? AND ?
                """, (from_iso, to_iso))
                for r in cur.fetchall():
                    if r[3]:
                        _add_scan_point(r[0], r[1], r[2], r[3])
                    if r[4]:
                        _add_scan_point(r[0], r[1], r[2], r[4])
        except Exception as e:
            logger.debug("Matrix SQL query warning: %s", e)

    # 3. Build Employee Rows & Daily Totals
    daily_totals: Dict[str, Dict[str, Any]] = {
        dm["date"]: {"present_count": 0, "total_hours": 0.0} for dm in days_meta
    }
    employee_rows = []

    for norm_id, day_map in grouped_times.items():
        meta = emp_dir.get(norm_id) or fallback_meta.get(norm_id) or {
            "code": norm_id,
            "full_name": f"Nhân sự {norm_id}",
            "department": "HC QTNS"
        }
        dept_name = meta.get("department") or "HC QTNS"
        if dept_name in ("Nhân sự SeaZen", "Khác", "--"):
            dept_name = emp_dir.get(norm_id, {}).get("department") or "HC QTNS"
        full_name = meta.get("full_name") or f"Nhân sự {norm_id}"
        emp_code = meta.get("code") or norm_id

        if dept_filter and dept_name != dept_filter:
            continue
        if q_filter:
            hay = f"{emp_code} {norm_id} {full_name} {dept_name}".lower()
            if q_filter not in hay:
                continue

        cells: Dict[str, Dict[str, Any]] = {}
        emp_total_hours = 0.0
        emp_present_days = 0
        emp_work_units = 0.0

        for d_iso, times_set in day_map.items():
            if not times_set:
                continue
            t_sorted = sorted(times_set)
            first_t = t_sorted[0]
            last_t = t_sorted[-1] if len(t_sorted) > 1 else None

            in_hhmm = first_t[:5]
            out_hhmm = "---"
            hours_val = 0.0
            has_out = False

            try:
                t1 = datetime.strptime(first_t[:8], "%H:%M:%S")
                if last_t and last_t != first_t:
                    t2 = datetime.strptime(last_t[:8], "%H:%M:%S")
                    diff_sec = (t2 - t1).total_seconds()
                    # Only count as valid Out scan if at least 3 minutes apart from First-In
                    if diff_sec >= 180:
                        has_out = True
                        out_hhmm = last_t[:5]
                        hours_val = round(diff_sec / 3600.0, 1)
            except Exception:
                pass

            # Standard work day: 07:45 to 16:45 (9.0h span = 8.0h work + 1.0h break)
            work_unit = 1.0 if hours_val >= 7.5 else (0.5 if hours_val >= 3.5 else 0.0)
            emp_present_days += 1
            emp_total_hours = round(emp_total_hours + hours_val, 1)
            emp_work_units = round(emp_work_units + work_unit, 1)

            if d_iso in daily_totals:
                daily_totals[d_iso]["present_count"] += 1
                daily_totals[d_iso]["total_hours"] = round(daily_totals[d_iso]["total_hours"] + hours_val, 1)

            hours_str = (str(int(hours_val)) if hours_val.is_integer() else str(hours_val)) if has_out else "-"
            cells[d_iso] = {
                "hours": hours_val,
                "hours_display": hours_str,
                "time_range": f"{in_hhmm} - {out_hhmm}",
                "in_time": in_hhmm,
                "out_time": out_hhmm,
                "has_out": has_out,
                "work_unit": work_unit
            }

        if cells:
            employee_rows.append({
                "employee_atid": norm_id,
                "employee_code": emp_code,
                "full_name": full_name,
                "department": dept_name,
                "total_hours": emp_total_hours,
                "present_days": emp_present_days,
                "total_work_units": emp_work_units,
                "days": cells
            })

    employee_rows.sort(key=lambda r: (r["department"], r["full_name"]))
    return {
        "success": True,
        "shift_standard": "07:45 - 16:45",
        "from_date": from_iso,
        "to_date": to_iso,
        "days": days_meta,
        "employees": employee_rows,
        "daily_totals": daily_totals,
        "total_employees": len(employee_rows)
    }


@app.route("/api/timekeeping/matrix", methods=["GET"])
@require_role(["admin", "staff"])
def api_timekeeping_matrix():
    month_str = (request.args.get("month") or "").strip()
    from_date = (request.args.get("from_date") or "").strip()
    to_date = (request.args.get("to_date") or "").strip()
    dept_filter = (request.args.get("department") or "").strip()
    q_filter = (request.args.get("search") or "").strip().lower()
    data = _build_timekeeping_matrix_data(month_str, from_date, to_date, dept_filter, q_filter)
    return jsonify(data)


@app.route("/api/timekeeping/export_excel", methods=["GET"])
@require_role(["admin", "staff"])
def api_timekeeping_export_excel():
    """
    Exports the filtered Timekeeping Matrix to an Excel (.xlsx) file.
    Columns: STT | Mã số NV | Họ và tên | Phòng ban | <Day Columns> | Tổng giờ công | Số ngày có mặt
    Each day cell contains 2 lines:
      Line 1: Total hours (e.g. 9.1)
      Line 2: CheckIn - CheckOut (e.g. 07:45 - 16:48)
    """
    import io
    from flask import send_file
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    month_str = (request.args.get("month") or "").strip()
    from_date = (request.args.get("from_date") or "").strip()
    to_date = (request.args.get("to_date") or "").strip()
    dept_filter = (request.args.get("department") or "").strip()
    q_filter = (request.args.get("search") or "").strip().lower()

    matrix = _build_timekeeping_matrix_data(month_str, from_date, to_date, dept_filter, q_filter)
    days = matrix["days"]
    employees = matrix["employees"]
    daily_totals = matrix["daily_totals"]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Bang_Tong_Hop_Cong"

    thin_side = Side(style="thin", color="D1D5DB")
    border_all = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
    header_fill = PatternFill(start_color="111111", end_color="111111", fill_type="solid")
    sun_head_fill = PatternFill(start_color="9A6700", end_color="9A6700", fill_type="solid")
    sun_cell_fill = PatternFill(start_color="FEF9EE", end_color="FEF9EE", fill_type="solid")
    total_fill = PatternFill(start_color="F3F4F6", end_color="F3F4F6", fill_type="solid")

    font_title = Font(name="Arial", size=13, bold=True, color="111111")
    font_sub = Font(name="Arial", size=10, italic=True, color="4B5563")
    font_head = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    font_emp = Font(name="Arial", size=10, bold=True, color="111111")
    font_norm = Font(name="Arial", size=10, color="111111")
    font_cell = Font(name="Arial", size=9.5, bold=True, color="0F5132")

    total_cols = 4 + len(days) + 2
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=min(total_cols, 16))
    ws.cell(row=1, column=1, value=f"BẢNG TỔNG HỢP CÔNG NHÂN VIÊN SEAZEN ({matrix['from_date']} đến {matrix['to_date']})").font = font_title

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=min(total_cols, 16))
    dept_label = dept_filter if dept_filter else "Tất cả phòng ban"
    ws.cell(row=2, column=1, value=f"Giờ làm việc chuẩn: 07:45 - 16:45 | Phòng ban: {dept_label} | Tổng nhân sự: {len(employees)}").font = font_sub

    # Row 4: Table Headers
    fixed_headers = ["STT", "MÃ SỐ NV", "HỌ VÀ TÊN", "PHÒNG BAN"]
    for idx, h_text in enumerate(fixed_headers, start=1):
        c = ws.cell(row=4, column=idx, value=h_text)
        c.font = font_head
        c.fill = header_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = border_all

    for d_idx, dm in enumerate(days, start=5):
        c = ws.cell(row=4, column=d_idx, value=f"{dm['day_num']}/{dm['month_num']}\n({dm['dow']})")
        c.font = font_head
        c.fill = sun_head_fill if dm["is_sunday"] else header_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = border_all

    c_tot_h = ws.cell(row=4, column=5 + len(days), value="TỔNG GIỜ")
    c_tot_h.font = font_head
    c_tot_h.fill = header_fill
    c_tot_h.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c_tot_h.border = border_all

    c_tot_d = ws.cell(row=4, column=6 + len(days), value="NGÀY CÓ MẶT")
    c_tot_d.font = font_head
    c_tot_d.fill = header_fill
    c_tot_d.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c_tot_d.border = border_all

    ws.row_dimensions[4].height = 28

    # Employee Rows
    for r_i, emp in enumerate(employees, start=1):
        row_num = 4 + r_i
        ws.row_dimensions[row_num].height = 28

        c1 = ws.cell(row=row_num, column=1, value=r_i)
        c1.alignment = Alignment(horizontal="center", vertical="center")
        c1.font = font_norm
        c1.border = border_all

        c2 = ws.cell(row=row_num, column=2, value=emp["employee_code"])
        c2.alignment = Alignment(horizontal="center", vertical="center")
        c2.font = font_emp
        c2.border = border_all

        c3 = ws.cell(row=row_num, column=3, value=emp["full_name"].upper())
        c3.alignment = Alignment(horizontal="left", vertical="center")
        c3.font = font_emp
        c3.border = border_all

        c4 = ws.cell(row=row_num, column=4, value=emp["department"])
        c4.alignment = Alignment(horizontal="left", vertical="center")
        c4.font = font_norm
        c4.border = border_all

        emp_days = emp.get("days", {})
        for d_idx, dm in enumerate(days, start=5):
            cell_obj = emp_days.get(dm["date"])
            cell_ref = ws.cell(row=row_num, column=d_idx)
            if cell_obj:
                # 2 lines: Line 1 = Total hours, Line 2 = In - Out
                cell_ref.value = f"{cell_obj['hours_display']}\n{cell_obj['time_range']}"
                cell_ref.font = font_cell
            else:
                cell_ref.value = ""
            if dm["is_sunday"]:
                cell_ref.fill = sun_cell_fill
            cell_ref.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell_ref.border = border_all

        ct1 = ws.cell(row=row_num, column=5 + len(days), value=emp["total_hours"])
        ct1.alignment = Alignment(horizontal="center", vertical="center")
        ct1.font = font_emp
        ct1.border = border_all

        ct2 = ws.cell(row=row_num, column=6 + len(days), value=emp["present_days"])
        ct2.alignment = Alignment(horizontal="center", vertical="center")
        ct2.font = font_norm
        ct2.border = border_all

    # Footer Summary Row (TỔNG CỘNG)
    foot_row = 5 + len(employees)
    ws.row_dimensions[foot_row].height = 28
    ws.merge_cells(start_row=foot_row, start_column=1, end_row=foot_row, end_column=4)
    for col_k in range(1, 5):
        fc = ws.cell(row=foot_row, column=col_k)
        fc.fill = total_fill
        fc.border = border_all
    ws.cell(row=foot_row, column=1, value="TỔNG CỘNG (NGƯỜI / GIỜ):").font = font_emp
    ws.cell(row=foot_row, column=1).alignment = Alignment(horizontal="right", vertical="center")

    for d_idx, dm in enumerate(days, start=5):
        dtot = daily_totals.get(dm["date"], {"present_count": 0, "total_hours": 0.0})
        fc = ws.cell(row=foot_row, column=d_idx)
        if dtot["present_count"] > 0:
            fc.value = f"{dtot['present_count']} NV\n{dtot['total_hours']}h"
        else:
            fc.value = "-"
        fc.font = font_emp
        fc.fill = total_fill
        fc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        fc.border = border_all

    grand_hours = round(sum(e["total_hours"] for e in employees), 1)
    grand_days = sum(e["present_days"] for e in employees)
    f_gh = ws.cell(row=foot_row, column=5 + len(days), value=grand_hours)
    f_gh.font = font_emp
    f_gh.fill = total_fill
    f_gh.alignment = Alignment(horizontal="center", vertical="center")
    f_gh.border = border_all

    f_gd = ws.cell(row=foot_row, column=6 + len(days), value=grand_days)
    f_gd.font = font_emp
    f_gd.fill = total_fill
    f_gd.alignment = Alignment(horizontal="center", vertical="center")
    f_gd.border = border_all

    # Column widths
    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["C"].width = 26
    ws.column_dimensions["D"].width = 18
    for d_idx in range(5, 5 + len(days)):
        ws.column_dimensions[get_column_letter(d_idx)].width = 13
    ws.column_dimensions[get_column_letter(5 + len(days))].width = 12
    ws.column_dimensions[get_column_letter(6 + len(days))].width = 13

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"Bang_Tong_Hop_Cong_SeaZen_{matrix['from_date']}_{matrix['to_date']}.xlsx"
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=fname
    )


@app.route("/api/timekeeping/export_excel_bcc", methods=["GET"])
@require_role(["admin", "staff"])
def api_timekeeping_export_excel_bcc():
    """
    Exports timekeeping data in BCC SZ-EXPERT format.
    Columns: Ngày | Thứ | Số hiệu | Họ và tên | Thời gian sớm nhất | Thời gian trễ nhất | Giờ làm việc | Ghi chú
    One row per employee per day.
    Weekend rule:
      - First Saturday + Last Saturday of the range's month = working day (included normally)
      - All other Saturdays + all Sundays = rest day ("Ngày nghỉ tuần" if no scan, or "Làm ngày nghỉ Xh" if scanned)
    """
    import io
    import calendar as _calendar
    from datetime import date as _dt_date, time as _dt_time
    from flask import send_file
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    month_str = (request.args.get("month") or "").strip()
    from_date = (request.args.get("from_date") or "").strip()
    to_date = (request.args.get("to_date") or "").strip()
    dept_filter = (request.args.get("department") or "").strip()
    q_filter = (request.args.get("search") or "").strip().lower()

    matrix = _build_timekeeping_matrix_data(month_str, from_date, to_date, dept_filter, q_filter)
    days = matrix["days"]
    employees = matrix["employees"]

    # --- Weekend helper: first & last Saturday of given year/month ---
    def _get_first_last_sat(year: int, month: int):
        last_day = _calendar.monthrange(year, month)[1]
        sats = [
            d for d in range(1, last_day + 1)
            if _dt_date(year, month, d).weekday() == 5
        ]
        if not sats:
            return set()
        return {sats[0], sats[-1]}

    _sat_cache: dict = {}

    def _is_working_saturday(dt: _dt_date) -> bool:
        if dt.weekday() != 5:
            return False
        key = (dt.year, dt.month)
        if key not in _sat_cache:
            _sat_cache[key] = _get_first_last_sat(dt.year, dt.month)
        return dt.day in _sat_cache[key]

    def _parse_hhmm(val: str):
        if not val or val == "---":
            return None
        try:
            return _dt_time(int(val[:2]), int(val[3:5]))
        except Exception:
            return val

    _thu_labels = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật"]

    # --- Style setup ---
    thin = Side(style="thin", color="BDBDBD")
    brd = Border(left=thin, right=thin, top=thin, bottom=thin)
    hdr_fill = PatternFill(start_color="1A1A2E", end_color="1A1A2E", fill_type="solid")
    rest_fill = PatternFill(start_color="F5F5F5", end_color="F5F5F5", fill_type="solid")
    work_sat_fill = PatternFill(start_color="EBF5EB", end_color="EBF5EB", fill_type="solid")
    note_fill = PatternFill(start_color="FFF8E1", end_color="FFF8E1", fill_type="solid")

    fnt_hdr = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    fnt_emp = Font(name="Arial", size=10, bold=True, color="111111")
    fnt_norm = Font(name="Arial", size=10, color="111111")
    fnt_rest = Font(name="Arial", size=10, italic=True, color="9E9E9E")
    fnt_time = Font(name="Arial", size=10, color="1565C0")
    fnt_note = Font(name="Arial", size=9, italic=True, color="B45309")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "BCC_SZ-EXPERT"

    dept_label = dept_filter if dept_filter else "Tất cả phòng ban"
    ws.merge_cells("A1:H1")
    ws.cell(1, 1, f"BẢNG CHẤM CÔNG SZ-EXPERT – {matrix['from_date']} đến {matrix['to_date']} – {dept_label}").font = Font(name="Arial", size=13, bold=True)
    ws.row_dimensions[1].height = 20

    headers = ["Ngày", "Thứ", "Số hiệu", "Họ và tên",
               "Thời gian sớm nhất", "Thời gian trễ nhất", "Giờ làm việc", "Ghi chú"]
    for ci, h in enumerate(headers, 1):
        c = ws.cell(3, ci, h)
        c.font = fnt_hdr
        c.fill = hdr_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = brd
    ws.row_dimensions[3].height = 22

    col_widths = [13, 10, 12, 26, 20, 20, 16, 30]
    for ci, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(ci)].width = w

    cur_row = 4
    for emp in employees:
        emp_atid_raw = emp["employee_atid"]
        try:
            emp_atid_val = int(emp_atid_raw)
        except Exception:
            emp_atid_val = emp_atid_raw
        emp_days = emp.get("days", {})

        for dm in days:
            d_iso = dm["date"]
            try:
                _dt = _dt_date.fromisoformat(d_iso)
                wd_idx = _dt.weekday()  # 0=Mon..6=Sun
            except Exception:
                _dt = None
                wd_idx = 0

            thu_label = _thu_labels[wd_idx]
            is_sunday = wd_idx == 6
            is_saturday = wd_idx == 5
            is_work_sat = bool(_dt and is_saturday and _is_working_saturday(_dt))
            is_rest_day = is_sunday or (is_saturday and not is_work_sat)

            cell_data = emp_days.get(d_iso)
            has_scan = bool(cell_data)

            # Col A: Date
            c_date = ws.cell(cur_row, 1)
            if _dt is not None:
                c_date.value = _dt
                c_date.number_format = "DD/MM/YYYY"
            else:
                c_date.value = d_iso
            c_date.font = fnt_rest if (is_rest_day and not has_scan) else fnt_norm
            c_date.alignment = Alignment(horizontal="center", vertical="center")
            c_date.border = brd

            # Col B: Thứ
            c_thu = ws.cell(cur_row, 2, thu_label)
            c_thu.font = fnt_rest if (is_rest_day and not has_scan) else fnt_norm
            c_thu.alignment = Alignment(horizontal="center", vertical="center")
            c_thu.border = brd

            # Col C: Số hiệu (ATID)
            c_atid = ws.cell(cur_row, 3, emp_atid_val)
            c_atid.font = fnt_rest if (is_rest_day and not has_scan) else fnt_norm
            c_atid.alignment = Alignment(horizontal="center", vertical="center")
            c_atid.border = brd

            # Col D: Họ và tên
            c_name = ws.cell(cur_row, 4, emp["full_name"])
            c_name.font = fnt_rest if (is_rest_day and not has_scan) else fnt_emp
            c_name.alignment = Alignment(horizontal="left", vertical="center")
            c_name.border = brd

            c_in = ws.cell(cur_row, 5)
            c_out = ws.cell(cur_row, 6)
            c_hrs = ws.cell(cur_row, 7)
            c_note = ws.cell(cur_row, 8)

            c_in.alignment = Alignment(horizontal="center", vertical="center")
            c_out.alignment = Alignment(horizontal="center", vertical="center")
            c_hrs.alignment = Alignment(horizontal="center", vertical="center")
            c_note.alignment = Alignment(horizontal="left", vertical="center")
            c_in.border = brd
            c_out.border = brd
            c_hrs.border = brd
            c_note.border = brd

            fill_row = rest_fill if is_rest_day else (work_sat_fill if is_work_sat else None)

            if is_rest_day and not has_scan:
                c_in.value = None
                c_in.font = fnt_rest
                c_out.value = None
                c_out.font = fnt_rest
                c_hrs.value = 0.0
                c_hrs.number_format = "0.0"
                c_hrs.font = fnt_rest
                c_note.value = "Ngày nghỉ tuần"
                c_note.font = fnt_note
                for ci in range(1, 9):
                    ws.cell(cur_row, ci).fill = rest_fill
            elif has_scan:
                if fill_row:
                    for ci in range(1, 9):
                        ws.cell(cur_row, ci).fill = fill_row

                in_parsed = _parse_hhmm(cell_data.get("in_time", ""))
                out_parsed = _parse_hhmm(cell_data.get("out_time", ""))
                hours_val = float(cell_data.get("hours") or 0.0)
                has_out = bool(cell_data.get("has_out"))

                c_in.value = in_parsed
                if isinstance(in_parsed, _dt_time):
                    c_in.number_format = "HH:MM"
                c_in.font = fnt_time

                c_out.value = out_parsed
                if isinstance(out_parsed, _dt_time):
                    c_out.number_format = "HH:MM"
                c_out.font = fnt_time

                c_hrs.value = round(hours_val, 1)
                c_hrs.number_format = "0.0"
                c_hrs.font = fnt_emp

                if is_rest_day:
                    note_text = f"Làm ngày nghỉ {hours_val:.1f}h" if has_out else "Làm ngày nghỉ · Thiếu giờ ra"
                elif not has_out:
                    note_text = "Thiếu giờ ra"
                else:
                    note_text = ""

                c_note.value = note_text or None
                c_note.font = fnt_note if note_text else fnt_norm
                if note_text:
                    c_note.fill = note_fill
            else:
                if fill_row:
                    for ci in range(1, 9):
                        ws.cell(cur_row, ci).fill = fill_row
                c_in.value = None
                c_in.font = fnt_norm
                c_out.value = None
                c_out.font = fnt_norm
                c_hrs.value = 0.0
                c_hrs.number_format = "0.0"
                c_hrs.font = fnt_norm
                c_note.value = None
                c_note.font = fnt_norm

            ws.row_dimensions[cur_row].height = 16
            cur_row += 1

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = f"BCC_SZ-EXPERT_{matrix['from_date']}_{matrix['to_date']}.xlsx"
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=fname
    )


@app.route("/api/timekeeping/summary", methods=["GET"])
@require_role(["admin", "staff"])
def api_timekeeping_summary():
    """
    Calculates daily timekeeping from First-In scan and Last-Out scan per employee per day:
    - FirstInTime (Đầu ngày quét)
    - LastOutTime (Cuối ngày quét)
    - TotalHours & WorkUnit (Dữ liệu công)
    - LateMinutes (Đi trễ so với 08:05)
    """
    import db_mssql
    target_date = (request.args.get("date") or "").strip()
    dept_filter = (request.args.get("department") or "").strip()
    q_filter = (request.args.get("search") or "").strip().lower()

    rows = []
    if target_date and target_date != "ALL":
        scans = storage.get_saved_scans(target_date)
        grouped = {}
        for s in scans:
            ptype = determine_scan_person_type(s)
            if not ptype.get("is_staff", True):
                continue
            atid = str(s.get("EmployeeATID") or "").strip()
            if not atid:
                continue
            chk_str = str(s.get("CheckTime") or s.get("Time") or "").replace("T", " ").strip()
            if not chk_str:
                continue
            entry = grouped.setdefault(atid, {
                "WorkDate": target_date,
                "EmployeeATID": atid,
                "FullName": s.get("FullName") or f"Nhân sự {atid}",
                "DepartmentName": s.get("Department") or "Nhân sự SeaZen",
                "times": []
            })
            entry["times"].append(chk_str)

        for atid, info in grouped.items():
            times_sorted = sorted(info["times"])
            first_in = times_sorted[0]
            last_out = times_sorted[-1] if len(times_sorted) > 1 else None
            total_scans = len(times_sorted)
            late_mins = 0
            total_hours = 0.0
            try:
                dt_in = datetime.strptime(first_in, "%Y-%m-%d %H:%M:%S")
                in_mins = dt_in.hour * 60 + dt_in.minute
                if in_mins > (8 * 60 + 5):
                    late_mins = in_mins - (8 * 60)
                if last_out:
                    dt_out = datetime.strptime(last_out, "%Y-%m-%d %H:%M:%S")
                    diff_h = (dt_out - dt_in).total_seconds() / 3600.0
                    total_hours = round(max(0.0, diff_h), 2)
            except Exception:
                pass

            work_unit = 1.0 if total_hours >= 7.5 else (0.5 if total_hours >= 3.5 else 0.0)
            status = "LATE" if late_mins > 0 else ("MISSING_OUT" if not last_out else "PRESENT")
            rows.append({
                "WorkDate": target_date,
                "EmployeeATID": atid,
                "FullName": info["FullName"],
                "DepartmentName": info["DepartmentName"],
                "FirstInTime": first_in,
                "LastOutTime": last_out,
                "TotalScans": total_scans,
                "LateMinutes": late_mins,
                "TotalHours": total_hours,
                "WorkUnit": work_unit,
                "AttendanceStatus": status
            })
    else:
        raw_dtk = db_mssql.get_table_rows("tbl_DailyTimekeeping", limit=500)
        for r in raw_dtk:
            th = float(r.get("TotalHours") or 0.0)
            r["WorkUnit"] = 1.0 if th >= 7.5 else (0.5 if th >= 3.5 else 0.0)
            rows.append(r)

    if dept_filter:
        rows = [r for r in rows if str(r.get("DepartmentName") or "") == dept_filter]
    if q_filter:
        rows = [
            r for r in rows
            if q_filter in f"{r.get('FullName','')} {r.get('EmployeeATID','')} {r.get('DepartmentName','')}".lower()
        ]

    rows.sort(key=lambda x: (str(x.get("WorkDate", "")), str(x.get("FirstInTime", ""))), reverse=True)
    return jsonify({"success": True, "count": len(rows), "rows": rows})


@app.route("/api/attendance/shift", methods=["POST"])
@require_role(["admin", "staff"])
def api_upsert_shift():
    import db_mssql
    data = request.get_json(silent=True) or {}
    res = db_mssql.upsert_shift_db(data)
    return jsonify(res), (200 if res.get("success") else 400)


@app.route("/api/sharepoint/vms_status", methods=["GET"])
def api_sharepoint_vms_status():
    import sharepoint_vms_sync
    return jsonify(sharepoint_vms_sync.get_vms_sharepoint_status())


@app.route("/api/sharepoint/connect_account", methods=["POST"])
@require_role(["admin"])
def api_sharepoint_connect_account():
    """Triggers interactive Microsoft 365 OAuth2 login on the server PC if no cached token is found."""
    import sharepoint_vms_sync
    tok = sharepoint_vms_sync.get_sharepoint_tokens(allow_interactive=True)
    return jsonify({
        "success": bool(tok.get("ok")),
        "account": tok.get("account"),
        "cache_path": tok.get("cache_path"),
        "error": tok.get("error")
    })


@app.route("/api/sharepoint/provision_lists", methods=["POST"])
@require_role(["admin"])
def api_sharepoint_provision_lists():
    import sharepoint_vms_sync
    data = request.get_json(silent=True) or {}
    tables = data.get("tables")
    return jsonify(sharepoint_vms_sync.provision_vms_sharepoint_lists(selected_tables=tables))


@app.route("/api/sharepoint/sync_table", methods=["POST"])
@require_role(["admin"])
def api_sharepoint_sync_table():
    import sharepoint_vms_sync
    data = request.get_json(silent=True) or {}
    sql_table = str(data.get("sql_table") or "tbl_Departments").strip()
    max_rows = int(data.get("max_rows") or 200)
    return jsonify(sharepoint_vms_sync.sync_table_to_sharepoint(sql_table, max_rows=max_rows))


@app.route("/api/sharepoint/sync_all", methods=["POST"])
@require_role(["admin"])
def api_sharepoint_sync_all():
    import sharepoint_vms_sync
    data = request.get_json(silent=True) or {}
    att_lim = int(data.get("attendance_limit") or 350)
    tk_lim = int(data.get("timekeeping_limit") or 400)
    return jsonify(sharepoint_vms_sync.sync_all_active_lists(full_attendance_limit=att_lim, timekeeping_limit=tk_lim))


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
