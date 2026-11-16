import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pyodbc
import db_mssql

conn = pyodbc.connect(db_mssql.get_connection_string())
c = conn.cursor()

# 1. Update IsStaff = 0 for records with empty department or 'Khác'
c.execute("""
    UPDATE tbl_Employees
    SET IsStaff = 0
    WHERE DepartmentName = '' OR DepartmentName IS NULL OR DepartmentName = 'Khác'
""")
affected = c.rowcount
conn.commit()
print(f"Updated {affected} rows: IsStaff = 0 for empty department / Khác.")

# 2. Verify counts
c.execute("SELECT COUNT(*), IsStaff FROM tbl_Employees GROUP BY IsStaff")
for r in c.fetchall():
    print("IsStaff count:", r)

# 3. List official departments count
c.execute("""
    SELECT COUNT(*), DepartmentName 
    FROM tbl_Employees 
    WHERE IsStaff = 1 
    GROUP BY DepartmentName 
    ORDER BY COUNT(*) DESC
""")
print("Official departments:")
for r in c.fetchall():
    print("  -", r[1], ":", r[0])
