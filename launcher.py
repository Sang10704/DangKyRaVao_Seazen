"""
SeaZen VMS Smart Access Control - Dual Runtime Launcher
Supports:
1. Default Mode (Native Desktop WebView Window via Edge/Chrome --app mode)
2. DevTest Mode (--devtest flag: Opens in standard browser for inspection/testing)
Includes mandatory Startup Vietnam Standard Time (NTP UTC+7) Clock Verification.
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


def launch_webview_app_window(url: str) -> bool:
    """Launches a chromeless native-like desktop WebView window using Edge or Chrome App Mode."""
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
                    "--window-size=1520,940",
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
    url = f"http://127.0.0.1:{port}"

    print("=" * 78)
    print("  SEAZEN VMS v2.0 - HE THONG KIEM SOAT RA VAO & SINH TRAC HOC")
    print("  Che do khoi chay:", "DEVTEST BROWSER MODE" if devtest_mode else "DESKTOP WEBVIEW APP MODE")
    print("=" * 78)

    # 1. Mandatory Startup Clock Verification against Vietnam Standard Time (NTP UTC+7)
    try:
        from app import zk_client
        audit = zk_client.audit_all_clocks()
        print(f"  [NTP UTC+7] Gio chuan Viet Nam : {audit.get('vietnam_ntp_time')}")
        print(f"  [LOCAL PC ] Gio may tinh cuc bo: {audit.get('local_pc_time')} (Lech: {audit.get('pc_drift_sec')}s)")
        if not audit.get("pc_clock_valid", True):
            print("  " + "!" * 72)
            print("  [CANH BAO DO] GIO MAY TINH CUC BO DANG LECH SO VOI GIO CHUAN VIET NAM!")
            print("  -> Vui long chinh lai gio Windows tren thiet bi nay.")
            print("  -> He thong DA KHOA tu dong ghi de gio de bao ve 4 may quet mat ZKTeco.")
            print("  " + "!" * 72)
        else:
            print("  [AN TOAN  ] Dong ho may tinh khop chuan Gio Viet Nam (Sai so <= 30s).")
    except Exception as e:
        print(f"  [Clock Guard] Canh bao kiem tra gio ban dau: {e}")

    # 2. Start Waitress Server if not already running on port 6868
    already_running = is_port_open("127.0.0.1", port)
    if not already_running:
        from app import app
        from waitress import serve

        def _run_server():
            serve(app, host="0.0.0.0", port=port, threads=16, channel_timeout=60)

        t = threading.Thread(target=_run_server, daemon=True)
        t.start()

        for _ in range(30):
            if is_port_open("127.0.0.1", port):
                break
            time.sleep(0.25)
    else:
        print(f"  [SERVER   ] May chu SeaZen VMS da chay san tai {url}")

    # 3. Open UI in requested runtime mode
    if devtest_mode:
        print(f"  [BROWSER  ] Dang mo trinh duyet kiem thu DevTest tai {url} ...")
        webbrowser.open(url)
    else:
        print(f"  [WEBVIEW  ] Dang khoi chay cua so Desktop WebView tai {url} ...")
        if not launch_webview_app_window(url):
            webbrowser.open(url)

    if not already_running:
        print("\n  He thong dang hoat dong 24/7. Nhan Ctrl+C de dung may chu.")
        try:
            while True:
                time.sleep(2)
        except KeyboardInterrupt:
            print("\n  Da dung he thong SeaZen VMS.")


if __name__ == "__main__":
    main()
