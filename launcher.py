"""
SeaZen VMS Smart Access Control - Production & Dev Launcher
- Single-instance Windows Mutex protection (never kills a healthy running server on double-click)
- Headless / System Tray mode (no black console window for staff to accidentally close)
- Acquires / refreshes Microsoft 365 SharePoint OAuth2 Bearer Token on Server PC only
- Parallel Dev mode (--dev on port 6869) isolated from Production (port 6868)
"""

import os
import sys
import time
import socket
import ctypes
import logging
import subprocess
import threading
import webbrowser
from logging.handlers import RotatingFileHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)


class _TeeStream:
    """Safely routes print() output to log file when running under pythonw.exe (no console)."""
    _write_lock = threading.Lock()

    def __init__(self, log_file_path: str, orig_stream=None):
        self.orig = orig_stream
        self.log_file_path = log_file_path

    def write(self, msg):
        if self.orig is not None:
            try:
                self.orig.write(msg)
            except Exception:
                pass
        if msg:
            try:
                with _TeeStream._write_lock:
                    with open(self.log_file_path, "a", encoding="utf-8", errors="replace") as f:
                        f.write(msg)
            except Exception:
                pass

    def flush(self):
        if self.orig is not None:
            try:
                self.orig.flush()
            except Exception:
                pass


def _setup_logging(is_dev: bool) -> str:
    logs_dir = os.path.join(BASE_DIR, "logs")
    os.makedirs(logs_dir, exist_ok=True)
    log_name = "server_dev.log" if is_dev else "server.log"
    log_path = os.path.join(logs_dir, log_name)

    if sys.platform == "win32":
        for stream_name in ("stdout", "stderr"):
            s = getattr(sys, stream_name, None)
            if s is not None:
                try:
                    s.reconfigure(encoding="utf-8", errors="replace")
                except Exception:
                    pass

    sys.stdout = _TeeStream(log_path, sys.stdout)
    sys.stderr = _TeeStream(log_path, sys.stderr)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    if not any(isinstance(h, RotatingFileHandler) for h in root_logger.handlers):
        fh = RotatingFileHandler(log_path, maxBytes=10 * 1024 * 1024, backupCount=3, encoding="utf-8", delay=True)
        fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
        root_logger.addHandler(fh)
    return log_path


def get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("172.16.56.139", 4370))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def ensure_lan_firewall_port(port: int = 6868) -> None:
    """Ensures Windows Firewall allows inbound TCP connections on port 6868 from LAN machines."""
    if sys.platform != "win32":
        return
    try:
        subprocess.run(
            [
                "netsh", "advfirewall", "firewall", "add", "rule",
                f"name=SeaZen_VMS_Port_{port}",
                "dir=in", "action=allow", "protocol=TCP", f"localport={port}",
            ],
            timeout=4,
            capture_output=True,
        )
    except Exception:
        pass


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex((host, port)) == 0


def free_stale_port(port: int) -> None:
    """Terminates any previous Python process holding the target port (used ONLY on explicit --restart)."""
    if sys.platform != "win32":
        return
    my_pid = os.getpid()
    for _ in range(3):
        if not is_port_open("127.0.0.1", port):
            return
        try:
            out = subprocess.check_output(["netstat", "-ano", "-p", "TCP"], text=True, timeout=4)
            pids_to_kill = set()
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[1].endswith(f":{port}") and parts[3].upper() == "LISTENING":
                    pid = int(parts[4])
                    if pid != my_pid and pid > 0:
                        pids_to_kill.add(pid)
            for pid in pids_to_kill:
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], timeout=4, capture_output=True)
            time.sleep(0.5)
        except Exception:
            break


def acquire_single_instance_mutex(mutex_name: str):
    """Acquires a named Windows Mutex; returns (handle, already_running_bool)."""
    if sys.platform != "win32":
        return None, False
    try:
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, mutex_name)
        ERROR_ALREADY_EXISTS = 183
        already_exists = kernel32.GetLastError() == ERROR_ALREADY_EXISTS
        return handle, already_exists
    except Exception:
        return None, False


def launch_webview_app_window(url: str) -> bool:
    """Launches a native-like desktop WebView window using Edge or Chrome App Mode."""
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    profile_dir = os.path.join(BASE_DIR, "data", ".webview_profile")
    os.makedirs(profile_dir, exist_ok=True)

    for exe in candidates:
        if os.path.isfile(exe):
            try:
                subprocess.Popen([
                    exe,
                    f"--app={url}",
                    f"--user-data-dir={profile_dir}",
                    "--window-size=1540,940",
                    "--disable-features=Translate",
                    "--no-first-run",
                ])
                return True
            except Exception:
                continue
    return False


def _open_ui(url: str, use_browser_tab: bool = False) -> None:
    if use_browser_tab:
        webbrowser.open(url)
    elif not launch_webview_app_window(url):
        webbrowser.open(url)


def _create_tray_image():
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (17, 17, 17, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([4, 4, 60, 60], radius=14, fill=(17, 24, 39, 255), outline=(217, 119, 6, 255), width=3)
    draw.text((19, 20), "SZ", fill=(251, 191, 36, 255))
    return img


def _run_system_tray(url: str, port: int) -> bool:
    """Runs Windows System Tray icon; returns False if pystray is unavailable."""
    try:
        import pystray
    except Exception:
        return False

    def on_open_ui(icon, item):
        _open_ui(url, use_browser_tab=False)

    def on_m365_auth(icon, item):
        def _bg():
            try:
                import sharepoint_vms_sync
                tok = sharepoint_vms_sync.get_sharepoint_tokens(allow_interactive=True)
                msg = (
                    f"Đã kết nối Microsoft 365: {tok.get('account')}"
                    if tok.get("ok")
                    else f"Chưa lấy được token M365: {tok.get('error')}"
                )
            except Exception as exc:
                msg = f"Lỗi kiểm tra Microsoft 365: {exc}"
            if sys.platform == "win32":
                ctypes.windll.user32.MessageBoxW(0, msg, "SeaZen VMS — Microsoft 365 Token", 0x40)
        threading.Thread(target=_bg, daemon=True).start()

    def on_exit_server(icon, item):
        if sys.platform == "win32":
            # MB_YESNO (0x04) | MB_ICONWARNING (0x30) | MB_DEFBUTTON2 (0x100)
            res = ctypes.windll.user32.MessageBoxW(
                0,
                f"Xác nhận TẮT máy chủ SeaZen VMS (cổng {port})?\nCác máy Lễ tân trong mạng LAN sẽ mất kết nối nếu tắt.",
                "Xác nhận tắt SeaZen VMS Server",
                0x04 | 0x30 | 0x100,
            )
            if res != 6:  # IDYES = 6
                return
        icon.stop()
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem(f"SeaZen VMS đang chạy (:{port})", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Mở giao diện SeaZen VMS", on_open_ui, default=True),
        pystray.MenuItem("Đăng nhập / Kiểm tra Microsoft 365 (Server)", on_m365_auth),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Tắt Server (Yêu cầu xác nhận)", on_exit_server),
    )
    icon = pystray.Icon("SeaZenVMS", _create_tray_image(), f"SeaZen VMS Server (:{port})", menu)
    icon.run()
    return True


def main():
    is_dev = "--dev" in sys.argv or os.environ.get("VMS_ENV", "").strip().lower() == "dev"
    devtest_mode = "--devtest" in sys.argv or "-d" in sys.argv
    force_restart = "--restart" in sys.argv
    no_browser = "--no-browser" in sys.argv
    no_tray = "--no-tray" in sys.argv or is_dev

    if is_dev:
        os.environ["VMS_ENV"] = "dev"
        port = 6869
        bind_host = "127.0.0.1"
        mutex_name = "Global\\SeaZenVMS_Dev_6869"
    else:
        os.environ["VMS_ENV"] = "prod"
        port = 6868
        bind_host = "0.0.0.0"
        mutex_name = "Global\\SeaZenVMS_Prod_6868"

    _setup_logging(is_dev)
    lan_ip = get_lan_ip()
    url = f"http://127.0.0.1:{port}"
    lan_url = f"http://{lan_ip}:{port}"

    # 1. Single-Instance Guard: NEVER kill an existing healthy server unless --restart is explicitly given
    _mutex_handle, already_exists = acquire_single_instance_mutex(mutex_name)
    if (already_exists or is_port_open("127.0.0.1", port)) and not force_restart:
        print(f"[SeaZen VMS] Server da dang chay tren cong {port}. Khong kill task — chi mo lai giao dien.")
        if not no_browser:
            _open_ui(url, use_browser_tab=is_dev or devtest_mode)
        return

    print("=" * 78)
    print(f"  SEAZEN VMS v2.0 - {'DEV MODE (6869)' if is_dev else 'PRODUCTION SERVER (6868)'}")
    print("=" * 78)

    if force_restart:
        free_stale_port(port)

    if not is_dev:
        ensure_lan_firewall_port(port)

    # 2. Verify / Acquire Microsoft 365 SharePoint Token ONLY interactively when a browser UI is allowed;
    #    in headless (--no-browser / VBS) startup, NEVER block waitress port 6868 waiting for interactive login!
    if not is_dev:
        try:
            import sharepoint_vms_sync
            sp_tok = sharepoint_vms_sync.get_sharepoint_tokens(allow_interactive=not no_browser)
            if sp_tok.get("ok"):
                print(f"  [SHAREPOINT] Da ket noi Microsoft 365 ({sp_tok.get('account')}) -> Dong bo SharePoint VMS")
            else:
                print(f"  [SHAREPOINT] Canh bao token: {sp_tok.get('error')}")
        except Exception as sp_e:
            print(f"  [SHAREPOINT] Kiem tra token: {sp_e}")

    # 3. Import app (Harvester & SharePoint Reconciler are auto-disabled when VMS_ENV=dev)
    from app import app, zk_client
    if not is_dev:
        try:
            audit = zk_client.audit_all_clocks()
            print(f"  [NTP UTC+7 ] Gio chuan Viet Nam : {audit.get('vietnam_ntp_time')}")
            print(f"  [LOCAL PC  ] Gio may tinh cuc bo: {audit.get('local_pc_time')} (Lech: {audit.get('pc_drift_sec')}s)")
        except Exception as e:
            print(f"  [Clock Guard] Kiem tra gio ban dau: {e}")

    # 4. Start Waitress Server
    if not is_port_open("127.0.0.1", port):
        from waitress import serve

        def _run_server():
            serve(app, host=bind_host, port=port, threads=24, channel_timeout=60)

        t = threading.Thread(target=_run_server, daemon=True)
        t.start()

        for _ in range(30):
            if is_port_open("127.0.0.1", port):
                break
            time.sleep(0.2)

    print("-" * 78)
    print(f"  [1] Truy cap tai MAY SERVER NAY : {url}")
    if not is_dev:
        host_name = socket.gethostname()
        print(f"  [2] Truy cap tu MAY LE TAN (IP) : {lan_url}")
        print(f"  [3] Truy cap theo TEN MAY (LAN): http://{host_name}:{port}  (Hoac http://{host_name}.local:{port})")
    print("-" * 78)

    # 5. Open application window unless --no-browser is passed
    if not no_browser:
        _open_ui(url, use_browser_tab=is_dev or devtest_mode)

    # 6. Keep server alive via System Tray (or silent loop)
    if not no_tray and _run_system_tray(url, port):
        return

    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n  Da dung he thong SeaZen VMS.")


if __name__ == "__main__":
    main()
