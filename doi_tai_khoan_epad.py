"""
Tool Đổi Tài Khoản ePAD cho Hệ Thống SeaZen Door Access
Tự động kiểm tra đăng nhập trước khi lưu vào config.json
"""

import os
import sys
import json
import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")


def nhap_mat_khau_co_sao(prompt="Nhập Mật khẩu mới: "):
    """Cho phép gõ mật khẩu hiển thị dấu * và có thể Backspace xóa"""
    try:
        import msvcrt
        sys.stdout.write(prompt)
        sys.stdout.flush()
        pwd = []
        while True:
            ch = msvcrt.getch()
            if ch in (b'\r', b'\n'):
                sys.stdout.write('\n')
                sys.stdout.flush()
                break
            elif ch == b'\x03':
                sys.stdout.write('\n')
                raise KeyboardInterrupt
            elif ch in (b'\x08', b'\x7f'):
                if pwd:
                    pwd.pop()
                    sys.stdout.write('\b \b')
                    sys.stdout.flush()
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


def main():
    print("=" * 70)
    print("   CÔNG CỤ ĐỔI TÀI KHOẢN HỆ THỐNG CỬA EPAD - SEAZEN DOOR ACCESS")
    print("=" * 70)
    print()

    if not os.path.exists(CONFIG_FILE):
        print(f"[-] Lỗi: Không tìm thấy file cấu hình {CONFIG_FILE}")
        input("\nNhấn Enter để thoát...")
        return

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)

    epad_cfg = config.get("epad", {})
    api_base = epad_cfg.get("api_base", "http://172.16.56.2:4001/api").rstrip("/")
    current_user = epad_cfg.get("username", "(Chưa thiết lập)")

    print(f"[*] Máy chủ ePAD hiện tại: {api_base}")
    print(f"[*] Tài khoản đang cấu hình: {current_user}")
    print()
    print("--- NHẬP THÔNG TIN TÀI KHOẢN MỚI ---")
    new_username = input("Nhập Email / Tài khoản mới: ").strip()
    if not new_username:
        print("[-] Bạn chưa nhập tài khoản. Hủy bỏ thay đổi.")
        input("\nNhấn Enter để thoát...")
        return

    new_password = nhap_mat_khau_co_sao("Nhập Mật khẩu mới (hiển thị dấu *): ")
    if not new_password:
        print("[-] Mật khẩu không được để trống. Hủy bỏ thay đổi.")
        input("\nNhấn Enter để thoát...")
        return

    print(f"\n[*] Đang kiểm tra đăng nhập tài khoản '{new_username}' tới ePAD...")
    login_url = f"{api_base}/login"
    login_payload = {
        "grant_type": "password",
        "UserName": new_username,
        "Password": new_password
    }

    try:
        resp = requests.post(login_url, json=login_payload, timeout=6)
        if resp.status_code == 200 and "access_token" in resp.json():
            token_data = resp.json()
            expires = token_data.get("expires_in", 86400)
            print("\n" + "=" * 70)
            print(" [+] XÁC THỰC THÀNH CÔNG VỚI MÁY CHỦ EPAD!")
            print(f" [+] Quyền truy cập hợp lệ (Token có hạn trong {expires} giây)")
            print("=" * 70)

            # Cập nhật file config.json
            config["epad"]["username"] = new_username
            config["epad"]["password"] = new_password

            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)

            print(f"\n[OK] Đã lưu thông tin tài khoản mới vào file config.json thành công!")
            print("[*] Vui lòng khởi động lại hệ thống (CHAY_HE_THONG_CUA.bat) để áp dụng tài khoản mới.")
        else:
            print("\n" + "!" * 70)
            print(" [-] ĐĂNG NHẬP THẤT BẠI!")
            print(f" [-] Mã lỗi HTTP: {resp.status_code}")
            print(f" [-] Phản hồi từ ePAD: {resp.text}")
            print(" [-] File config.json ĐƯỢC GIỮ NGUYÊN để không làm gián đoạn hệ thống.")
            print("!" * 70)
    except Exception as e:
        print(f"\n[-] Không thể kết nối tới máy chủ ePAD tại {api_base}: {e}")
        print("[-] File config.json ĐƯỢC GIỮ NGUYÊN.")

    print()
    input("Nhấn phím Enter để hoàn tất...")


if __name__ == "__main__":
    main()
