"""
Tool Đăng Nhập & Tạo Token SharePoint Online (Microsoft 365)
Dành cho Hệ Thống Kiểm Soát Cửa SeaZen Smart Access Control
Hoạt động tương tự như ứng dụng Canteen Kiosk.
"""

import os
import sys
import msal
import requests
import webbrowser

TENANT_ID = "29101901-3778-4339-827c-7d2b50914db0"
CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"  # Azure CLI Client ID
SCOPES = ["https://graph.microsoft.com/.default"]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_CACHE_FILE = os.path.join(BASE_DIR, "token_cache.bin")


def nhap_mat_khau_co_sao(prompt="Nhập Mật khẩu: "):
    """Cho phép gõ mật khẩu hiển thị dấu hoa thị * và có thể Backspace xóa"""
    try:
        import msvcrt
        sys.stdout.write(prompt)
        sys.stdout.flush()
        pwd = []
        while True:
            ch = msvcrt.getch()
            # Enter (CR hoặc LF)
            if ch in (b'\r', b'\n'):
                sys.stdout.write('\n')
                sys.stdout.flush()
                break
            # Ctrl+C
            elif ch == b'\x03':
                sys.stdout.write('\n')
                raise KeyboardInterrupt
            # Backspace
            elif ch in (b'\x08', b'\x7f'):
                if pwd:
                    pwd.pop()
                    sys.stdout.write('\b \b')
                    sys.stdout.flush()
            # Phím đặc biệt trên Windows
            elif ch in (b'\x00', b'\xe0'):
                msvcrt.getch()
            else:
                try:
                    char = ch.decode('utf-8')
                    pwd.append(char)
                    sys.stdout.write('*')
                    sys.stdout.flush()
                except Exception:
                    pass
        return "".join(pwd)
    except Exception:
        import getpass
        return getpass.getpass(prompt)


def test_token(access_token):
    """Kiểm tra gọi thử Graph API để lấy thông tin tài khoản"""
    try:
        res = requests.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=5
        )
        if res.status_code == 200:
            user_info = res.json()
            return user_info.get("displayName"), user_info.get("userPrincipalName")
    except Exception:
        pass
    return None, None


def main():
    print("=" * 70)
    print("   CÔNG CỤ ĐĂNG NHẬP / TẠO TOKEN SHAREPOINT ONLINE (MICROSOFT 365)")
    print("   HỆ THỐNG KIỂM SOÁT CỬA RA VÀO SEAZEN SMART ACCESS CONTROL")
    print("=" * 70)
    print()
    print("[1] Đăng nhập trực tiếp bằng Email & Mật khẩu trên CMD (Nhanh nhất)")
    print("[2] Đăng nhập qua trình duyệt bằng Mã xác nhận (Device Code - Khuyên dùng nếu có MFA)")
    print()

    chon = input("Chọn phương thức [1 hoặc 2, mặc định 1]: ").strip() or "1"

    cache = msal.SerializableTokenCache()
    if os.path.exists(TOKEN_CACHE_FILE):
        try:
            with open(TOKEN_CACHE_FILE, "r", encoding="utf-8") as f:
                cache.deserialize(f.read())
        except Exception:
            pass

    app = msal.PublicClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
        token_cache=cache
    )

    if chon == "1":
        print("\n--- ĐĂNG NHẬP TRỰC TIẾP TRÊN CMD ---")
        username = input("Nhập Email Microsoft (@seazen.com.vn): ").strip()
        if not username:
            print("[-] Email không được để trống!")
            input("\nNhấn Enter để thoát...")
            return

        password = nhap_mat_khau_co_sao("Nhập Mật khẩu (hiển thị dấu *): ")
        if not password:
            print("[-] Mật khẩu không được để trống!")
            input("\nNhấn Enter để thoát...")
            return

        print("\n[*] Đang gửi yêu cầu xác thực trực tiếp tới Microsoft...")
        res = app.acquire_token_by_username_password(username, password, scopes=SCOPES)

        if res and "access_token" in res:
            with open(TOKEN_CACHE_FILE, "w", encoding="utf-8") as f:
                f.write(cache.serialize())

            name, upn = test_token(res["access_token"])
            print("\n" + "=" * 70)
            print(" [+] ĐĂNG NHẬP SHAREPOINT MICROSOFT THÀNH CÔNG!")
            print(f" [+] Tên hiển thị : {name or 'N/A'}")
            print(f" [+] Email/UPN    : {upn or username}")
            print(f" [+] File token đã được lưu tại:")
            print(f"     {TOKEN_CACHE_FILE}")
            print("=" * 70)
            print("\n[OK] Hệ thống kiểm soát cửa hiện đã có Token để kết nối SharePoint!")
            input("\nNhấn Enter để hoàn tất...")
            return

        err_desc = res.get("error_description", "")
        err_code = res.get("error", "")

        # Kiểm tra nếu tài khoản có bật bảo mật 2 lớp MFA
        if any(k in err_desc for k in ["AADSTS50076", "AADSTS50079", "MFA", "multi-factor"]):
            print("\n" + "-" * 70)
            print("[!] THÔNG BÁO: Tài khoản của bạn có bật Bảo mật 2 lớp (MFA / Authenticator).")
            print("[*] Chính sách bảo mật Microsoft yêu cầu xác thực qua trình duyệt để nhận OTP.")
            print("[*] Đang tự động chuyển sang chế độ Device Code...")
            print("-" * 70)
        else:
            print(f"\n[-] Đăng nhập trên CMD thất bại: {err_desc or err_code}")
            print("[*] Bạn có muốn thử đăng nhập qua Trình duyệt (Device Code) không? (Y/N): ", end="")
            ans = input().strip().lower()
            if ans not in ("y", "yes", ""):
                input("\nNhấn Enter để thoát...")
                return

    # Phương thức 2: Device Code Flow
    print("\n--- ĐĂNG NHẬP QUA TRÌNH DUYỆT (DEVICE CODE) ---")
    flow = app.initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        print("[!] Không thể khởi tạo Device Code Flow:", flow)
        input("\nNhấn Enter để thoát...")
        return

    user_code = flow['user_code']
    login_url = flow['verification_uri']

    print("\n" + "=" * 70)
    print(" 👉 HƯỚNG DẪN XÁC NHẬN:")
    print("=" * 70)
    print(f" 1. Hệ thống đã tự động mở trình duyệt (hoặc truy cập: {login_url})")
    print(f" 2. Nhập chính xác mã xác nhận sau: >>>  {user_code}  <<<")
    print(" 3. Đăng nhập tài khoản Microsoft 365 của bạn và bấm Tiếp tục.")
    print("=" * 70)
    print("\n[*] Đang chờ bạn xác nhận trên trình duyệt...")

    try:
        webbrowser.open(login_url)
    except Exception:
        pass

    res_dev = app.acquire_token_by_device_flow(flow)
    if res_dev and "access_token" in res_dev:
        acc_name = (
            res_dev.get("id_token_claims", {}).get("preferred_username") or
            res_dev.get("id_token_claims", {}).get("upn") or
            "Tài khoản Microsoft"
        )
        with open(TOKEN_CACHE_FILE, "w", encoding="utf-8") as f:
            f.write(cache.serialize())

        name, upn = test_token(res_dev["access_token"])
        print("\n" + "=" * 70)
        print(" [+] XÁC THỰC SHAREPOINT MICROSOFT THÀNH CÔNG!")
        print(f" [+] Tên hiển thị : {name or 'N/A'}")
        print(f" [+] Email/UPN    : {upn or acc_name}")
        print(f" [+] Đã lưu file token tại:")
        print(f"     {TOKEN_CACHE_FILE}")
        print("=" * 70)
        print("\n[OK] Hệ thống kiểm soát cửa hiện đã có Token để kết nối SharePoint!")
    else:
        print(f"\n[-] Đăng nhập thất bại: {res_dev.get('error_description')}")

    print()
    input("Nhấn Enter để hoàn tất...")


if __name__ == "__main__":
    main()
