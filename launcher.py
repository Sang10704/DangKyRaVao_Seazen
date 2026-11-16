"""
SeaZen VMS Smart Access Control - Instant Launcher
- Automatically frees any stale process on port 6868
- Verifies Vietnam Standard Time (NTP UTC+7) on startup
- Starts the 24/7 Waitress server + 4 ZKTeco TCP 4370 live_capture threads
- Opens the application window directly into /live without asking questions
- Keeps the console alive 24/7 so it never closes by itself
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


def is_port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.0)
        return s.connect_ex((host, port)) == 0


def free_stale_port(port: int) -> None:
    """Terminates any previous Python process holding port 6868 so this console owns the server."""
    if sys.platform != "win32" or not is_port_open("127.0.0.1", port):
        return
    try:
        my_pid = os.getpid()
        cmd = (
            f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.OwningProcess -ne {my_pid} }} | "
            f"ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", cmd], timeout=5, capture_output=True)
        time.sleep(0.8)
    except Exception:
        pass


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
    url = f"http://127.0.0.1:{port}/live"

    print("=" * 78)
    print("  SEAZEN VMS v2.0 - HE THONG KIEM SOAT RA VAO & SINH TRAC HOC")
    print("=" * 78)

    # 1. Cleanly free any old background instance on port 6868
    free_stale_port(port)

    # 2. Import app (starts 4 ZKTeco TCP 4370 live_capture threads) & check Vietnam NTP Clock
    from app import app, zk_client
    try:
        audit = zk_client.audit_all_clocks()
        print(f"  [NTP UTC+7] Gio chuan Viet Nam : {audit.get('vietnam_ntp_time')}")
        print(f"  [LOCAL PC ] Gio may tinh cuc bo: {audit.get('local_pc_time')} (Lech: {audit.get('pc_drift_sec')}s)")
        if not audit.get("pc_clock_valid", True):
            print("  " + "!" * 72)
            print("  [CANH BAO DO] GIO MAY TINH CUC BO DANG LECH SO VOI GIO CHUAN VIET NAM!")
            print("  -> He thong DA KHOA tu dong ghi de gio de bao ve 4 may quet mat ZKTeco.")
            print("  " + "!" * 72)
        else:
            print("  [AN TOAN  ] Dong ho may tinh khop chuan Gio Viet Nam (Sai so <= 30s).")
    except Exception as e:
        print(f"  [Clock Guard] Kiem tra gio ban dau: {e}")

    # 3. Start Waitress Server on port 6868
    if not is_port_open("127.0.0.1", port):
        from waitress import serve

        def _run_server():
            serve(app, host="0.0.0.0", port=port, threads=16, channel_timeout=60)

        t = threading.Thread(target=_run_server, daemon=True)
        t.start()

        for _ in range(30):
            if is_port_open("127.0.0.1", port):
                break
            time.sleep(0.2)

    print(f"  [SERVER   ] May chu SeaZen VMS dang hoat dong tai: {url}")

    # 4. Open application window directly into /live
    if devtest_mode:
        print(f"  [BROWSER  ] Dang mo trinh duyet tai {url} ...")
        webbrowser.open(url)
    else:
        print(f"  [APP      ] Dang mo giao dien he thong tai {url} ...")
        if not launch_webview_app_window(url):
            webbrowser.open(url)

    print("\n  >>> HE THONG DANG LANG NGHE TRUC TIEP 4 MAY CUA ZKTECO 24/7 <<<")
    print("  (Giu cua so nay mo de nhan su kien quet mat/the tuc thoi. Nhan Ctrl+C de dung)\n")
    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n  Da dung he thong SeaZen VMS.")


if __name__ == "__main__":
    main()
