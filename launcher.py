"""
SeaZen VMS Smart Access Control - Instant Launcher
- Automatically frees any stale process on port 6868
- Opens Windows Firewall port 6868 for LAN multi-machine access
- Acquires / refreshes Microsoft 365 SharePoint OAuth2 Bearer Token (auto interactive on new server PC)
- Verifies Vietnam Standard Time (NTP UTC+7) on startup
- Starts the 24/7 Waitress server + 4 ZKTeco TCP 4370 live_capture threads
"""

import os
import sys
import time
import socket
import subprocess
import threading
import webbrowser

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)


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
                "dir=in", "action=allow", "protocol=TCP", f"localport={port}"
            ],
            timeout=4,
            capture_output=True
        )
    except Exception:
        pass


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex((host, port)) == 0


def free_stale_port(port: int) -> None:
    """Terminates any previous Python process holding port 6868 using fast netstat + taskkill."""
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
                if len(parts) >= 5 and f":{port}" in parts[1] and parts[3].upper() == "LISTENING":
                    pid = int(parts[4])
                    if pid != my_pid and pid > 0:
                        pids_to_kill.add(pid)
            for pid in pids_to_kill:
                subprocess.run(["taskkill", "/F", "/PID", str(pid)], timeout=4, capture_output=True)
            time.sleep(0.5)
        except Exception:
            break


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


def main():
    devtest_mode = "--devtest" in sys.argv or "-d" in sys.argv
    port = 6868
    lan_ip = get_lan_ip()
    url = f"http://127.0.0.1:{port}"
    lan_url = f"http://{lan_ip}:{port}"

    print("=" * 78)
    print("  SEAZEN VMS v2.0 - HE THONG KIEM SOAT RA VAO & SINH TRAC HOC")
    print("=" * 78)

    # 1. Cleanly free any old background instance & open LAN firewall port 6868
    free_stale_port(port)
    ensure_lan_firewall_port(port)

    # 2. Verify / Acquire Microsoft 365 SharePoint Token (auto interactive if moved to new server PC)
    try:
        import sharepoint_vms_sync
        sp_tok = sharepoint_vms_sync.get_sharepoint_tokens(allow_interactive=True)
        if sp_tok.get("ok"):
            print(f"  [SHAREPOINT] Da ket noi Microsoft 365 ({sp_tok.get('account')}) -> Dong bo SharePoint VMS")
        else:
            print(f"  [SHAREPOINT] Canh bao token: {sp_tok.get('error')}")
    except Exception as sp_e:
        print(f"  [SHAREPOINT] Kiem tra token: {sp_e}")

    # 3. Import app (starts 4 ZKTeco TCP 4370 live_capture threads) & check Vietnam NTP Clock
    from app import app, zk_client
    try:
        audit = zk_client.audit_all_clocks()
        print(f"  [NTP UTC+7 ] Gio chuan Viet Nam : {audit.get('vietnam_ntp_time')}")
        print(f"  [LOCAL PC  ] Gio may tinh cuc bo: {audit.get('local_pc_time')} (Lech: {audit.get('pc_drift_sec')}s)")
        if not audit.get("pc_clock_valid", True):
            print("  " + "!" * 72)
            print("  [CANH BAO DO] GIO MAY TINH CUC BO DANG LECH SO VOI GIO CHUAN VIET NAM!")
            print("  -> He thong DA KHOA tu dong ghi de gio de bao ve 4 may quet mat ZKTeco.")
            print("  " + "!" * 72)
        else:
            print("  [AN TOAN   ] Dong ho may tinh khop chuan Gio Viet Nam (Sai so <= 30s).")
    except Exception as e:
        print(f"  [Clock Guard] Kiem tra gio ban dau: {e}")

    # 4. Start Waitress Server on 0.0.0.0:6868 (Accessible across all LAN computers)
    if not is_port_open("127.0.0.1", port):
        from waitress import serve

        def _run_server():
            serve(app, host="0.0.0.0", port=port, threads=24, channel_timeout=60)

        t = threading.Thread(target=_run_server, daemon=True)
        t.start()

        for _ in range(30):
            if is_port_open("127.0.0.1", port):
                break
            time.sleep(0.2)

    print("-" * 78)
    print(f"  [1] Truy cap tai MAY SERVER NAY : {url}")
    print(f"  [2] Truy cap tu MAY LE TAN (LAN): {lan_url}")
    print(f"  [3] Tai khoan Toan Quyen (Admin): SeazenAdmin  | Mat khau: SeazenAdmin@1516")
    print(f"  [4] Tai khoan Ban Le Tan        : Letan        | Mat khau: Letan@1516 (Chi trang Dang ky Khach)")
    print("-" * 78)

    # 5. Open application window
    if devtest_mode:
        webbrowser.open(url)
    else:
        if not launch_webview_app_window(url):
            webbrowser.open(url)

    print("\n  >>> HE THONG DANG CHAY 24/7 & DONG BO SHAREPOINT TRUC TUYEN <<<")
    print("  (Giu cua so nay mo de cac may trong mang LAN truy cap. Nhan Ctrl+C de dung)\n")
    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n  Da dung he thong SeaZen VMS.")


if __name__ == "__main__":
    main()
