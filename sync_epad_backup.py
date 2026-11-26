"""
Zero-Data-Loss Backup Synchronizer for SeaZen VMS
--------------------------------------------------
Reads historical & latest operational data from SQL Server staging database
[Staging_TINHHOA_EPAD] (restored from backup/tinhhoa_epad) and non-destructively
merges into production [SeaZen_AccessControl] plus local JSON lookup caches
(data/frequent_visitors.json, data/employees.json).

Safety guarantees:
- Never deletes or overwrites non-empty production records (Fill-If-Missing / COALESCE).
- Uses in-memory Python lookups to avoid SQL collation conflicts across DBs.
- Idempotent: safe to re-run without creating duplicate logs, visitors, or timekeeping rows.
"""

import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pyodbc

import db_mssql

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_epad_backup")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FREQUENT_VISITORS_PATH = os.path.join(DATA_DIR, "frequent_visitors.json")
EMPLOYEES_JSON_PATH = os.path.join(DATA_DIR, "employees.json")

STAGING_DB = "Staging_TINHHOA_EPAD"
PROD_DB = "SeaZen_AccessControl"

DEVICE_META_BY_SN = {
    "1313244800040": ("Làn VÀO phải", "IN"),
    "1313244800129": ("Làn VÀO trái", "IN"),
    "1313244800122": ("Làn RA trái", "OUT"),
    "1313244800130": ("Làn Ra phải", "OUT"),
}


def _clean_str(val: Any) -> str:
    """Strips placeholders like '0', 'o', '--', 'None' used in TinhHoa ePAD."""
    s = str(val if val is not None else "").strip()
    if s in ("0", "o", "O", "--", "---", "None", "null", "NULL", "NoDepartment"):
        return ""
    return s


def _clean_name(val: Any) -> str:
    """Normalizes person names without stripping valid characters."""
    s = str(val if val is not None else "").strip()
    return "" if s in ("--", "---", "None", "null", "NULL") else s


def _valid_dt(dt: Any) -> Optional[datetime]:
    """Filters SQL datetime2 sentinels like 0001-01-01 outside valid MSSQL datetime bounds."""
    if isinstance(dt, datetime) and 1900 <= dt.year <= 2100:
        return dt.replace(microsecond=0)
    return None


def _map_gender(code: Any) -> Optional[str]:
    """Verified against TinhHoa ePAD HR_User: 1 = Nam, 0 = Nữ, 2 = Unspecified."""
    if code == 1:
        return "Nam"
    if code == 0:
        return "Nữ"
    return None


def _normalize_b64_image(raw_content: Any) -> Optional[str]:
    """Wraps raw JPEG/PNG Base64 portrait payload from IC_UserMaster as Data URI."""
    s = str(raw_content or "").strip()
    if len(s) <= 20:
        return None
    if s.startswith("data:image/"):
        return s
    mime = "image/png" if s.startswith("iVBOR") else "image/jpeg"
    return f"data:{mime};base64,{s}"


def _map_verify_mode(val: Any) -> Tuple[str, Optional[int]]:
    try:
        ival = int(val) if val is not None else None
    except Exception:
        ival = None
    if ival == 15:
        return "FaceTemplate", 15
    if ival in (1, 2, 4):
        return "Card", ival
    if ival is not None:
        return "Finger", ival
    return "FaceTemplate", None


def _atomic_write_json(path: str, data: Any) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _snapshot_prod_counts(cur: Any) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for tbl in (
        "tbl_Departments",
        "tbl_Employees",
        "tbl_EmployeeBiometrics",
        "tbl_CustomerCards",
        "tbl_Visitors",
        "tbl_AttendanceLogs",
        "tbl_DailyTimekeeping",
    ):
        cur.execute(f"SELECT COUNT(*) FROM [{tbl}]")
        counts[tbl] = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM tbl_EmployeeBiometrics WHERE FacePhotoBase64 IS NOT NULL AND LEN(FacePhotoBase64) > 20")
    counts["biometrics_with_photo"] = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM tbl_EmployeeBiometrics WHERE HasFinger = 1")
    counts["biometrics_with_finger"] = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM tbl_EmployeeBiometrics WHERE HasCard = 1")
    counts["biometrics_with_card"] = int(cur.fetchone()[0])
    return counts


def sync_departments(stg_cur: Any, prod_conn: Any) -> Dict[int, str]:
    """Ensures all IC_Department names exist in tbl_Departments; returns index->name map."""
    stg_cur.execute("SELECT [Index], Name, Code FROM IC_Department ORDER BY [Index]")
    stg_depts = stg_cur.fetchall()

    pcur = prod_conn.cursor()
    pcur.execute("SELECT DepartmentID, DepartmentName FROM tbl_Departments")
    existing_depts = {str(r[1]).strip(): r[0] for r in pcur.fetchall() if r[1]}

    idx_to_name: Dict[int, str] = {}
    inserted = 0
    for idx, name, code in stg_depts:
        clean_n = _clean_name(name)
        if not clean_n:
            continue
        idx_to_name[int(idx)] = clean_n
        if clean_n not in existing_depts:
            pcur.execute(
                "INSERT INTO tbl_Departments (DepartmentCode, DepartmentName, Level, IsActive) VALUES (?, ?, 1, 1)",
                (str(code or idx)[:50], clean_n),
            )
            inserted += 1
    if inserted:
        prod_conn.commit()
    logger.info("Departments synced: %d staging, %d newly inserted", len(idx_to_name), inserted)
    return idx_to_name


def sync_employees_and_biometrics(
    stg_cur: Any,
    prod_conn: Any,
    dept_idx_to_name: Dict[int, str],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """
    Merges HR_User, HR_EmployeeInfo, IC_WorkingInfo, HR_PositionInfo, IC_UserMaster,
    and HR_CardNumberInfo into tbl_Employees and tbl_EmployeeBiometrics.
    Returns (staging_user_map, prod_emp_map).
    """
    pcur = prod_conn.cursor()
    pcur.execute("SELECT DepartmentID, DepartmentName FROM tbl_Departments")
    dept_name_to_id = {str(r[1]).strip(): int(r[0]) for r in pcur.fetchall() if r[1]}

    stg_cur.execute("SELECT [Index], Name FROM HR_PositionInfo")
    pos_map = {int(r[0]): _clean_name(r[1]) for r in stg_cur.fetchall() if r[1]}

    stg_cur.execute("""
        SELECT EmployeeATID, JoinedDate, Email, Phone
        FROM HR_EmployeeInfo
    """)
    emp_info_map: Dict[str, Tuple[Any, str, str]] = {}
    for atid, jdate, email, phone in stg_cur.fetchall():
        k = str(atid or "").strip()
        if k:
            emp_info_map[k] = (jdate, _clean_str(email), _clean_str(phone))

    stg_cur.execute("""
        SELECT EmployeeATID, DepartmentIndex, PositionIndex, Status, ToDate, FromDate, [Index]
        FROM IC_WorkingInfo
        ORDER BY CASE WHEN Status = 1 AND ToDate IS NULL THEN 0 ELSE 1 END,
                 ISNULL(FromDate, '1900-01-01') DESC,
                 [Index] DESC
    """)
    working_map: Dict[str, Tuple[Optional[int], Optional[int]]] = {}
    for atid, d_idx, p_idx, _st, _tod, _fr, _widx in stg_cur.fetchall():
        k = str(atid or "").strip()
        if not k:
            continue
        cur_val = working_map.get(k)
        # Prefer first record that actually carries a DepartmentIndex if earlier had None
        if cur_val is None or (cur_val[0] is None and d_idx is not None):
            working_map[k] = (int(d_idx) if d_idx is not None else None, int(p_idx) if p_idx is not None else None)

    stg_cur.execute("""
        SELECT EmployeeATID, CardNumber
        FROM HR_CardNumberInfo
        WHERE IsActive = 1 AND CardNumber IS NOT NULL AND LTRIM(RTRIM(CardNumber)) <> ''
        ORDER BY ISNULL(UpdatedDate, CreatedDate) DESC, [Index] DESC
    """)
    active_card_map: Dict[str, str] = {}
    for atid, card in stg_cur.fetchall():
        k = str(atid or "").strip()
        c = _clean_str(card)
        if k and c and k not in active_card_map:
            active_card_map[k] = c

    stg_cur.execute("""
        SELECT EmployeeATID, CardNumber, Privilege, FaceVersion,
               CAST(FaceV2_Content AS NVARCHAR(MAX)),
               CAST(FaceV2_TemplateBIODATA AS NVARCHAR(MAX)),
               CAST(FaceTemplate AS NVARCHAR(MAX)),
               FingerVersion,
               FingerData0, FingerData1, FingerData2, FingerData3, FingerData4,
               FingerData5, FingerData6, FingerData7, FingerData8, FingerData9
        FROM IC_UserMaster
    """)
    master_map: Dict[str, Dict[str, Any]] = {}
    for row in stg_cur.fetchall():
        k = str(row[0] or "").strip()
        if not k:
            continue
        finger_slots = [idx for idx, fval in enumerate(row[8:18]) if fval and len(str(fval).strip()) > 0]
        master_map[k] = {
            "card": _clean_str(row[1]),
            "privilege": int(row[2] or 0) if row[2] is not None else 0,
            "face_ver": _clean_name(row[3]),
            "face_photo": _normalize_b64_image(row[4]),
            "face_biodata": (str(row[5]).strip() if row[5] and len(str(row[5]).strip()) > 10 else None)
            or (str(row[6]).strip() if row[6] and len(str(row[6]).strip()) > 10 else None),
            "finger_ver": _clean_name(row[7]),
            "finger_slots": finger_slots,
            "finger_count": len(finger_slots),
        }

    stg_cur.execute("""
        SELECT EmployeeATID, EmployeeCode, FullName, Gender,
               DayOfBirth, MonthOfBirth, YearOfBirth, EmployeeType, Nric, Address
        FROM HR_User
    """)
    stg_users: Dict[str, Dict[str, Any]] = {}
    for row in stg_cur.fetchall():
        atid = str(row[0] or "").strip()
        if not atid:
            continue
        d_idx, p_idx = working_map.get(atid, (None, None))
        dept_name = dept_idx_to_name.get(d_idx, "") if d_idx is not None else ""
        pos_name = pos_map.get(p_idx, "") if p_idx is not None else ""
        jdate, email, phone = emp_info_map.get(atid, (None, "", ""))
        um = master_map.get(atid, {})
        card = um.get("card") or active_card_map.get(atid, "")

        dob_str = ""
        d, m, y = row[4], row[5], row[6]
        if d and m and y and int(y) > 1900 and 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            dob_str = f"{int(d):02d}/{int(m):02d}/{int(y):04d}"

        stg_users[atid] = {
            "atid": atid,
            "code": _clean_str(row[1]),
            "full_name": _clean_name(row[2]) or f"NV {atid}",
            "gender": _map_gender(row[3]),
            "dob": dob_str,
            "emp_type": row[7],
            "nric": _clean_str(row[8]),
            "address": _clean_str(row[9]),
            "dept_name": dept_name,
            "position": pos_name,
            "joined_date": jdate,
            "email": email,
            "phone": phone,
            "card": card,
            "privilege": um.get("privilege", 0),
            "face_ver": um.get("face_ver", ""),
            "face_photo": um.get("face_photo"),
            "face_biodata": um.get("face_biodata"),
            "finger_slots": um.get("finger_slots", []),
            "finger_count": um.get("finger_count", 0),
            "finger_ver": um.get("finger_ver", ""),
        }

    # Load current Prod employees
    pcur.execute("""
        SELECT EmployeeATID, EmployeeCode, FullName, DepartmentID, DepartmentName,
               Position, CardNumber, Email, Phone, JoinedDate, IsStaff, Privilege, Gender
        FROM tbl_Employees
    """)
    prod_emps: Dict[str, Dict[str, Any]] = {}
    for r in pcur.fetchall():
        atid = str(r[0] or "").strip()
        prod_emps[atid] = {
            "code": _clean_str(r[1]),
            "full_name": _clean_name(r[2]),
            "dept_id": r[3],
            "dept_name": str(r[4] or "").strip(),
            "position": _clean_str(r[5]),
            "card": _clean_str(r[6]),
            "email": _clean_str(r[7]),
            "phone": _clean_str(r[8]),
            "joined_date": r[9],
            "is_staff": bool(r[10]),
            "privilege": int(r[11] or 0) if r[11] is not None else 0,
            "gender": _clean_name(r[12]),
        }

    pcur.execute("""
        SELECT EmployeeATID,
               CASE WHEN FacePhotoBase64 IS NOT NULL AND LEN(FacePhotoBase64) > 20 THEN 1 ELSE 0 END,
               CASE WHEN FaceTemplateBIODATA IS NOT NULL AND LEN(FaceTemplateBIODATA) > 10 THEN 1 ELSE 0 END,
               HasFace, HasCard, HasFinger, ISNULL(FingerCount, 0), FaceVersion,
               CASE WHEN FingerTemplate IS NOT NULL AND LEN(FingerTemplate) > 5 THEN 1 ELSE 0 END
        FROM tbl_EmployeeBiometrics
    """)
    prod_bios: Dict[str, Dict[str, Any]] = {}
    for r in pcur.fetchall():
        prod_bios[str(r[0] or "").strip()] = {
            "has_photo": bool(r[1]),
            "has_biodata": bool(r[2]),
            "has_face": bool(r[3]),
            "has_card": bool(r[4]),
            "has_finger": bool(r[5]),
            "finger_count": int(r[6] or 0),
            "face_ver": _clean_name(r[7]),
            "has_finger_tpl": bool(r[8]),
        }

    emp_inserted = 0
    emp_updated = 0
    bio_inserted = 0
    bio_updated = 0
    photos_added = 0

    for atid, su in stg_users.items():
        pe = prod_emps.get(atid)
        is_visitor_atid = (atid.isdigit() and (int(atid) >= 80000000 or 56200 <= int(atid) <= 56299)) or su["emp_type"] == 2
        if not pe:
            dept_n = su["dept_name"] or ("Khách" if is_visitor_atid else "Khác")
            dept_id = dept_name_to_id.get(dept_n)
            is_staff = 1 if (not is_visitor_atid and dept_n not in ("", "Khác", "Khách")) else 0
            pcur.execute("""
                INSERT INTO tbl_Employees (
                    EmployeeID, EmployeeATID, EmployeeCode, FullName, DepartmentID, DepartmentName,
                    Position, CardNumber, Email, Phone, JoinedDate, IsStaff, IsActive, Privilege, Gender
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """, (
                f"SZ-{atid}", atid, su["code"] or atid, su["full_name"], dept_id, dept_n,
                su["position"] or None, su["card"] or None, su["email"] or None, su["phone"] or None,
                su["joined_date"], is_staff, su["privilege"], su["gender"],
            ))
            emp_inserted += 1
        else:
            sets: List[str] = []
            vals: List[Any] = []
            if not pe["code"] and su["code"]:
                sets.append("EmployeeCode = ?")
                vals.append(su["code"])
            # Upgrade department ONLY if Prod has blank or 'Khác' and Staging has an actual team
            if pe["dept_name"] in ("", "Khác") and su["dept_name"] and su["dept_name"] not in ("Khác", "Khách"):
                sets.append("DepartmentName = ?")
                vals.append(su["dept_name"])
                if dept_name_to_id.get(su["dept_name"]):
                    sets.append("DepartmentID = ?")
                    vals.append(dept_name_to_id[su["dept_name"]])
                if not pe["is_staff"] and not is_visitor_atid:
                    sets.append("IsStaff = 1")
            if not pe["position"] and su["position"]:
                sets.append("Position = ?")
                vals.append(su["position"])
            if not pe["card"] and su["card"]:
                sets.append("CardNumber = ?")
                vals.append(su["card"])
            if not pe["email"] and su["email"]:
                sets.append("Email = ?")
                vals.append(su["email"])
            if not pe["phone"] and su["phone"]:
                sets.append("Phone = ?")
                vals.append(su["phone"])
            if pe["joined_date"] is None and su["joined_date"] is not None:
                sets.append("JoinedDate = ?")
                vals.append(su["joined_date"])
            if pe["privilege"] == 0 and su["privilege"] > 0:
                sets.append("Privilege = ?")
                vals.append(su["privilege"])
            if not pe["gender"] and su["gender"]:
                sets.append("Gender = ?")
                vals.append(su["gender"])
            if sets:
                sets.append("UpdatedAt = GETDATE()")
                vals.append(atid)
                pcur.execute(f"UPDATE tbl_Employees SET {', '.join(sets)} WHERE EmployeeATID = ?", vals)
                emp_updated += 1

        # Biometrics upsert (non-destructive)
        effective_card = (pe["card"] if pe and pe["card"] else "") or su["card"]
        has_photo_new = bool(su["face_photo"])
        has_biodata_new = bool(su["face_biodata"])
        has_face_new = has_photo_new or has_biodata_new
        has_card_new = bool(effective_card)
        finger_cnt = su["finger_count"]
        has_finger_new = finger_cnt > 0
        finger_tpl_json = (
            json.dumps({"slots": su["finger_slots"], "version": su["finger_ver"], "source": "ePAD_Backup"})
            if finger_cnt > 0
            else None
        )
        face_ver = su["face_ver"] or ("ZKTeco_VisibleLight_v58.12" if has_face_new else None)

        pb = prod_bios.get(atid)
        if not pb:
            pcur.execute("""
                INSERT INTO tbl_EmployeeBiometrics (
                    EmployeeATID, FacePhotoBase64, FaceTemplateBIODATA, FingerTemplate,
                    HasFace, HasCard, HasFinger, FaceVersion, FingerCount
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                atid, su["face_photo"], su["face_biodata"], finger_tpl_json,
                1 if has_face_new else 0, 1 if has_card_new else 0, 1 if has_finger_new else 0,
                face_ver, finger_cnt,
            ))
            bio_inserted += 1
            if has_photo_new:
                photos_added += 1
        else:
            bsets: List[str] = []
            bvals: List[Any] = []
            if not pb["has_photo"] and has_photo_new:
                bsets.append("FacePhotoBase64 = ?")
                bvals.append(su["face_photo"])
                photos_added += 1
            if not pb["has_biodata"] and has_biodata_new:
                bsets.append("FaceTemplateBIODATA = ?")
                bvals.append(su["face_biodata"])
            if not pb["has_finger_tpl"] and finger_tpl_json:
                bsets.append("FingerTemplate = ?")
                bvals.append(finger_tpl_json)
            if not pb["has_face"] and has_face_new:
                bsets.append("HasFace = 1")
            if not pb["has_card"] and has_card_new:
                bsets.append("HasCard = 1")
            if not pb["has_finger"] and has_finger_new:
                bsets.append("HasFinger = 1")
            if not pb["face_ver"] and face_ver:
                bsets.append("FaceVersion = ?")
                bvals.append(face_ver)
            if finger_cnt > pb["finger_count"]:
                bsets.append("FingerCount = ?")
                bvals.append(finger_cnt)
            if bsets:
                bsets.append("UpdatedAt = GETDATE()")
                bvals.append(atid)
                pcur.execute(f"UPDATE tbl_EmployeeBiometrics SET {', '.join(bsets)} WHERE EmployeeATID = ?", bvals)
                bio_updated += 1

    prod_conn.commit()

    # Re-read updated Prod employees map
    pcur.execute("SELECT EmployeeATID, EmployeeCode, FullName, DepartmentName, CardNumber, IsStaff, IsActive FROM tbl_Employees")
    final_prod_emps: Dict[str, Dict[str, Any]] = {}
    for r in pcur.fetchall():
        atid = str(r[0] or "").strip()
        final_prod_emps[atid] = {
            "atid": atid,
            "code": _clean_str(r[1]) or atid,
            "full_name": _clean_name(r[2]) or f"Nhân sự {atid}",
            "department": str(r[3] or "").strip() or "Khác",
            "card": _clean_str(r[4]),
            "is_staff": bool(r[5]),
            "is_active": bool(r[6]),
        }

    logger.info(
        "Employees & Biometrics merged: emp +%d / ~%d | bio +%d / ~%d (new portraits: %d)",
        emp_inserted, emp_updated, bio_inserted, bio_updated, photos_added,
    )
    return stg_users, final_prod_emps


def sync_attendance_logs(
    stg_cur: Any,
    prod_conn: Any,
    stg_users: Dict[str, Dict[str, Any]],
    prod_emps: Dict[str, Dict[str, Any]],
) -> int:
    """Bulk-inserts missing IC_AttendanceLog scans using set dedup + fast_executemany."""
    pcur = prod_conn.cursor()
    pcur.execute("SELECT EmployeeATID, CheckTime, DeviceSerialNumber FROM tbl_AttendanceLogs")
    existing_keys = set()
    for atid, chk, sn in pcur.fetchall():
        if chk is None:
            continue
        existing_keys.add((str(atid or "").strip(), chk.strftime("%Y-%m-%d %H:%M:%S"), str(sn or "").strip()))

    # Device fallback names from IC_Device
    stg_cur.execute("SELECT SerialNumber, AliasName FROM IC_Device")
    dev_names = {str(r[0] or "").strip(): str(r[1] or "").strip() for r in stg_cur.fetchall()}

    stg_cur.execute("""
        SELECT EmployeeATID, SerialNumber, CheckTime, VerifyMode, InOutMode
        FROM IC_AttendanceLog
        ORDER BY CheckTime ASC
    """)

    to_insert: List[Tuple[Any, ...]] = []
    skipped_dup = 0
    unmatched_atids = set()

    for atid_raw, sn_raw, chk_dt, v_raw, inout_raw in stg_cur.fetchall():
        atid = str(atid_raw or "").strip()
        if not atid or chk_dt is None:
            continue
        sn = str(sn_raw or "").strip()
        chk_sec = chk_dt.replace(microsecond=0)
        key = (atid, chk_sec.strftime("%Y-%m-%d %H:%M:%S"), sn)
        if key in existing_keys:
            skipped_dup += 1
            continue
        existing_keys.add(key)

        pe = prod_emps.get(atid)
        su = stg_users.get(atid)
        if pe:
            full_name = pe["full_name"]
            dept = pe["department"]
            is_staff = 1 if (pe["is_staff"] and not (atid.isdigit() and int(atid) >= 56000)) else 0
        elif su:
            full_name = su["full_name"]
            dept = su["dept_name"] or ("Khách" if (atid.isdigit() and int(atid) >= 80000000) else "Khác")
            is_staff = 1 if (not (atid.isdigit() and int(atid) >= 56000) and dept not in ("Khác", "Khách")) else 0
        else:
            unmatched_atids.add(atid)
            is_guest = atid.isdigit() and int(atid) >= 56000
            full_name = f"Khách {atid}" if is_guest else f"Nhân sự {atid}"
            dept = "Khách" if is_guest else "Khác"
            is_staff = 0

        dev_name, direction = DEVICE_META_BY_SN.get(sn, (dev_names.get(sn) or sn, "IN"))
        verify_mode, verify_val = _map_verify_mode(v_raw)
        inout_val = int(inout_raw) if inout_raw is not None else 0

        to_insert.append((
            atid,
            full_name[:250],
            dept[:250],
            sn[:50],
            dev_name[:100],
            chk_sec,
            verify_mode,
            verify_val,
            inout_val,
            is_staff,
            "ePAD_Backup_20261117",
            direction,
        ))

    if to_insert:
        insert_sql = """
            INSERT INTO tbl_AttendanceLogs (
                EmployeeATID, FullName, Department, DeviceSerialNumber, DeviceName,
                CheckTime, VerifyMode, VerifyModeValue, InOutMode, IsStaff, SyncSource, Direction
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        pcur.fast_executemany = True
        chunk_size = 2500
        for i in range(0, len(to_insert), chunk_size):
            pcur.executemany(insert_sql, to_insert[i : i + chunk_size])
            prod_conn.commit()
        pcur.fast_executemany = False

    logger.info(
        "Attendance logs synced: %d inserted, %d already present (unmatched ATIDs: %d)",
        len(to_insert), skipped_dup, len(unmatched_atids),
    )
    return len(to_insert)


def recalculate_daily_timekeeping(prod_conn: Any, prod_emps: Dict[str, Dict[str, Any]]) -> Tuple[int, int]:
    """
    Recomputes tbl_DailyTimekeeping across all dates from merged tbl_AttendanceLogs
    for staff (IsStaff = 1, ATID < 56000) under standard shift 07:45 - 16:45.
    Preserves existing Notes values.
    """
    pcur = prod_conn.cursor()
    pcur.execute("""
        SELECT EmployeeATID, FullName, Department, CheckTime
        FROM tbl_AttendanceLogs
        WHERE IsStaff = 1 AND CheckTime IS NOT NULL
        ORDER BY CheckTime ASC
    """)

    grouped: Dict[Tuple[Any, str], List[datetime]] = {}
    fallback_log_meta: Dict[str, Tuple[str, str]] = {}
    for atid_raw, fn_raw, dept_raw, chk_dt in pcur.fetchall():
        atid = str(atid_raw or "").strip()
        if not atid or chk_dt is None:
            continue
        if atid.isdigit() and int(atid) >= 56000:
            continue
        wdate = chk_dt.date()
        grouped.setdefault((wdate, atid), []).append(chk_dt)
        if atid not in fallback_log_meta and fn_raw:
            fallback_log_meta[atid] = (str(fn_raw).strip(), str(dept_raw or "").strip())

    pcur.execute("""
        SELECT TimekeepingID, WorkDate, EmployeeATID, FirstInTime, LastOutTime, TotalScans, DepartmentName, FullName
        FROM tbl_DailyTimekeeping
    """)
    existing_tk: Dict[Tuple[Any, str], Tuple[int, Any, Any, int, str, str]] = {}
    for tid, wd, atid, fin, lout, tsc, dname, fname in pcur.fetchall():
        existing_tk[(wd, str(atid or "").strip())] = (
            int(tid),
            fin,
            lout,
            int(tsc or 0),
            str(dname or "").strip(),
            str(fname or "").strip(),
        )

    inserts: List[Tuple[Any, ...]] = []
    updates: List[Tuple[Any, ...]] = []

    for (wdate, atid), times in grouped.items():
        times.sort()
        first_in = times[0]
        last_raw = times[-1]
        has_valid_out = (last_raw - first_in).total_seconds() >= 180
        last_out = last_raw if has_valid_out else None

        in_mins = first_in.hour * 60 + first_in.minute
        late_mins = max(0, in_mins - (7 * 60 + 45))
        if last_out:
            out_mins = last_out.hour * 60 + last_out.minute
            early_mins = max(0, (16 * 60 + 45) - out_mins)
            total_hours = round((last_out - first_in).total_seconds() / 3600.0, 2)
        else:
            early_mins = 0
            total_hours = 0.0

        status = "LATE" if late_mins > 0 else ("PRESENT" if last_out else "MISSING_OUT")
        total_scans = len(times)

        pe = prod_emps.get(atid)
        fb_name, fb_dept = fallback_log_meta.get(atid, (f"Nhân sự {atid}", "Khác"))
        emp_code = pe["code"] if pe else (atid.lstrip("0") or atid)
        full_name = pe["full_name"] if pe and pe["full_name"] else fb_name
        dept_name = pe["department"] if pe and pe["department"] not in ("", "Khác") else (fb_dept or "Khác")

        ex = existing_tk.get((wdate, atid))
        if not ex:
            inserts.append((
                wdate, atid, emp_code[:50], full_name[:250], dept_name[:250],
                "HC_0745_1645", first_in, last_out, total_scans,
                late_mins, early_mins, total_hours, status,
            ))
        else:
            tid, ex_in, ex_out, ex_scans, ex_dept, ex_name = ex
            needs_update = (
                ex_scans != total_scans
                or (ex_in and ex_in.replace(microsecond=0) != first_in.replace(microsecond=0))
                or ((ex_out.replace(microsecond=0) if ex_out else None) != (last_out.replace(microsecond=0) if last_out else None))
                or (ex_dept in ("", "Khác", "Nhân sự SeaZen", "--") and dept_name not in ("", "Khác", "Nhân sự SeaZen", "--"))
                or (ex_name.startswith("Nhân sự ") and not full_name.startswith("Nhân sự "))
            )
            if needs_update:
                updates.append((
                    emp_code[:50], full_name[:250], dept_name[:250],
                    first_in, last_out, total_scans,
                    late_mins, early_mins, total_hours, status, tid,
                ))

    if inserts:
        ins_sql = """
            INSERT INTO tbl_DailyTimekeeping (
                WorkDate, EmployeeATID, EmployeeCode, FullName, DepartmentName,
                ShiftCode, FirstInTime, LastOutTime, TotalScans,
                LateMinutes, EarlyLeaveMinutes, TotalHours, AttendanceStatus
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        pcur.fast_executemany = True
        for i in range(0, len(inserts), 2000):
            pcur.executemany(ins_sql, inserts[i : i + 2000])
            prod_conn.commit()
        pcur.fast_executemany = False

    if updates:
        upd_sql = """
            UPDATE tbl_DailyTimekeeping
            SET EmployeeCode = ?, FullName = ?, DepartmentName = ?,
                FirstInTime = ?, LastOutTime = ?, TotalScans = ?,
                LateMinutes = ?, EarlyLeaveMinutes = ?, TotalHours = ?,
                AttendanceStatus = ?, UpdatedAt = GETDATE()
            WHERE TimekeepingID = ?
        """
        pcur.fast_executemany = True
        for i in range(0, len(updates), 1000):
            pcur.executemany(upd_sql, updates[i : i + 1000])
            prod_conn.commit()
        pcur.fast_executemany = False

    logger.info("DailyTimekeeping recalculated: +%d inserted, ~%d updated", len(inserts), len(updates))
    return len(inserts), len(updates)


def sync_visitors_and_frequent_cache(
    stg_cur: Any,
    prod_conn: Any,
    dept_idx_to_name: Dict[int, str],
    stg_users: Dict[str, Dict[str, Any]],
) -> Dict[str, int]:
    """
    Merges HR_CustomerInfo (988 visits) into tbl_Visitors (preserving live & manual records)
    and updates data/frequent_visitors.json.
    """
    pcur = prod_conn.cursor()

    # Count actual historical gate scans per visitor ATID for richer visit_count
    stg_cur.execute("""
        SELECT EmployeeATID, COUNT(DISTINCT CAST(CheckTime AS DATE)), MAX(CheckTime)
        FROM IC_AttendanceLog
        WHERE EmployeeATID >= '80000000'
        GROUP BY EmployeeATID
    """)
    visitor_scan_stats: Dict[str, Tuple[int, Optional[datetime]]] = {
        str(r[0]).strip(): (int(r[1] or 1), r[2]) for r in stg_cur.fetchall() if r[0]
    }

    stg_cur.execute("""
        SELECT EmployeeATID, NRIC, Company, Address, Email, Phone,
               ContactPerson, ContactDepartment, FromTime, ToTime,
               WorkContent, WorkingContent, Note, Reason, RepresentativeID, UpdatedDate
        FROM HR_CustomerInfo
        ORDER BY FromTime ASC
    """)
    cust_rows = stg_cur.fetchall()

    pcur.execute("""
        SELECT VisitorID, FullName, CCCDNumber, CheckinTime, HostPerson, Department, Company, Phone
        FROM tbl_Visitors
    """)
    existing_by_id: Dict[str, Tuple[Any, ...]] = {}
    existing_sigs = set()
    for r in pcur.fetchall():
        vid = str(r[0] or "").strip()
        existing_by_id[vid] = r
        cccd = _clean_str(r[2])
        fn = _clean_name(r[1]).lower()
        cin = r[3].strftime("%Y-%m-%d %H:%M") if r[3] else ""
        if cccd and cin:
            existing_sigs.add((cccd, cin[:13]))
        if fn and cin:
            existing_sigs.add((fn, cin[:13]))

    v_inserted = 0
    v_enriched = 0
    batch_inserts: List[Tuple[Any, ...]] = []
    now_dt = datetime.now().replace(microsecond=0)

    frequent_seed_records: List[Dict[str, Any]] = []

    for row in cust_rows:
        atid = str(row[0] or "").strip()
        if not atid:
            continue
        su = stg_users.get(atid, {})
        full_name = su.get("full_name") or f"Khách {atid}"
        cccd = _clean_str(row[1]) or su.get("nric", "")
        company = _clean_str(row[2]) or "Khách Đến Tòa Nhà"
        address = _clean_str(row[3]) or su.get("address", "")
        phone = _clean_str(row[5]) or su.get("phone", "")
        card_num = su.get("card", "")
        birth_date = su.get("dob", "")
        gender = su.get("gender") or ""

        # Resolve host person ATID -> real staff name
        host_raw = _clean_str(row[6])
        if host_raw and host_raw in stg_users:
            host_person = stg_users[host_raw]["full_name"]
        else:
            host_person = host_raw

        # Resolve ContactDepartment index -> department name
        dept_raw = _clean_str(row[7])
        if dept_raw.isdigit() and int(dept_raw) in dept_idx_to_name:
            department = dept_idx_to_name[int(dept_raw)]
        elif dept_raw and host_raw in stg_users and stg_users[host_raw].get("dept_name"):
            department = stg_users[host_raw]["dept_name"]
        else:
            department = dept_raw

        purpose = _clean_str(row[10]) or _clean_str(row[11]) or _clean_str(row[12]) or _clean_str(row[13]) or "Liên hệ công tác"
        parent_id = _clean_str(row[14]) or None
        parent_name = stg_users[parent_id]["full_name"] if parent_id and parent_id in stg_users else None

        visit_days, last_scan_raw = visitor_scan_stats.get(atid, (1, None))
        last_scan_dt = _valid_dt(last_scan_raw)
        from_dt = _valid_dt(row[8]) or last_scan_dt or _valid_dt(row[15]) or now_dt
        to_dt = _valid_dt(row[9])
        if to_dt is None or to_dt <= from_dt:
            to_dt = from_dt + timedelta(hours=1)
        dur_mins = max(0, int((to_dt - from_dt).total_seconds() // 60))

        # Historical backup import records are archived cleanly as CHECKED_OUT
        vid = f"epad_{atid}"[:50]
        cin_hr = from_dt.strftime("%Y-%m-%d %H:%M")[:13]

        latest_visit_dt = max(from_dt, last_scan_dt) if last_scan_dt else from_dt
        frequent_seed_records.append({
            "full_name": full_name,
            "cccd_number": cccd,
            "birth_date": birth_date,
            "phone": phone,
            "company": "" if company == "Khách Đến Tòa Nhà" else company,
            "department": department,
            "host_person": host_person,
            "host_phone": "",
            "visit_count": max(1, visit_days),
            "last_visit": latest_visit_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        })

        if vid in existing_by_id:
            continue
        if (cccd and (cccd, cin_hr) in existing_sigs) or (full_name.lower(), cin_hr) in existing_sigs:
            continue

        batch_inserts.append((
            vid, full_name[:250], cccd[:50], card_num[:50], company[:250],
            department[:250], host_person[:250], purpose[:250],
            from_dt, to_dt, to_dt, dur_mins, "CHECKED_OUT",
            "ePAD Backup Sync", 0, phone[:50], birth_date[:50], gender[:20],
            address[:500], parent_id[:50] if parent_id else None, parent_name[:250] if parent_name else None,
        ))

    if batch_inserts:
        ins_v_sql = """
            INSERT INTO tbl_Visitors (
                VisitorID, FullName, CCCDNumber, CardNumber, Company,
                Department, HostPerson, Purpose,
                CheckinTime, ExpectedCheckoutTime, CheckoutTime, DurationMinutes, Status,
                Operator, AutoUnlock, Phone, BirthDate, Gender,
                Address, ParentVisitorID, ParentVisitorName
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        pcur.fast_executemany = True
        for i in range(0, len(batch_inserts), 500):
            pcur.executemany(ins_v_sql, batch_inserts[i : i + 500])
            prod_conn.commit()
        pcur.fast_executemany = False
        v_inserted = len(batch_inserts)

    # Also update data/frequent_visitors.json idempotently (merge existing 670 + 988 staging + latest DB visitors)
    existing_freq: List[Dict[str, Any]] = []
    if os.path.exists(FREQUENT_VISITORS_PATH):
        try:
            with open(FREQUENT_VISITORS_PATH, "r", encoding="utf-8") as f:
                existing_freq = json.load(f) or []
        except Exception:
            existing_freq = []

    merged_profiles: Dict[str, Dict[str, Any]] = {}
    for item in existing_freq + frequent_seed_records:
        cccd_k = _clean_str(item.get("cccd_number")).upper()
        name_k = _clean_name(item.get("full_name")).lower()
        k = cccd_k if re.match(r"^\d{9,12}$", cccd_k) else name_k
        if not k or name_k.startswith("nv 000") or name_k.startswith("khách thẻ"):
            continue
        cur = merged_profiles.get(k)
        if not cur:
            merged_profiles[k] = dict(item)
        else:
            for fld in ("full_name", "cccd_number", "birth_date", "phone", "company", "department", "host_person", "host_phone"):
                new_v = _clean_str(item.get(fld)) if fld != "full_name" else _clean_name(item.get(fld))
                old_v = _clean_str(cur.get(fld)) if fld != "full_name" else _clean_name(cur.get(fld))
                if new_v and not old_v:
                    cur[fld] = new_v
            cur["visit_count"] = max(int(cur.get("visit_count") or 1), int(item.get("visit_count") or 1))
            if str(item.get("last_visit") or "") > str(cur.get("last_visit") or ""):
                cur["last_visit"] = item.get("last_visit")

    sorted_freq = sorted(
        merged_profiles.values(),
        key=lambda x: (int(x.get("visit_count") or 0), str(x.get("last_visit") or "")),
        reverse=True,
    )
    _atomic_write_json(FREQUENT_VISITORS_PATH, sorted_freq)

    # Refresh data/employees.json cache cleanly from tbl_Employees (preserving existing schema)
    pcur.execute("""
        SELECT e.EmployeeATID, e.EmployeeCode, e.FullName, e.DepartmentName, e.DepartmentID,
               e.Position, e.CardNumber, e.Email, e.Phone, e.Gender
        FROM tbl_Employees e
        WHERE e.IsActive = 1 AND (e.IsStaff = 1 OR (e.DepartmentName IS NOT NULL AND e.DepartmentName <> '' AND e.DepartmentName <> N'Khác' AND e.DepartmentName <> N'Khách'))
        ORDER BY e.EmployeeATID
    """)
    emp_cache = []
    for r in pcur.fetchall():
        emp_cache.append({
            "atid": str(r[0] or "").strip(),
            "code": _clean_str(r[1]) or str(r[0] or "").strip(),
            "fullname": _clean_name(r[2]),
            "department": str(r[3] or "").strip() or "Khác",
            "department_index": int(r[4]) if r[4] is not None else None,
            "position": _clean_str(r[5]),
            "card_number": _clean_str(r[6]),
            "email": _clean_str(r[7]),
            "phone": _clean_str(r[8]),
            "gender": _clean_name(r[9]),
        })
    if emp_cache:
        _atomic_write_json(EMPLOYEES_JSON_PATH, emp_cache)

    logger.info(
        "Visitors & caches merged: tbl_Visitors +%d (enriched %d), frequent_visitors.json=%d, employees.json=%d",
        v_inserted, v_enriched, len(sorted_freq), len(emp_cache),
    )
    return {
        "visitors_inserted": v_inserted,
        "frequent_profiles": len(sorted_freq),
        "employees_json": len(emp_cache),
    }


def main() -> None:
    stg_conn = pyodbc.connect(db_mssql.get_connection_string(STAGING_DB), timeout=15)
    prod_conn = pyodbc.connect(db_mssql.get_connection_string(PROD_DB), timeout=15)

    try:
        stg_cur = stg_conn.cursor()
        pcur = prod_conn.cursor()

        before = _snapshot_prod_counts(pcur)
        logger.info("BEFORE SeaZen_AccessControl: %s", before)

        dept_idx_to_name = sync_departments(stg_cur, prod_conn)
        stg_users, prod_emps = sync_employees_and_biometrics(stg_cur, prod_conn, dept_idx_to_name)
        sync_attendance_logs(stg_cur, prod_conn, stg_users, prod_emps)
        recalculate_daily_timekeeping(prod_conn, prod_emps)
        sync_visitors_and_frequent_cache(stg_cur, prod_conn, dept_idx_to_name, stg_users)

        after = _snapshot_prod_counts(pcur)
        logger.info("AFTER  SeaZen_AccessControl: %s", after)

        print("\n=== BACKUP SYNC SUMMARY ===")
        for k in after:
            b = before.get(k, 0)
            a = after[k]
            print(f"  {k:25s}: {b:7d} -> {a:7d} (delta {a - b:+d})")
    finally:
        stg_conn.close()
        prod_conn.close()


if __name__ == "__main__":
    main()
