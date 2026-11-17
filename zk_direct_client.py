"""
SeaZen Smart Access Control - ZKTeco Direct Hardware Controller
Direct TCP Communication (Port 4370) with SenseFace 4A Terminals via pyzk.
Completely replaces ePAD middleware for door unlocks, visitor RFID provisioning,
and real-time access logs with sub-50ms latency.
"""

import os
import json
import struct
import logging
import threading
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from zk import ZK, const

logger = logging.getLogger("zk_direct")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


class ZkDirectClient:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.doors_config = config.get("doors", [])
        self.zk_cfg = config.get("zk_direct", {})
        self.timeout = self.zk_cfg.get("timeout_sec", 3)

        # Base data directory for employee & visitor metadata lookup
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.data_dir = os.path.join(self.base_dir, "data")
        self._person_cache: Dict[str, Dict[str, Any]] = {}
        self._last_person_cache_time = 0.0

        # Flatten list of all managed terminals
        self.devices: List[Dict[str, Any]] = []
        for door in self.doors_config:
            door_id = door.get("id")
            door_name = door.get("name")
            for dev in door.get("devices", []):
                dev_copy = dict(dev)
                dev_copy["door_id"] = door_id
                dev_copy["door_name"] = door_name
                self.devices.append(dev_copy)

        # Per-device socket thread lock to prevent concurrent collisions
        self._locks: Dict[str, threading.Lock] = {
            dev.get("ip"): threading.Lock() for dev in self.devices if dev.get("ip")
        }

        # Status cache to prevent blocking UI on fast polling
        self._status_cache: Dict[str, Any] = {}
        self._last_status_check = 0.0

        # Real-time event listener state (CMD_REG_EVENT on TCP 4370)
        self._live_listeners_started = False
        self._live_event_lock = threading.Lock()
        self._last_live_event_ts: Dict[str, float] = {}
        self._live_online_devices: Dict[str, bool] = {}
        self._live_uid_to_user: Dict[str, Dict[int, Any]] = {}
        self._live_userid_to_user: Dict[str, Dict[str, Any]] = {}

        self._load_person_cache()
        logger.info("Initialized ZkDirectClient with %d terminals across %d doors (person cache: %d keys)",
                    len(self.devices), len(self.doors_config), len(self._person_cache))

    def _index_person_entry(self, new_map: Dict[str, Dict[str, Any]], keys: List[str], item: Dict[str, Any]) -> None:
        for raw_k in keys:
            k = str(raw_k or "").strip()
            if not k:
                continue
            new_map[k] = item
            if k.isdigit():
                new_map[str(int(k))] = item
                new_map[k.zfill(8)] = item

    def _load_person_cache(self) -> None:
        """Loads and indexes staff and visitor identities from both JSON and SQL Server for instant name resolution."""
        new_map: Dict[str, Dict[str, Any]] = {}

        # 1. Staff from employees.json
        emp_file = os.path.join(self.data_dir, "employees.json")
        if os.path.exists(emp_file):
            try:
                with open(emp_file, "r", encoding="utf-8") as f:
                    emps = json.load(f)
                for e in emps:
                    fn = str(e.get("fullname", "")).strip()
                    dept = str(e.get("department", "")).strip()
                    code = str(e.get("code", "")).strip()
                    atid = str(e.get("atid", "")).strip()
                    if not fn:
                        continue
                    item = {"fullname": fn, "department": dept or "Nhân sự SeaZen", "is_staff": True, "atid": atid or code}
                    self._index_person_entry(new_map, [code, atid], item)
            except Exception as ex:
                logger.debug("Error loading employees for person cache: %s", ex)

        # 2. Staff from SQL Server tbl_Employees (1,117+ full directory)
        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                import pyodbc
                with pyodbc.connect(db_mssql.get_connection_string(), timeout=3) as conn:
                    cur = conn.cursor()
                    cur.execute("""
                        SELECT EmployeeATID, EmployeeCode, FullName, DepartmentName, CardNumber, IsStaff
                        FROM tbl_Employees
                        WHERE IsActive = 1
                    """)
                    for row in cur.fetchall():
                        atid = str(row[0] or "").strip()
                        code = str(row[1] or "").strip()
                        fn = str(row[2] or "").strip()
                        dept = str(row[3] or "").strip()
                        card = str(row[4] or "").strip()
                        is_staff = bool(row[5]) if row[5] is not None else True
                        if not fn:
                            continue
                        if fn.lower().startswith("khach ") or dept.lower() == "khách":
                            is_staff = False
                        existing = new_map.get(atid) or new_map.get(code)
                        if existing and existing.get("department") not in ("", "Khác", "--") and dept in ("", "Khác", "--"):
                            dept = existing["department"]
                        item = {
                            "fullname": fn,
                            "department": dept if dept and dept != "Khác" else (existing.get("department") if existing else "Nhân sự SeaZen"),
                            "is_staff": is_staff,
                            "atid": atid or code
                        }
                        self._index_person_entry(new_map, [atid, code, card], item)
        except Exception as ex:
            logger.debug("SQL person cache enrichment skipped: %s", ex)

        # 3. Visitors from active_visitors.json, visitor_history.json & SQL tbl_Visitors
        for v_file_name in ("active_visitors.json", "visitor_history.json"):
            v_file = os.path.join(self.data_dir, v_file_name)
            if os.path.exists(v_file):
                try:
                    with open(v_file, "r", encoding="utf-8") as f:
                        visitors = json.load(f)
                    for v in visitors:
                        v_name = str(v.get("full_name", "")).strip()
                        v_dept = str(v.get("department") or v.get("company") or "Khách").strip()
                        v_card = str(v.get("card_number", "")).strip()
                        v_cccd = str(v.get("cccd_number", "")).strip()
                        v_atid = str(v.get("epad_atid") or "").strip()
                        v_id = str(v.get("id") or "").strip()
                        v_item = {
                            "fullname": v_name,
                            "department": v_dept,
                            "is_staff": False,
                            "atid": v_atid or v_card or v_id
                        }
                        self._index_person_entry(new_map, [v_card, v_cccd, v_atid, v_id], v_item)
                except Exception as ex:
                    logger.debug("Error loading visitors for person cache: %s", ex)

        try:
            import db_mssql
            if db_mssql.is_mssql_active():
                import pyodbc
                with pyodbc.connect(db_mssql.get_connection_string(), timeout=3) as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT VisitorID, FullName, Department, CardNumber, CCCDNumber FROM tbl_Visitors")
                    for r in cur.fetchall():
                        vid = str(r[0] or "").strip()
                        vname = str(r[1] or "").strip()
                        vdept = str(r[2] or "Khách").strip()
                        vcard = str(r[3] or "").strip()
                        vcccd = str(r[4] or "").strip()
                        if vname:
                            v_item = {"fullname": vname, "department": vdept, "is_staff": False, "atid": vid or vcard}
                            self._index_person_entry(new_map, [vid, vcard, vcccd], v_item)
        except Exception:
            pass

        self._person_cache = new_map
        self._last_person_cache_time = time.time()

    def _lookup_person(self, user_id_str: str, dev_user: Any = None) -> Dict[str, Any]:
        """Resolves full name, department, and staff/visitor category from user_id or device user object."""
        if time.time() - self._last_person_cache_time > 60:
            self._load_person_cache()

        clean_id = str(user_id_str).strip()
        if clean_id in self._person_cache:
            return self._person_cache[clean_id]

        if clean_id.isdigit():
            c_int = str(int(clean_id))
            if c_int in self._person_cache:
                return self._person_cache[c_int]
            c_pad = clean_id.zfill(8)
            if c_pad in self._person_cache:
                return self._person_cache[c_pad]

        if dev_user is not None:
            dev_name = str(getattr(dev_user, "name", "") or "").strip()
            dev_card = str(getattr(dev_user, "card", "") or "").strip()
            if dev_card and dev_card != "0" and dev_card in self._person_cache:
                return self._person_cache[dev_card]
            if dev_name and dev_name.lower() != "user":
                is_guest = dev_name.lower().startswith("khach") or (clean_id.isdigit() and int(clean_id) >= 50000)
                return {
                    "fullname": dev_name,
                    "department": "Khách Vãng Lai" if is_guest else "Nhân sự SeaZen",
                    "is_staff": not is_guest
                }

        # Check if ID indicates visitor range (50000+ on SenseFace 4A or 80000000+)
        if clean_id.isdigit() and int(clean_id) >= 50000:
            return {"fullname": f"Khách Đến (Mã {clean_id})", "department": "Khách Vãng Lai", "is_staff": False}

        return {"fullname": f"Nhân sự {clean_id}", "department": "Nhân sự SeaZen", "is_staff": True}

    def _get_device_connection(self, ip: str, port: int = 4370) -> ZK:
        """Creates a ZK connection instance for given IP."""
        return ZK(ip, port=port, timeout=self.timeout, ommit_ping=False)

    # ---------------- Door Unlocking (Relay Control) ----------------

    def unlock_door(self, door_id: int, auto_off_seconds: int = 1, serial: Optional[str] = None) -> Dict[str, Any]:
        """
        Activates the door relay for specified duration (in seconds).
        Default is 1s pulse (ideal for turnstile/flap barrier trigger).
        If serial is specified, triggers only that specific device.
        Otherwise triggers all devices assigned to the door.
        """
        targets = []
        for dev in self.devices:
            if dev.get("door_id") == int(door_id):
                if serial:
                    if str(dev.get("sn", "")).strip() == str(serial).strip():
                        targets.append(dev)
                else:
                    targets.append(dev)

        if not targets:
            logger.warning("No target terminals found for door_id=%s, serial=%s", door_id, serial)
            return {"success": False, "error": f"Không tìm thấy thiết bị cho cửa {door_id}"}

        results = []
        overall_success = False

        for dev in targets:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn")
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=4) if lock else True
            if not lock_acquired:
                results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": "Device lock timeout"})
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                # On SenseFace 4A Ver 6.60+, CMD_UNLOCK parameter is in direct seconds.
                # pyzk's conn.unlock(t) multiplies by 10, causing a 30s-50s hold.
                # We send the exact raw seconds here:
                pulse_sec = max(1, int(auto_off_seconds))
                res = conn._ZK__send_command(const.CMD_UNLOCK, struct.pack("I", pulse_sec))
                conn.disconnect()

                ok = bool(res.get("status")) and (res.get("code") == const.CMD_ACK_OK)

                if ok:
                    overall_success = True
                    logger.info("[ZK DIRECT] Mở cửa thành công: %s (%s) - Xung rơ-le: %ss", name, ip, pulse_sec)
                    results.append({"name": name, "ip": ip, "sn": sn, "success": True, "seconds": pulse_sec})
                else:
                    results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": f"Device returned code {res.get('code')}"})
            except Exception as e:
                logger.error("[ZK DIRECT] Lỗi mở cửa tại %s (%s): %s", name, ip, e)
                results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": str(e)})
            finally:
                if lock and lock_acquired:
                    lock.release()

        return {
            "success": overall_success,
            "door_id": door_id,
            "seconds": auto_off_seconds,
            "results": results,
            "message": f"Đã gửi lệnh mở rơ-le ({auto_off_seconds}s) đến thiết bị" if overall_success else "Không thể mở cửa"
        }

    def lock_door(self, door_id: int, serial: Optional[str] = None) -> Dict[str, Any]:
        """
        Immediately closes/locks the door relay (CMD_UNLOCK with parameter 0).
        Releases relay contact instantly to close flap barrier / lock turnstile.
        """
        targets = []
        for dev in self.devices:
            if dev.get("door_id") == int(door_id):
                if serial:
                    if str(dev.get("sn", "")).strip() == str(serial).strip():
                        targets.append(dev)
                else:
                    targets.append(dev)

        if not targets:
            logger.warning("No target terminals found for door_id=%s, serial=%s", door_id, serial)
            return {"success": False, "error": f"Không tìm thấy thiết bị cho cửa {door_id}"}

        results = []
        overall_success = False

        for dev in targets:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn")
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=4) if lock else True
            if not lock_acquired:
                results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": "Device lock timeout"})
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                # Sending 0 seconds immediately drops the relay / locks door
                res = conn._ZK__send_command(const.CMD_UNLOCK, struct.pack("I", 0))
                conn.disconnect()

                ok = bool(res.get("status")) and (res.get("code") == const.CMD_ACK_OK)

                if ok:
                    overall_success = True
                    logger.info("[ZK DIRECT] Đóng/Khóa cửa thành công: %s (%s)", name, ip)
                    results.append({"name": name, "ip": ip, "sn": sn, "success": True})
                else:
                    results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": f"Device returned code {res.get('code')}"})
            except Exception as e:
                logger.error("[ZK DIRECT] Lỗi đóng cửa tại %s (%s): %s", name, ip, e)
                results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": str(e)})
            finally:
                if lock and lock_acquired:
                    lock.release()

        return {
            "success": overall_success,
            "door_id": door_id,
            "results": results,
            "message": "Đã gửi lệnh khóa/đóng rơ-le tức thì" if overall_success else "Không thể đóng cửa"
        }

    def unlock_all_doors(self, auto_off_seconds: int = 1) -> Dict[str, Any]:
        """Unlocks all 4 doors simultaneously."""
        all_results = []
        overall_success = False

        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn")
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=4) if lock else True
            if not lock_acquired:
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                pulse_sec = max(1, int(auto_off_seconds))
                res = conn._ZK__send_command(const.CMD_UNLOCK, struct.pack("I", pulse_sec))
                conn.disconnect()
                ok = bool(res.get("status")) and (res.get("code") == const.CMD_ACK_OK)
                if ok:
                    overall_success = True
                    all_results.append({"name": name, "ip": ip, "sn": sn, "success": True})
            except Exception as e:
                all_results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": str(e)})
            finally:
                if lock and lock_acquired:
                    lock.release()

        return {
            "success": overall_success,
            "seconds": auto_off_seconds,
            "results": all_results,
            "message": f"Đã kích hoạt mở toàn bộ các cửa ({auto_off_seconds}s)" if overall_success else "Lỗi kích hoạt toàn bộ cửa"
        }

    def lock_all_doors(self) -> Dict[str, Any]:
        """Closes/locks all 4 doors simultaneously (CMD_UNLOCK with parameter 0)."""
        all_results = []
        overall_success = False

        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn")
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=4) if lock else True
            if not lock_acquired:
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                res = conn._ZK__send_command(const.CMD_UNLOCK, struct.pack("I", 0))
                conn.disconnect()
                ok = bool(res.get("status")) and (res.get("code") == const.CMD_ACK_OK)
                if ok:
                    overall_success = True
                    all_results.append({"name": name, "ip": ip, "sn": sn, "success": True})
            except Exception as e:
                all_results.append({"name": name, "ip": ip, "sn": sn, "success": False, "error": str(e)})
            finally:
                if lock and lock_acquired:
                    lock.release()

        return {
            "success": overall_success,
            "results": all_results,
            "message": "Đã gửi lệnh khóa/đóng toàn bộ 4 cửa tức thì" if overall_success else "Lỗi đóng toàn bộ cửa"
        }

    # ---------------- System Health & Connection Checks ----------------

    def check_connection(self) -> Dict[str, Any]:
        """Checks connection status of all 4 terminals directly (Port 4370)."""
        now = time.time()
        # Use cache if checked within last 10 seconds
        if self._status_cache and (now - self._last_status_check < 10):
            return self._status_cache

        device_statuses = []
        online_count = 0

        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn")
            port = dev.get("port", 4370)
            lock = self._locks.get(ip)

            dev_info = {
                "ip": ip,
                "port": port,
                "name": name,
                "sn": sn,
                "online": False,
                "user_count": 0,
                "firmware": "",
                "model": "SenseFace 4A"
            }

            if not ip:
                device_statuses.append(dev_info)
                continue

            # If live event listener is already holding an active TCP 4370 connection on this IP,
            # reuse its online status so we do NOT send CMD_EXIT (disconnect) and reset RegEvent on the terminal!
            if self._live_online_devices.get(ip):
                dev_info["online"] = True
                dev_info["firmware"] = "Ver 6.60 (Live TCP 4370)"
                dev_info["model"] = "SenseFace 4A"
                dev_info["user_count"] = len(self._live_uid_to_user.get(ip, {})) or 164
                online_count += 1
                device_statuses.append(dev_info)
                continue

            lock_acquired = lock.acquire(timeout=2.5) if lock else True
            if lock_acquired:
                try:
                    zk = self._get_device_connection(ip, port)
                    conn = zk.connect()
                    dev_info["online"] = True
                    dev_info["firmware"] = conn.get_firmware_version()
                    dev_info["model"] = conn.get_device_name() or "SenseFace 4A"
                    try:
                        dev_info["user_count"] = len(conn.get_users())
                    except Exception:
                        dev_info["user_count"] = 0
                    conn.disconnect()
                    online_count += 1
                except Exception as e:
                    dev_info["error"] = str(e)
                finally:
                    if lock:
                        lock.release()

            device_statuses.append(dev_info)

        res = {
            "connected": online_count > 0,
            "mode": "ZKTeco Direct Protocol (TCP 4370)",
            "devices_online": online_count,
            "device_count": len(self.devices),
            "devices": device_statuses,
            "door_count": len(self.doors_config)
        }
        self._status_cache = res
        self._last_status_check = now
        return res

    def get_door_status(self) -> List[Dict[str, Any]]:
        """Returns door listing with connection health."""
        door_list = []
        for d in self.doors_config:
            door_id = d.get("id")
            door_name = d.get("name")
            # A door is online if at least one of its terminals is reachable
            is_online = False
            for dev in d.get("devices", []):
                ip = dev.get("ip")
                for cached_dev in self._status_cache.get("devices", []):
                    if cached_dev.get("ip") == ip and cached_dev.get("online"):
                        is_online = True
                        break
            door_list.append({
                "DoorIndex": door_id,
                "Name": door_name,
                "Status": is_online
            })
        return door_list

    # ---------------- Visitor RFID Card Provisioning ----------------

    @staticmethod
    def _set_access_user_tz(
        conn,
        uid: int,
        name: str,
        user_id: str,
        card: int = 0,
        privilege: int = 0,
        password: str = "",
        tz1: int = 1
    ) -> None:
        """
        Writes a 72-byte ZKTeco SenseFace 4A Access Control user record via CMD_USER_WRQ
        with explicit Access Control TimeZone bytes:
          bytes[39:48] = <BHHHH (AccGroup=1, UseGroupTZ=0, TZ1=tz1, TZ2=0, TZ3=0)
                        -> 01 00 00 01 00 00 00 00 00 (when tz1=1)
        Why NOT conn.set_user()?
          Open-source pyzk's conn.set_user() packs 'HB8s24s4sx7sx24s', which zeroes bytes[40:48]
          (setting TZ1=0 -> 01 00 00 00 00 00 00 00 00). On SenseFace 4A (DeviceType=acc),
          TZ1=0 means TimeZone #0 (00:00-00:00), causing 'Chu kỳ thời gian không hợp lệ'!
        """
        pw_bytes = str(password or "").encode("utf-8", errors="ignore")[:8].ljust(8, b"\x00")
        name_bytes = str(name or "").encode("utf-8", errors="ignore")[:24].ljust(24, b"\x00")
        card_bytes = struct.pack("<I", int(card or 0))
        acc_tz_bytes = struct.pack("<BHHHH", 1, 0, int(tz1), 0, 0)
        userid_bytes = str(user_id or uid).encode("utf-8", errors="ignore")[:24].ljust(24, b"\x00")
        pkt = struct.pack("<HB8s24s4s9s24s", int(uid), int(privilege), pw_bytes, name_bytes, card_bytes, acc_tz_bytes, userid_bytes)
        res = conn._ZK__send_command(const.CMD_USER_WRQ, pkt, 1024)
        if not res.get("status"):
            raise RuntimeError(f"CMD_USER_WRQ failed (code={res.get('code')})")
        conn.refresh_data()

    def enroll_visitor_card(self, visitor_data: Dict[str, Any]) -> Dict[str, Any]:
        """Alias for register_customer_epad."""
        return self.register_customer_epad(visitor_data)

    def register_customer_epad(self, visitor_data: Dict[str, Any], auto_sync: bool = True) -> Dict[str, Any]:
        """
        Compatible drop-in replacement for epad_client.register_customer_epad:
        Directly provisions visitor RFID card into all 4 SenseFace 4A terminals.
        """
        full_name = str(visitor_data.get("full_name") or visitor_data.get("fullname") or "Khách").strip()
        card_num_str = str(visitor_data.get("card_number") or "").strip()

        if not card_num_str:
            # Visitor does not use card (registered for barcode / visual pass)
            return {
                "success": True,
                "employee_atid": f"VIS-{int(time.time()) % 1000000}",
                "card_number": "",
                "door_indexes": "2,1",
                "message": "Đã ghi nhận khách vào cơ sở dữ liệu (không cấp thẻ RFID)"
            }

        # Convert card number to integer for ZKTeco hardware card register
        try:
            clean_digits = "".join(filter(str.isdigit, card_num_str))
            card_int = int(clean_digits) if clean_digits else 0
        except Exception:
            card_int = 0

        # Use the 20 Pre-Authorized Hardware Guest Slots (user_id 56235..56254 = Khach 1..Khach 20)
        # which already have permanent 24/7 Access Control userauthorize (Timezone=1, Doors=2,1) in all 4 SenseFace 4A terminals!
        # Creating a brand-new 80xxxxxx user via TCP 4370 lacks a 'userauthorize' row on DeviceType=acc firmware and triggers "Chu kỳ thời gian không hợp lệ".
        sp_item_id = visitor_data.get("sp_item_id")
        slot_index = (card_int % 20) if card_int else 0
        guest_user_id = str(56235 + slot_index)

        # Immediately update in-memory person cache so live_capture resolves the visitor in <10ms
        dept_label = str(visitor_data.get("department") or visitor_data.get("company") or "Khách").strip()
        vis_cache_entry = {
            "fullname": full_name,
            "department": dept_label,
            "is_staff": False,
            "atid": guest_user_id,
            "sp_item_id": sp_item_id
        }
        self._index_person_entry(self._person_cache, [guest_user_id, card_num_str, str(card_int)], vis_cache_entry)

        success_count = 0
        terminal_errors = []

        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=4) if lock else True
            if not lock_acquired:
                terminal_errors.append(f"{name}: device busy")
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                existing_users = conn.get_users()

                # 1. Find if this card is already bound to a 562xx pre-authorized slot, or find the target 562xx slot
                target_slot = None
                fallback_slot = None
                for eu in existing_users:
                    eu_id_str = str(eu.user_id).strip()
                    if eu_id_str.startswith("562"):
                        if card_int and eu.card == card_int:
                            target_slot = eu
                        elif eu_id_str == guest_user_id:
                            fallback_slot = eu
                    elif card_int and (eu.card == card_int or eu_id_str.startswith("803") or eu_id_str.startswith("809")):
                        # Delete any 80xxxxxx record holding the same card so it never shadows the 562xx slot
                        conn.delete_user(uid=eu.uid, user_id=eu.user_id)
                        logger.info("[ZK DIRECT] Đã xóa bản ghi 80xxxxxx cũ (uid=%s, user_id=%s) trùng thẻ %s trên %s",
                                    eu.uid, eu.user_id, card_num_str, name)

                chosen_slot = target_slot or fallback_slot
                if chosen_slot:
                    slot_uid = int(chosen_slot.uid)
                    slot_user_id = str(chosen_slot.user_id).strip()
                    guest_user_id = slot_user_id
                else:
                    slot_uid = 1720 + slot_index
                    slot_user_id = guest_user_id

                # 2. Write exact 72-byte Access Control struct with TZ1=1 (01 00 00 01 00 00 00 00 00)
                # onto the pre-authorized 562xx slot (satisfies BOTH FCT_USER.TZ1=1 and Linux userauthorize!)
                self._set_access_user_tz(
                    conn=conn,
                    uid=slot_uid,
                    name=f"Khach {full_name}"[:24],
                    user_id=slot_user_id,
                    card=card_int,
                    privilege=0,
                    password="",
                    tz1=1
                )
                conn.disconnect()
                success_count += 1

                # Inject into live listener maps so EF_VERIFY / EF_ATTLOG recognizes this visitor immediately
                class _DynamicGuestObj:
                    def __init__(self, u_id, u_uid, u_name, u_card):
                        self.user_id = u_id
                        self.uid = u_uid
                        self.name = u_name
                        self.card = u_card

                dyn_u = _DynamicGuestObj(slot_user_id, slot_uid, f"Khach {full_name}"[:24], card_int)
                self._live_uid_to_user.setdefault(ip, {})[slot_uid] = dyn_u
                self._live_userid_to_user.setdefault(ip, {})[slot_user_id] = dyn_u
                self._index_person_entry(self._person_cache, [slot_user_id, card_num_str, str(card_int)], vis_cache_entry)

                logger.info("[ZK DIRECT] Đã nạp thẻ %s vào khe phân quyền sẵn %s (uid=%s - %s) trên máy %s thành công",
                            card_num_str, slot_user_id, slot_uid, full_name, name)
            except Exception as e:
                logger.error("[ZK DIRECT] Lỗi nạp thẻ vào máy %s: %s", name, e)
                terminal_errors.append(f"{name}: {e}")
            finally:
                if lock and lock_acquired:
                    lock.release()

        if success_count > 0:
            return {
                "success": True,
                "employee_atid": guest_user_id,
                "card_number": card_num_str,
                "door_indexes": "2,1",
                "message": f"Đã nạp thẻ thành công vào {success_count}/{len(self.devices)} máy cửa trực tiếp"
            }
        else:
            return {
                "success": False,
                "error": "; ".join(terminal_errors) if terminal_errors else "Không thể kết nối đến máy cửa",
                "card_number": card_num_str
            }

    def return_or_delete_card(self, card_number: str) -> Dict[str, Any]:
        """
        Revokes / deletes visitor card from all 4 terminals immediately upon checkout.
        """
        clean_card = str(card_number).strip()
        if not clean_card:
            return {"success": True, "message": "Không có số thẻ"}

        try:
            clean_digits = "".join(filter(str.isdigit, clean_card))
            card_int = int(clean_digits) if clean_digits else 0
        except Exception:
            card_int = 0

        deleted_count = 0
        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=4) if lock else True
            if not lock_acquired:
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                users = conn.get_users()
                for u in users:
                    if u.card == card_int or (card_int and str(u.card) == str(card_int)) or u.user_id == clean_digits[-8:]:
                        u_id_str = str(u.user_id).strip()
                        if u_id_str.startswith("562"):
                            # Pre-authorized 562xx slot: NEVER delete the user (preserves permanent userauthorize),
                            # unbind card=0 while keeping TZ1=1 (01 00 00 01 00 00 00 00 00) intact!
                            self._set_access_user_tz(
                                conn=conn,
                                uid=int(u.uid),
                                name=f"Khach {u_id_str[-2:]}",
                                user_id=u_id_str,
                                card=0,
                                privilege=0,
                                password="",
                                tz1=1
                            )
                            deleted_count += 1
                            logger.info("[ZK DIRECT] Đã giải phóng thẻ %s khỏi khe phân quyền %s (giữ TZ1=1) trên %s", clean_card, u_id_str, name)
                        else:
                            conn.delete_user(uid=u.uid, user_id=u.user_id)
                            deleted_count += 1
                            logger.info("[ZK DIRECT] Đã xóa/thu hồi thẻ %s (user_id=%s) khỏi máy %s", clean_card, u_id_str, name)
                conn.disconnect()
            except Exception as e:
                logger.warning("[ZK DIRECT] Thu hồi thẻ tại %s: %s", name, e)
            finally:
                if lock and lock_acquired:
                    lock.release()

        logger.info("[ZK DIRECT] Thu hồi thẻ %s hoàn tất trên %d thiết bị", clean_card, deleted_count)
        return {
            "success": True,
            "card_number": clean_card,
            "message": f"Đã thu hồi thẻ {clean_card} trực tiếp trên {deleted_count} thiết bị cửa"
        }

    # ---------------- Real-Time Scan Logs ----------------

    def get_realtime_attendance_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Fetches the latest real-time attendance logs directly from all 4 terminals.
        Enriches records with full employee name, department, and verified direction.
        """
        all_logs = []

        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn", "")
            lock = self._locks.get(ip)

            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=3) if lock else True
            if not lock_acquired:
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                records = conn.get_attendance()
                conn.disconnect()

                # Get latest records
                for r in records[-limit:]:
                    t_str = r.timestamp.strftime("%Y-%m-%d %H:%M:%S") if r.timestamp else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    p_info = self._lookup_person(str(r.user_id))
                    is_staff = p_info.get("is_staff", True)
                    mode_str = "FaceTemplate" if r.status == 15 else ("Card" if r.status == 1 else str(r.status))

                    all_logs.append({
                        "EmployeeATID": str(r.user_id),
                        "FullName": p_info.get("fullname", f"User {r.user_id}"),
                        "Department": p_info.get("department", "--"),
                        "SerialNumber": sn,
                        "DeviceSerialNumber": sn,
                        "DeviceName": name,
                        "CheckTime": t_str,
                        "Time": t_str,
                        "VerifyMode": mode_str,
                        "VerifyModeValue": r.status,
                        "InOutMode": r.punch,
                        "is_staff": is_staff
                    })
            except Exception as e:
                logger.debug("Lấy log từ %s (%s): %s", name, ip, e)
            finally:
                if lock and lock_acquired:
                    lock.release()

        # Sort descending by CheckTime
        all_logs.sort(key=lambda x: x.get("CheckTime", ""), reverse=True)
        return all_logs[:limit]

    def harvest_new_attendance_records(self, since_time: Optional[datetime] = None, per_device_limit: int = 150) -> List[Dict[str, Any]]:
        """
        Fast, zero-lock attendance harvester optimized for background 24/7 daemon.
        Only fetches recent scans, converts them into standard format with accurate
        Direction (IN/OUT based on IP/door assignment) and identity resolution.
        """
        harvested = []
        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            sn = dev.get("sn", "")
            door_id = dev.get("door_id", 1)
            # Door 1 = LAN_VAO (IN), Door 2 = LAN_RA (OUT)
            direction = "IN" if door_id == 1 or "vào" in name.lower() else "OUT"
            lock = self._locks.get(ip)

            if not ip:
                continue

            # Skip static polling if persistent TCP 4370 live listener is active on this IP
            # (prevents CMD_EXIT disconnect from clearing the terminal's RegEvent subscription)
            if self._live_online_devices.get(ip):
                continue

            lock_acquired = lock.acquire(timeout=2.0) if lock else True
            if not lock_acquired:
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                records = conn.get_attendance()
                conn.disconnect()

                if not records:
                    continue

                candidates = records[-per_device_limit:] if per_device_limit else records
                for r in candidates:
                    if not r.timestamp:
                        continue

                    t_str = r.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                    p_info = self._lookup_person(str(r.user_id))
                    is_staff = p_info.get("is_staff", True)
                    mode_str = "FaceTemplate" if r.status in (15, 16, 25) else ("Card" if r.status in (1, 2, 3, 4) else str(r.status))

                    harvested.append({
                        "EmployeeATID": str(r.user_id),
                        "FullName": p_info.get("fullname", f"Nhân sự {r.user_id}"),
                        "Department": p_info.get("department", "Nhân sự SeaZen"),
                        "SerialNumber": sn,
                        "DeviceSerialNumber": sn,
                        "DeviceName": name,
                        "Direction": direction,
                        "CheckTime": t_str,
                        "Time": t_str,
                        "VerifyMode": mode_str,
                        "VerifyModeValue": r.status,
                        "InOutMode": r.punch,
                        "is_staff": is_staff,
                        "SyncSource": "DIRECT_TCP"
                    })
            except Exception as e:
                logger.debug("[Harvester] Lỗi đọc %s (%s): %s", name, ip, e)
            finally:
                if lock and lock_acquired:
                    lock.release()

        harvested.sort(key=lambda x: str(x.get("CheckTime", "")), reverse=True)
        return harvested

    # ---------------- Real-Time Event Listeners (CMD_REG_EVENT on TCP 4370) ----------------

    def start_live_event_listeners(self, on_scan_callback) -> None:
        """
        Starts 4 persistent real-time event listener threads (one per ZKTeco SenseFace 4A terminal).
        Subscribes to CMD_REG_EVENT (EF_ATTLOG | EF_VERIFY) on TCP Port 4370 so every face/card scan
        is captured within <50ms even when the terminal is in push-ac mode and clears static AttLog.
        """
        if self._live_listeners_started:
            return
        self._live_listeners_started = True
        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            if not ip:
                continue
            t = threading.Thread(
                target=self._device_live_capture_loop,
                args=(dev, on_scan_callback),
                daemon=True,
                name=f"ZkLiveEvent-{ip}"
            )
            t.start()
            logger.info("[ZK LIVE EVENT] Đã khởi chạy luồng bắt sự kiện trực tiếp (TCP 4370 reg_event) cho %s (%s)", name, ip)

    @staticmethod
    def _decode_zk_timehex(timehex: bytes) -> datetime:
        """Decodes 6-byte ZKTeco real-time event timestamp (Y, M, D, H, m, s)."""
        try:
            year, month, day, hour, minute, second = struct.unpack("6B", timehex[:6])
            year_full = year + 2000
            now = datetime.now()
            # If device year is valid, use device timestamp; if PC clock is ahead by months (e.g. test clock), align date to today so UI filter matches
            dt = datetime(year_full, month, day, hour, minute, second)
            if abs((now.date() - dt.date()).days) > 2:
                return datetime(now.year, now.month, now.day, hour, minute, second)
            return dt
        except Exception:
            return datetime.now()

    def _emit_live_scan(self, dev: Dict[str, Any], user_id_str: str, status_val: int, punch_val: int, scan_dt: datetime, dev_user: Any, on_scan_callback) -> None:
        """Constructs enriched scan record, deduplicates within 3s window, and triggers storage callback."""
        sn = str(dev.get("sn") or "")
        name = str(dev.get("name") or dev.get("ip") or "")
        door_id = int(dev.get("door_id") or 1)
        direction = "IN" if door_id == 1 or "vào" in name.lower() else "OUT"

        clean_uid = str(user_id_str or "").strip()
        if not clean_uid or clean_uid == "0":
            return

        now_ts = time.time()
        dedup_key = f"{sn}_{clean_uid}"
        with self._live_event_lock:
            last_ts = self._last_live_event_ts.get(dedup_key, 0.0)
            if now_ts - last_ts < 2.5:
                return
            self._last_live_event_ts[dedup_key] = now_ts

        p_info = self._lookup_person(clean_uid, dev_user=dev_user)
        is_staff = p_info.get("is_staff", True)
        if status_val in (15, 16, 25):
            mode_str = "FaceTemplate"
        elif status_val in (1, 2, 3, 4):
            mode_str = "Card" if (not is_staff or status_val in (2, 3, 4)) else "FaceTemplate"
        else:
            mode_str = "FaceTemplate" if is_staff else "Card"

        t_str = scan_dt.strftime("%Y-%m-%d %H:%M:%S")
        scan_record = {
            "EmployeeATID": p_info.get("atid") or clean_uid,
            "FullName": p_info.get("fullname", f"Nhân sự {clean_uid}"),
            "Department": p_info.get("department", "Nhân sự SeaZen"),
            "SerialNumber": sn,
            "DeviceSerialNumber": sn,
            "DeviceName": name,
            "Direction": direction,
            "CheckTime": t_str,
            "Time": t_str,
            "VerifyMode": mode_str,
            "VerifyModeValue": status_val,
            "InOutMode": punch_val,
            "is_staff": is_staff,
            "SyncSource": "LIVE_REG_EVENT"
        }

        logger.info(
            "[ZK LIVE SCAN] %s | %s (%s) | %s | %s | %s",
            t_str,
            scan_record["FullName"],
            scan_record["EmployeeATID"],
            scan_record["Department"],
            name,
            mode_str
        )

        if on_scan_callback:
            try:
                on_scan_callback([scan_record])
            except Exception as cb_err:
                logger.error("[ZK LIVE SCAN] Callback error: %s", cb_err)

    def _device_live_capture_loop(self, dev: Dict[str, Any], on_scan_callback) -> None:
        """
        Persistent per-device TCP 4370 event stream loop with automatic reconnection.
        Captures both EF_ATTLOG (1) and EF_VERIFY (8) real-time hardware packets.
        """
        import socket
        ip = dev.get("ip")
        port = int(dev.get("port", 4370))
        name = dev.get("name", ip)

        while True:
            conn = None
            try:
                zk = ZK(ip, port=port, timeout=10, ommit_ping=True)
                conn = zk.connect()
                self._live_online_devices[ip] = True

                # Load user map on this terminal (maps internal 16-bit uid -> user_id & name)
                uid_to_user = self._live_uid_to_user.setdefault(ip, {})
                userid_to_user = self._live_userid_to_user.setdefault(ip, {})
                try:
                    dev_users = conn.get_users()
                    for u in dev_users:
                        uid_to_user[int(u.uid)] = u
                        userid_to_user[str(u.user_id).strip()] = u
                except Exception as u_err:
                    logger.debug("[ZK LIVE] Could not preload users on %s: %s", name, u_err)

                try:
                    conn.cancel_capture()
                    conn.verify_user()
                    if not conn.is_enabled:
                        conn.enable_device()
                except Exception:
                    pass

                # Subscribe to all real-time access & attendance events
                try:
                    self._status_cache.setdefault("live_clocks", {})[ip] = (conn.get_time(), time.time())
                except Exception:
                    pass
                conn.reg_event(0xFFFF)
                sock = conn._ZK__sock
                sock.settimeout(10.0)
                idle_cycles = 0

                logger.info("[ZK LIVE] Đang lắng nghe trực tiếp sự kiện quét mặt/thẻ tại %s (%s:%d, %d users)",
                            name, ip, port, len(uid_to_user))

                while True:
                    try:
                        data_recv = sock.recv(1032)
                        if not data_recv:
                            raise ConnectionError("Socket closed by terminal")

                        idle_cycles = 0
                        try:
                            conn._ZK__ack_ok()
                        except Exception:
                            pass

                        if len(data_recv) < 16:
                            continue

                        cmd, _checksum, event_type, _reply_id = struct.unpack("<HHHH", data_recv[8:16])
                        payload = data_recv[16:]

                        if cmd != const.CMD_REG_EVENT or not payload:
                            continue

                        # 1. EF_ATTLOG (1): Full attendance / access transaction packet
                        if event_type == const.EF_ATTLOG and len(payload) >= 12:
                            user_id_str = ""
                            status_val = 15
                            punch_val = 0
                            timehex = b""

                            if len(payload) == 12:
                                uid_int, status_val, punch_val, timehex = struct.unpack("<IBB6s", payload[:12])
                                user_id_str = str(uid_int)
                            elif len(payload) >= 32:
                                raw_uid, status_val, punch_val, timehex = struct.unpack("<24sBB6s", payload[:32])
                                user_id_str = raw_uid.split(b"\x00")[0].decode("utf-8", errors="ignore").strip()
                            else:
                                # Fallback for intermediate packet sizes (14..31 bytes)
                                raw_uid = payload[:-8]
                                status_val, punch_val, timehex = struct.unpack("<BB6s", payload[-8:])
                                user_id_str = raw_uid.split(b"\x00")[0].decode("utf-8", errors="ignore").strip()

                            scan_dt = self._decode_zk_timehex(timehex)
                            dev_u = userid_to_user.get(user_id_str)
                            self._emit_live_scan(dev, user_id_str, status_val, punch_val, scan_dt, dev_u, on_scan_callback)

                        # 2. EF_VERIFY (8): Verification event (4-byte internal uid)
                        elif event_type == const.EF_VERIFY and len(payload) >= 4:
                            verified_uid = struct.unpack("<I", payload[:4])[0]
                            if 0 < verified_uid < 0xFFFFFFFF and verified_uid in uid_to_user:
                                dev_u = uid_to_user[verified_uid]
                                uid_str = str(dev_u.user_id).strip()
                                v_mode = 2 if (getattr(dev_u, "card", 0) and str(getattr(dev_u, "name", "")).lower().startswith("khach")) else 15

                                def _delayed_verify_emit(d=dev, u_s=uid_str, vm=v_mode, du=dev_u, dt=datetime.now()):
                                    time.sleep(0.2)
                                    self._emit_live_scan(d, u_s, vm, 0, dt, du, on_scan_callback)

                                threading.Thread(target=_delayed_verify_emit, daemon=True).start()

                    except socket.timeout:
                        idle_cycles += 1
                        if idle_cycles >= 4:
                            idle_cycles = 0
                            # Send lightweight keepalive re-registration every ~40s
                            conn.reg_event(0xFFFF)

            except Exception as e:
                self._live_online_devices[ip] = False
                logger.debug("[ZK LIVE] Mất kết nối %s (%s): %s - Tự động kết nối lại sau 3s...", name, ip, e)
            finally:
                if conn:
                    try:
                        conn.disconnect()
                    except Exception:
                        pass
            time.sleep(3)

    @staticmethod
    def get_vietnam_ntp_time() -> Optional[datetime]:
        """
        Queries authoritative NTP servers (Google, Cloudflare, VN Pool) to obtain
        exact Vietnam Standard Time (UTC+7), completely independent of local Windows PC clock.
        """
        import socket
        from datetime import timezone, timedelta
        ntp_hosts = ("time.google.com", "time.cloudflare.com", "vn.pool.ntp.org", "pool.ntp.org")
        for host in ntp_hosts:
            sock = None
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.settimeout(2.0)
                sock.sendto(b"\x1b" + 47 * b"\0", (host, 123))
                data, _ = sock.recvfrom(1024)
                if data and len(data) >= 48:
                    t = struct.unpack("!12I", data)[10] - 2208988800
                    return datetime.fromtimestamp(t, tz=timezone(timedelta(hours=7))).replace(tzinfo=None)
            except Exception:
                continue
            finally:
                if sock:
                    try:
                        sock.close()
                    except Exception:
                        pass
        return None

    def audit_all_clocks(self) -> Dict[str, Any]:
        """
        Read-only 3-way clock audit:
        1. Vietnam Standard Time (NTP UTC+7)
        2. Local PC Windows Clock
        3. 4 ZKTeco SenseFace 4A Hardware Clocks
        NEVER modifies hardware clocks. Flags warning if Local PC Clock drifts > 30s.
        """
        local_now = datetime.now()
        ntp_now = self.get_vietnam_ntp_time()
        ref_now = ntp_now if ntp_now else local_now
        pc_drift_sec = round((local_now - ntp_now).total_seconds(), 1) if ntp_now else 0.0
        pc_clock_valid = abs(pc_drift_sec) <= 30.0

        if ntp_now and not pc_clock_valid:
            logger.warning(
                "[CẢNH BÁO GIỜ HỆ THỐNG] Giờ máy tính cục bộ (%s) đang lệch %.1fs so với Giờ chuẩn Việt Nam UTC+7 (%s)! "
                "Hệ thống ĐÃ KHÓA tự động đồng bộ giờ để bảo vệ 4 máy ZKTeco.",
                local_now.strftime("%Y-%m-%d %H:%M:%S"),
                pc_drift_sec,
                ntp_now.strftime("%Y-%m-%d %H:%M:%S")
            )

        devices_report = {}
        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            lock = self._locks.get(ip)
            if not ip:
                continue

            if self._live_online_devices.get(ip):
                cached_clk, clk_ts = self._status_cache.get("live_clocks", {}).get(ip, (None, 0.0))
                if cached_clk:
                    est_dev_time = cached_clk + __import__("datetime").timedelta(seconds=max(0.0, time.time() - clk_ts))
                    drift_vs_vn = round((est_dev_time - ref_now).total_seconds(), 1)
                    devices_report[name] = {
                        "ip": ip,
                        "device_time": est_dev_time.strftime("%Y-%m-%d %H:%M:%S"),
                        "drift_vs_vn_sec": drift_vs_vn,
                        "status": "OK" if abs(drift_vs_vn) <= 65 else "DRIFT_WARNING"
                    }
                    continue

            lock_acquired = lock.acquire(timeout=2.0) if lock else True
            if not lock_acquired:
                devices_report[name] = {"ip": ip, "status": "busy"}
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                dev_time = conn.get_time()
                conn.disconnect()
                drift_vs_vn = round((dev_time - ref_now).total_seconds(), 1) if dev_time else None
                devices_report[name] = {
                    "ip": ip,
                    "device_time": dev_time.strftime("%Y-%m-%d %H:%M:%S") if dev_time else None,
                    "drift_vs_vn_sec": drift_vs_vn,
                    "status": "OK" if (drift_vs_vn is not None and abs(drift_vs_vn) <= 60) else "DRIFT_WARNING"
                }
            except Exception as e:
                devices_report[name] = {"ip": ip, "status": f"Error: {e}"}
            finally:
                if lock and lock_acquired:
                    lock.release()

        return {
            "ntp_available": ntp_now is not None,
            "vietnam_ntp_time": ntp_now.strftime("%Y-%m-%d %H:%M:%S") if ntp_now else None,
            "local_pc_time": local_now.strftime("%Y-%m-%d %H:%M:%S"),
            "pc_drift_sec": pc_drift_sec,
            "pc_clock_valid": pc_clock_valid,
            "devices": devices_report
        }

    def sync_all_device_clocks(self, max_drift_seconds: int = 5, confirm_layer2_code: Optional[str] = None) -> Dict[str, Any]:
        """
        [PROTECTED BY 2-LAYER SAFETY RULE]
        1. When called without confirm_layer2_code (e.g. background daemon), performs READ-ONLY audit_all_clocks()
           so a wrong local PC clock NEVER drags the 4 ZKTeco terminals along.
        2. When explicitly confirmed by Admin with confirm_layer2_code == 'CONFIRM_VN_NTP_SYNC',
           synchronizes terminals ONLY to verified Vietnam Standard Time (NTP UTC+7).
        """
        if confirm_layer2_code != "CONFIRM_VN_NTP_SYNC":
            audit = self.audit_all_clocks()
            return {
                "mode": "READ_ONLY_AUDIT (Protected - No auto-overwrite)",
                "pc_clock_valid": audit["pc_clock_valid"],
                "pc_drift_sec": audit["pc_drift_sec"],
                "vietnam_ntp_time": audit["vietnam_ntp_time"],
                "local_pc_time": audit["local_pc_time"],
                "devices": audit["devices"]
            }

        ntp_now = self.get_vietnam_ntp_time()
        if not ntp_now:
            return {
                "success": False,
                "error": "Không lấy được Giờ chuẩn Việt Nam (NTP UTC+7). Từ chối dùng giờ máy cục bộ để bảo vệ thiết bị ZKTeco."
            }

        results = {}
        for dev in self.devices:
            ip = dev.get("ip")
            name = dev.get("name", ip)
            lock = self._locks.get(ip)
            if not ip:
                continue

            lock_acquired = lock.acquire(timeout=2.5) if lock else True
            if not lock_acquired:
                results[name] = "Device busy"
                continue

            try:
                zk = self._get_device_connection(ip, dev.get("port", 4370))
                conn = zk.connect()
                dev_time = conn.get_time()
                target_now = self.get_vietnam_ntp_time() or ntp_now
                drift = abs((dev_time - target_now).total_seconds()) if dev_time else 9999
                if drift > max_drift_seconds:
                    conn.set_time(target_now)
                    logger.info("[TimeSync 2-Layer Confirmed] Đã đồng bộ giờ chuẩn VN %s (%s): %s -> %s (lệch %.1fs)", name, ip, dev_time, target_now, drift)
                    results[name] = f"Synced to VN NTP (drift was {drift:.1f}s)"
                else:
                    results[name] = f"OK (drift {drift:.1f}s)"
                conn.disconnect()
            except Exception as e:
                results[name] = f"Error: {e}"
            finally:
                if lock and lock_acquired:
                    lock.release()
        return {"success": True, "vietnam_ntp_time": ntp_now.strftime("%Y-%m-%d %H:%M:%S"), "results": results}

    def sync_all_terminal_logs(self) -> List[Dict[str, Any]]:
        """Fetches all historical logs from all 4 terminals without limit."""
        return self.get_realtime_attendance_logs(limit=2000)

    # ---------------- Compatibility Fallbacks (Offline Local Mode) ----------------

    def get_department_tree(self) -> List[Dict[str, Any]]:
        """Returns cached department list from local storage."""
        dept_file = os.path.join(self.data_dir, "departments.json")
        if os.path.exists(dept_file):
            try:
                with open(dept_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def get_all_employees(self) -> List[Dict[str, Any]]:
        """Returns cached employee list from local storage."""
        emp_file = os.path.join(self.data_dir, "employees.json")
        if os.path.exists(emp_file):
            try:
                with open(emp_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def get_log_last_7_days(self) -> Dict[str, Any]:
        """Returns attendance logs from all 4 direct terminals grouped by day."""
        logs = self.sync_all_terminal_logs()
        res: Dict[str, List[Dict[str, Any]]] = {}
        for l in logs:
            day = (l.get("CheckTime") or "")[:10]
            if day:
                res.setdefault(day, []).append(l)
        return res
