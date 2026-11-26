"""
ePAD API Client for SeaZen Smart Access Control
Handles authentication, token refresh, remote door unlocking,
RFID visitor card provisioning and real-time attendance logs.
"""

import requests
import json
import time
from datetime import datetime
import logging
import threading
from typing import Dict, Any, List, Optional

logger = logging.getLogger("epad_client")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


class EpadClient:
    def __init__(self, config: Dict[str, Any]):
        epad_cfg = config.get("epad", {}) if "epad" in config else config
        self.api_base = epad_cfg.get("api_base", "http://172.16.56.2:4001/api").rstrip("/")
        # NEVER use human reception account (Thuan.Trinh@seazen.com.vn) to avoid kicking out reception web session.
        # Always use stateless internal ServiceId=1 credentials ("123" / "123").
        self.username = "123"
        self.password = "123"
        self.timeout = epad_cfg.get("timeout_sec", 6)
        
        self.doors_config = config.get("doors", [])
        
        self.access_token: Optional[str] = None
        self.token_expiry_timestamp: float = 0.0
        self._auth_lock = threading.Lock()

        # High-performance persistent HTTP session with connection pooling
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Origin": "http://172.16.56.2:4001",
            "Referer": "http://172.16.56.2:4001/"
        })
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=20,
            pool_maxsize=20,
            max_retries=1
        )
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

    def _ensure_authenticated(self, force_refresh: bool = False) -> bool:
        """Ensures a valid JWT token exists; logs in if missing or expired (Thread-safe)."""
        now = time.time()
        with self._auth_lock:
            if not force_refresh and self.access_token and now < (self.token_expiry_timestamp - 30):
                return True

            login_url = f"{self.api_base}/login"
            # Use ServiceId=1 (Stateless Service Token) so background sync NEVER kicks out
            # any human user logged into the ePAD web browser
            payload = {
                "grant_type": "password",
                "UserName": self.username,
                "Password": self.password,
                "ServiceId": 1
            }

            # Crucial: Must remove any old/expired Authorization header before logging in
            self.session.headers.pop("Authorization", None)

            try:
                resp = self.session.post(login_url, json=payload, timeout=self.timeout)
                if resp.status_code == 200:
                    data = resp.json()
                    self.access_token = data.get("access_token")
                    expires_in = data.get("expires_in", 3600)
                    self.token_expiry_timestamp = now + float(expires_in)
                    self.session.headers.update({
                        "Authorization": f"Bearer {self.access_token}",
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    })
                    logger.info("ePAD login successful, token expires in %s seconds", expires_in)
                    return True
                else:
                    logger.error("ePAD login failed with HTTP %s: %s", resp.status_code, resp.text)
                    return False
            except Exception as e:
                logger.error("ePAD login exception: %s", e)
                return False

    def _get_headers(self) -> Dict[str, str]:
        self._ensure_authenticated()
        return {
            "Authorization": f"Bearer {self.access_token}" if self.access_token else "",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    def _request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Executes HTTP request using pooled Keep-Alive session with auto re-auth on 401."""
        url = f"{self.api_base}/{endpoint.lstrip('/')}"
        kwargs.setdefault("timeout", self.timeout)
        self._ensure_authenticated()
        kwargs["headers"] = self._get_headers()

        try:
            resp = self.session.request(method, url, **kwargs)
            if resp.status_code == 401:
                logger.debug("ePAD token expired (401). Retrying with fresh login...")
                if self._ensure_authenticated(force_refresh=True):
                    kwargs["headers"] = self._get_headers()
                    resp = self.session.request(method, url, **kwargs)
                    if resp.status_code == 401:
                        logger.warning("ePAD auth retry still returned HTTP 401 for %s", endpoint)
            return resp
        except Exception as e:
            logger.error("Error connecting to ePAD at %s: %s", url, e)
            raise

    # ---------------- Door Controls ----------------

    def unlock_door(self, door_id: int, auto_off_seconds: int = 3, serial: Optional[str] = None) -> Dict[str, Any]:
        """
        Unlocks a specific door (or specific device channel on that door).
        If serial is provided, sends command targeting that specific device.
        """
        if serial:
            serials = [str(serial).strip()]
        else:
            door_cfg = next((d for d in self.doors_config if d.get("id") == int(door_id)), None)
            serials = [dev.get("sn") for dev in door_cfg.get("devices", [])] if door_cfg else []

        payload = {
            "ListSerial": serials,
            "Action": "Unlock Door",
            "ListUser": [],
            "IsUsingTimeZone": False,
            "TimeZone": [],
            "DoorLst": [str(door_id)],
            "AutoOffSecond": int(auto_off_seconds)
        }

        try:
            resp = self._request("POST", "/Command/UnlockDoor", json=payload)
            if resp.status_code == 200:
                target_desc = f"Thiết bị {serial}" if serial else f"Cửa {door_id}"
                logger.info("Successfully sent UnlockDoor for %s (duration: %ss)", target_desc, auto_off_seconds)
                return {"success": True, "door_id": door_id, "serial": serial, "seconds": auto_off_seconds, "message": "Mở cửa thành công"}
            return {"success": False, "door_id": door_id, "serial": serial, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            return {"success": False, "door_id": door_id, "serial": serial, "error": str(e)}

    def unlock_all_doors(self, auto_off_seconds: int = 5) -> Dict[str, Any]:
        """Unlocks all doors simultaneously (e.g. for emergency or group passage)."""
        door_ids = [str(d.get("id")) for d in self.doors_config]
        all_serials = []
        for d in self.doors_config:
            all_serials.extend([dev.get("sn") for dev in d.get("devices", []) if dev.get("sn")])
        if not door_ids:
            door_ids = ["1", "2"]

        payload = {
            "ListSerial": all_serials,
            "Action": "Unlock Door",
            "ListUser": [],
            "IsUsingTimeZone": False,
            "TimeZone": [],
            "DoorLst": door_ids,
            "AutoOffSecond": int(auto_off_seconds)
        }

        try:
            resp = self._request("POST", "/Command/UnlockDoor", json=payload)
            if resp.status_code == 200:
                logger.info("Successfully opened ALL doors %s for %ss", door_ids, auto_off_seconds)
                return {"success": True, "doors": door_ids, "seconds": auto_off_seconds, "message": "Đã mở tất cả các cửa"}
            return {"success": False, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_door_status(self) -> List[Dict[str, Any]]:
        """
        Gets current real-time open/close status of doors from ePAD.
        Returns: [{"DoorIndex": 1, "Status": false}, {"DoorIndex": 2, "Status": false}]
        """
        try:
            resp = self._request("GET", "/AttendanceLog/GetDoorStatus")
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.error("Failed to get door status: %s", e)
        return []

    # ---------------- Real-time Logs ----------------

    def get_realtime_attendance_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Fetches the latest real-time scans from all SenseFace devices."""
        try:
            resp = self._request("GET", "/AttendanceLog/GetLastedRealtimeAttendanceLog")
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data[:limit]
        except Exception as e:
            logger.error("Failed to fetch realtime attendance logs: %s", e)
        return []

    # ---------------- RFID Visitor Card Management ----------------

    def get_active_customer_cards(self) -> List[Dict[str, Any]]:
        """Retrieves all registered customer/visitor RFID cards from ePAD."""
        try:
            resp = self._request("GET", "/HR_CustomerCard/GetAllCustomerCard")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error("Failed to get customer cards: %s", e)
        return []

    def get_card_info(self, card_number: str) -> Optional[Dict[str, Any]]:
        """Queries card information and current assignment status from ePAD."""
        clean_card = str(card_number).strip()
        try:
            resp = self._request("GET", f"/GC_TruckDriverLog/GetCardNumberByNumber?number={clean_card}&skipCustomerCard=false")
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    return data
        except Exception as e:
            logger.warning("Failed to query card info for %s: %s", clean_card, e)
        return None

    def issue_customer_card(self, card_number: str, sync_to_device: bool = True) -> Dict[str, Any]:
        """
        Registers a new visitor card into ePAD pool if not already added.
        """
        clean_card = str(card_number).strip()
        payload = {
            "CardNumber": clean_card,
            "IsSyncToDevice": sync_to_device
        }

        try:
            resp = self._request("POST", "/HR_CustomerCard/AddCustomerCard", json=payload)
            if resp.status_code == 200:
                logger.info("Successfully added customer card %s", clean_card)
                if sync_to_device:
                    self.sync_customer_card_to_device()
                return {"success": True, "card_number": clean_card, "message": "Đã thêm thẻ thành công"}
            return {"success": False, "card_number": clean_card, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            return {"success": False, "card_number": clean_card, "error": str(e)}

    def return_or_delete_card(self, card_number: str) -> Dict[str, Any]:
        """
        Releases an assigned visitor card in ePAD (Return Card) so it can be reused.
        """
        clean_card = str(card_number).strip()
        payload = {
            "CardNumber": clean_card,
            "GateIndex": 0,
            "ReasonException": "",
            "IsException": False,
            "IsCardUHF": False
        }
        try:
            resp = self._request("POST", "/HR_CustomerInfo/ReturnOrDeleteCard", json=payload)
            if resp.status_code == 200:
                logger.info("Successfully returned/released customer card %s in ePAD", clean_card)
                self.sync_customer_card_to_device()
                return {"success": True, "card_number": clean_card, "message": "Đã thu hồi/giải phóng thẻ thành công"}
            return {"success": False, "card_number": clean_card, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            return {"success": False, "card_number": clean_card, "error": str(e)}

    def revoke_customer_card(self, card_number: str) -> Dict[str, Any]:
        """
        Revokes an assigned card or frees it up in ePAD.
        """
        return self.return_or_delete_card(card_number)

    def upload_user_to_device(self, employee_atids: List[str]) -> Dict[str, Any]:
        """
        Equivalent to ePAD 'Đồng bộ thông tin' button:
        Pushes guest authorizations (card, validity, door permissions) to SenseFace 4A terminals.
        """
        if not employee_atids:
            return {"success": False, "error": "No EmployeeATID provided"}
        try:
            resp = self._request("POST", "/Command/UploadUserFromUserIdWithGuest", json=employee_atids)
            if resp.status_code == 200:
                logger.info("Successfully synced guest users %s to door terminals", employee_atids)
                return {"success": True, "employee_atids": employee_atids}
            return {"success": False, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            logger.error("Failed to upload user to device: %s", e)
            return {"success": False, "error": str(e)}

    def sync_customer_card_to_device(self) -> bool:
        """Triggers general customer card sync on ePAD devices."""
        try:
            resp = self._request("GET", "/HR_CustomerCard/SyncCustomerCardToDevice")
            return resp.status_code in (200, 204)
        except Exception as e:
            logger.warning("Sync card warning: %s", e)
            return False

    def register_customer_epad(self, visitor_data: Dict[str, Any], auto_sync: bool = True) -> Dict[str, Any]:
        """
        Full official registration of visitor into ePAD HR_CustomerInfo.
        Assigns DoorIndexes: '2,1' (Làn Vào + Làn Ra), links RFID card, and pushes to device.
        """
        full_name = str(visitor_data.get("full_name") or visitor_data.get("fullname") or "").strip()
        cccd_num = str(visitor_data.get("cccd_number") or visitor_data.get("id_number") or "").strip()
        card_num = str(visitor_data.get("card_number") or "").strip()

        # Parse birth date
        dob_raw = str(visitor_data.get("birth_date") or "").strip()
        dob_iso = "1995-01-01T00:00:00.000Z"
        day_b, month_b, year_b = 1, 1, 1995
        if dob_raw:
            parts = dob_raw.replace("-", "/").split("/")
            if len(parts) == 3:
                try:
                    day_b = int(parts[0])
                    month_b = int(parts[1])
                    year_b = int(parts[2])
                    dob_iso = f"{year_b:04d}-{month_b:02d}-{day_b:02d}T00:00:00.000Z"
                except Exception:
                    pass

        # Parse checkin and checkout times
        now = datetime.now()
        cin_d = str(visitor_data.get("checkin_date") or "").strip() or now.strftime("%Y-%m-%d")
        cin_t = str(visitor_data.get("checkin_time") or "").strip() or now.strftime("%H:%M:%S")
        if len(cin_t) == 5: cin_t += ":00"
        from_time_iso = f"{cin_d}T{cin_t}"

        cout_d = str(visitor_data.get("expected_checkout_date") or "").strip() or cin_d
        cout_t = str(visitor_data.get("expected_checkout_time") or "").strip() or "16:45:00"
        if len(cout_t) == 5: cout_t += ":00"
        to_time_iso = f"{cout_d}T{cout_t}"

        # Gender: 2 = Male, 1 = Female
        gender_val = 2
        g_str = str(visitor_data.get("gender") or "").lower()
        if "nữ" in g_str or "nu" in g_str or g_str in ("female", "f"):
            gender_val = 1

        # Host and Department
        dept_idx = visitor_data.get("department_index") or 0
        host_str = str(visitor_data.get("host_person") or "").strip()
        host_atid = str(visitor_data.get("host_atid") or "").strip()
        # If host_atid not explicitly given, try extracting from "Tên (ATID)"
        if not host_atid and "(" in host_str and ")" in host_str:
            host_atid = host_str.split("(")[-1].split(")")[0].strip()

        # Step A: If card provided, ensure it's unassigned from older users
        if card_num:
            card_info = self.get_card_info(card_num)
            if card_info and card_info.get("Status") and card_info.get("CardUserIndex", 0) > 0:
                logger.info("Card %s currently assigned to %s, releasing first...", card_num, card_info.get("UserName"))
                self.return_or_delete_card(card_num)
            elif not card_info:
                # Add to customer card pool if missing
                self.issue_customer_card(card_num, sync_to_device=False)

        # Step B: Prepare Post_HR_CustomerInfo payload
        payload = {
            "FullName": full_name,
            "NRIC": cccd_num,
            "Gender": gender_val,
            "BirthDay": dob_iso,
            "DayOfBirth": day_b,
            "MonthOfBirth": month_b,
            "YearOfBirth": year_b,
            "FromTime": from_time_iso,
            "ToTime": to_time_iso,
            "Company": visitor_data.get("company") or "Khách",
            "Phone": visitor_data.get("phone") or "0",
            "ContactDepartment": dept_idx,
            "ContactPerson": host_atid or "80000010",
            "DoorIndexes": "2,1",  # Door 1: Làn Vào, Door 2: Làn Ra
            "CardNumber": card_num,
            "WorkingContent": visitor_data.get("purpose") or "Liên hệ công tác",
            "Note": visitor_data.get("note") or "",
            "EmployeeType": 2,  # 2 = Guest / Khách
            "CompanyIndex": 2,
            "ApproveStatus": 2, # Approved
            "PositionIndex": 0,
            "IsAllowPhone": False,
            "ListCompanion": []
        }

        try:
            resp = self._request("POST", "/HR_CustomerInfo/Post_HR_CustomerInfo", json=payload)
            if resp.status_code == 200:
                res_data = resp.json() if resp.text else {}
                emp_atid = res_data.get("EmployeeATID")
                logger.info("ePAD customer created successfully! EmployeeATID: %s, CardNumber: %s", emp_atid, card_num)

                # Step C: Upload user and card authorization to SenseFace 4A door devices
                if auto_sync and emp_atid:
                    self.upload_user_to_device([str(emp_atid)])
                    self.sync_customer_card_to_device()

                return {
                    "success": True,
                    "employee_atid": emp_atid,
                    "card_number": card_num,
                    "door_indexes": "2,1",
                    "epad_data": res_data,
                    "message": "Đã đăng ký khách và đồng bộ quyền mở cửa thành công lên ePAD"
                }
            else:
                err_msg = resp.text
                # If visitor already registered in this time range in ePAD, update card & sync
                if "CustomerNRICExisted" in err_msg or "Existed" in err_msg:
                    logger.info("NRIC %s already registered in ePAD. Looking up EmployeeATID to update card...", cccd_num)
                    try:
                        all_c_resp = self._request("GET", "/HR_CustomerInfo/GetNewestCustomerInfo")
                        if all_c_resp.status_code == 200:
                            all_c = all_c_resp.json() or []
                            matching_c = [c for c in all_c if str(c.get("NRIC", "")).strip() == cccd_num]
                            if matching_c:
                                # Pick newest record
                                match_c = sorted(matching_c, key=lambda x: str(x.get("EmployeeATID", "")), reverse=True)[0]
                                emp_atid = str(match_c.get("EmployeeATID"))
                                logger.info("Found existing customer EmployeeATID %s for NRIC %s. Updating card...", emp_atid, cccd_num)
                                if card_num:
                                    self.return_or_delete_card(card_num)
                                    self._request("POST", "/HR_CustomerInfo/UpdateCustomerCardNumber", json={
                                        "EmployeeATID": emp_atid,
                                        "CardNumber": card_num,
                                        "GateIndex": 0,
                                        "UHFCardNumber": "",
                                        "DoorIndexes": "2,1"
                                    })
                                if auto_sync:
                                    self.upload_user_to_device([emp_atid])
                                    self.sync_customer_card_to_device()
                                return {
                                    "success": True,
                                    "employee_atid": emp_atid,
                                    "card_number": card_num,
                                    "door_indexes": "2,1",
                                    "message": "Đã cập nhật quyền thẻ và đồng bộ xuống cửa thành công"
                                }
                    except Exception as fe:
                        logger.warning("Fallback update error: %s", fe)

                logger.error("ePAD Post_HR_CustomerInfo failed HTTP %s: %s", resp.status_code, err_msg)
                return {"success": False, "error": err_msg, "status_code": resp.status_code}
        except Exception as e:
            logger.error("Exception during ePAD customer registration: %s", e)
            return {"success": False, "error": str(e)}

    def check_connection(self) -> Dict[str, Any]:
        """Tests live connectivity to ePAD server."""
        try:
            ok = self._ensure_authenticated()
            if ok:
                door_status = self.get_door_status()
                return {
                    "connected": True,
                    "server": self.api_base,
                    "doors_online": len(door_status) > 0,
                    "door_count": len(door_status)
                }
            return {"connected": False, "server": self.api_base, "error": "Xác thực tài khoản thất bại"}
        except Exception as e:
            return {"connected": False, "server": self.api_base, "error": str(e)}

    # ---------------- Department & Personnel Management ----------------

    def get_department_tree(self) -> List[Dict[str, Any]]:
        """Fetches the full company department hierarchy tree from ePAD."""
        try:
            resp = self._request("GET", "/Department/GetDepartmentTree")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error("Failed to fetch department tree from ePAD: %s", e)
        return []

    def get_all_employees(self) -> List[Dict[str, Any]]:
        """Fetches all company employees with their departments and codes."""
        try:
            resp = self._request("GET", "/HR_User/GetAllUserSimpleInfo")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error("Failed to fetch employees from ePAD: %s", e)
        return []

    # ---------------- Historical & Door Audit Data ----------------

    def get_log_last_7_days(self) -> Dict[str, List[Dict[str, Any]]]:
        """Fetches real historical scans grouped by date for the last 7 days."""
        try:
            resp = self._request("GET", "/AttendanceLog/GetLogLast7Days")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.error("Failed to fetch last 7 days log from ePAD: %s", e)
        return {}

    def get_remain_in_logs(self) -> List[Dict[str, Any]]:
        """Fetches real-time list of people currently inside the building."""
        try:
            resp = self._request("GET", "/AttendanceLog/GetRemainInLogs")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
        except Exception as e:
            logger.error("Failed to fetch remain in logs from ePAD: %s", e)
        return []

    def get_logs_by_door(self) -> Dict[str, Any]:
        """Fetches scan distribution by entry and exit doors."""
        try:
            resp = self._request("GET", "/AttendanceLog/GetLogsByDoor")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.error("Failed to fetch logs by door from ePAD: %s", e)
        return {}
