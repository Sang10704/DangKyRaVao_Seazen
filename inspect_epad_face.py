import db_mssql
import sys
sys.stdout.reconfigure(encoding='utf-8')
conn = db_mssql.pyodbc.connect(db_mssql.get_connection_string(custom_db='EPAD_TINHHOA_OLD'))
cur = conn.cursor()

sql = """
SELECT
    COUNT(*) as Total,
    COUNT(CASE WHEN DATALENGTH(FaceTemplate) > 0 THEN 1 END) as HasFaceV1,
    COUNT(CASE WHEN DATALENGTH(FaceV2_TemplateBIODATA) > 0 THEN 1 END) as HasFaceV2BIODATA,
    COUNT(CASE WHEN FaceVersion IS NOT NULL AND FaceVersion != '' THEN 1 END) as HasFaceVersion,
    COUNT(CASE WHEN CardNumber IS NOT NULL AND CardNumber != '' THEN 1 END) as HasCard,
    COUNT(CASE WHEN DATALENGTH(FingerData0) > 0 THEN 1 END) as HasFinger
FROM IC_UserMaster
"""
cur.execute(sql)
r = cur.fetchone()
print("IC_UserMaster Statistics:")
print(f"  Total records          : {r[0]}")
print(f"  Has FaceTemplate (v1)  : {r[1]}  <- ảnh/vector cũ")
print(f"  Has FaceV2 BIODATA     : {r[2]}  <- ZKTeco SenseFace 4A algorithm")
print(f"  Has FaceVersion string : {r[3]}  <- ghi nhận phiên bản thuật toán")
print(f"  Has CardNumber         : {r[4]}  <- thẻ từ RFID")
print(f"  Has Fingerprint        : {r[5]}  <- vân tay")

cur.execute("SELECT TOP 8 EmployeeATID, NameOnMachine, FaceVersion, FaceV2_MajorVer, FaceV2_MinorVer, FaceV2_Size, CardNumber FROM IC_UserMaster WHERE FaceVersion IS NOT NULL AND FaceVersion != '' ORDER BY FaceVersion")
rows = cur.fetchall()
print()
print("Sample users with face data:")
for r in rows:
    print(f"  ATID={r[0]} | Name={r[1]} | FaceVer={r[2]} | V2_Major={r[3]} | V2_Minor={r[4]} | V2_Size={r[5]} | Card={r[6]}")

cur.execute("SELECT FaceVersion, COUNT(*) as cnt FROM IC_UserMaster WHERE FaceVersion IS NOT NULL AND FaceVersion != '' GROUP BY FaceVersion ORDER BY cnt DESC")
print()
print("Face version distribution:")
for r in cur.fetchall():
    print(f"  FaceVersion='{r[0]}' | Count={r[1]}")
