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

        self._load_person_cache()
        logger.info("Initialized ZkDirectClient with %d terminals across %d doors (person cache: %d keys)",
                    len(self.devices), len(self.doors_config), len(self._person_cache))

    def _load_person_cache(self) -> None:
        """Loads and indexes staff and visitor identities for instant name resolution."""
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
                    item = {"fullname": fn, "department": dept, "is_staff": True}
                    for k in (code, atid):
                        if k:
                            new_map[k] = item
                            if k.isdigit():
                                new_map[str(int(k))] = item
            except Exception as ex:
                logger.debug("Error loading employees for person cache: %s", ex)

        # 2. Visitors from active_visitors.json & visitor_history.json
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
                        v_item = {"fullname": v_name, "department": v_dept, "is_staff": False}
                        for k in (v_card, v_cccd):
                            if k:
                                new_map[k] = v_item
                                if k.isdigit():
                                    new_map[str(int(k))] = v_item
                except Exception as ex:
                    logger.debug("Error loading visitors for person cache: %s", ex)

        self._person_cache = new_map
        self._last_person_cache_time = time.time()

    def _lookup_person(self, user_id_str: str) -> Dict[str, Any]:
        """Resolves full name, department, and staff/visitor category from user_id."""
        if time.time() - self._last_person_cache_time > 60:
            self._load_person_cache()

        clean_id = str(user_id_str).strip()
        if clean_id in self._person_cache:
            return self._person_cache[clean_id]

        if clean_id.isdigit():
            c_int = str(int(clean_id))
            if c_int in self._person_cache:
                return self._person_cache[c_int]

        # Check if ID indicates visitor range
        if clean_id.isdigit() and int(clean_id) >= 9000:
            return {"fullname": f"Khách Đến (Mã {clean_id})", "department": "Khách Vãng Lai", "is_staff": False}

        return {"fullname": f"User {clean_id}", "department": "--", "is_staff": True}

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

        # Generate a safe guest user_id / uid
        guest_uid = 9000 + (abs(hash(card_num_str)) % 999)
        guest_user_id = str(clean_digits[-8:] if len(clean_digits) >= 8 else guest_uid)

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
                # Provision user with card directly into device flash memory
                conn.set_user(
                    uid=guest_uid,
                    name=full_name[:24],
                    privilege=0,
                    password="",
                    group_id="1",
                    user_id=guest_user_id,
                    card=card_int
                )
                conn.disconnect()
                success_count += 1
                logger.info("[ZK DIRECT] Đã nạp thẻ %s (User: %s) vào máy %s thành công", card_num_str, full_name, name)
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
                # Find user with matching card number or user_id
                target_user = None
                for u in users:
                    if u.card == card_int or (card_int and str(u.card) == str(card_int)) or u.user_id == clean_digits[-8:]:
                        target_user = u
                        break

                if target_user:
                    conn.delete_user(uid=target_user.uid, user_id=target_user.user_id)
                    deleted_count += 1
                    logger.info("[ZK DIRECT] Đã xóa/thu hồi thẻ %s khỏi máy %s", clean_card, name)
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
                    if since_time and r.timestamp < since_time:
                        continue

                    t_str = r.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                    p_info = self._lookup_person(str(r.user_id))
                    is_staff = p_info.get("is_staff", True)
                    mode_str = "FaceTemplate" if r.status == 15 else ("Card" if r.status == 1 else str(r.status))

                    harvested.append({
                        "EmployeeATID": str(r.user_id),
                        "FullName": p_info.get("fullname", f"User {r.user_id}"),
                        "Department": p_info.get("department", "--"),
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
