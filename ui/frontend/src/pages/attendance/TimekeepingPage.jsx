import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function TimekeepingPage({ departments }) {
  const [selectedDate, setSelectedDate] = useState('ALL');
  const [deptFilter, setDeptFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState([]);

  const fetchSummary = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedDate) params.set('date', selectedDate);
    if (deptFilter) params.set('department', deptFilter);
    if (searchQuery) params.set('search', searchQuery);
    const { ok, data } = await apiFetch(`/api/timekeeping/summary?${params.toString()}`);
    if (ok && data.rows) {
      setRows(data.rows);
    }
  }, [selectedDate, deptFilter, searchQuery]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const formatTimeOnly = (val) => {
    if (!val) return '---';
    const str = String(val);
    return str.includes(' ') ? str.split(' ')[1] : str;
  };

  return (
    <div className="tino-body">
      <div className="tino-center">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 14, flexShrink: 0 }}>
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              Quy tắc tính công tự động: Đầu ngày quét (Giờ vào đầu) → Cuối ngày quét (Giờ ra cuối)
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Bảng Tổng hợp Công theo từng ngày ({rows.length} bản ghi)
            </h1>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${selectedDate === 'ALL' ? 'btn-primary' : ''}`}
              onClick={() => setSelectedDate('ALL')}
            >
              Tất cả các ngày
            </button>
            <button
              type="button"
              className={`btn btn-sm ${selectedDate !== 'ALL' ? 'btn-gold' : ''}`}
              onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
            >
              Hôm nay
            </button>
            <input
              type="date"
              className="v-input"
              style={{ width: 150 }}
              value={selectedDate === 'ALL' ? '' : selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || 'ALL')}
            />
            <select
              className="v-input"
              style={{ width: 175 }}
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="">Tất cả phòng ban</option>
              {departments.map((d) => (
                <option key={d.DepartmentID} value={d.DepartmentName}>
                  {d.DepartmentName}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="v-input"
              style={{ width: 220 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm họ tên, mã nhân viên..."
            />
          </div>
        </div>

        <div className="card card-table-fill">
          <div className="table-scroll">
            <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Ngày làm việc</th>
                <th>Mã ATID</th>
                <th>Họ và tên nhân viên</th>
                <th>Phòng ban</th>
                <th>Đầu ngày quét (Vào đầu)</th>
                <th>Cuối ngày quét (Ra cuối)</th>
                <th>Số lần quét</th>
                <th>Đi muộn</th>
                <th>Tổng giờ</th>
                <th>Dữ liệu Công</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                    Không có dữ liệu chấm công khớp điều kiện lọc.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => {
                  const hours = Number(r.TotalHours || 0);
                  const workUnit = r.WorkUnit !== undefined ? r.WorkUnit : hours >= 7.5 ? 1.0 : hours >= 3.5 ? 0.5 : 0.0;
                  return (
                    <tr key={idx}>
                      <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.WorkDate}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.EmployeeATID}</td>
                      <td style={{ fontWeight: 700, color: 'var(--jet)' }}>{r.FullName}</td>
                      <td>{r.DepartmentName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--green)' }}>
                        {formatTimeOnly(r.FirstInTime)}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--jet)' }}>
                        {formatTimeOnly(r.LastOutTime)}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.TotalScans}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: r.LateMinutes > 0 ? 'var(--red)' : 'inherit' }}>
                        {r.LateMinutes > 0 ? `${r.LateMinutes} phút` : '0'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{hours}h</td>
                      <td>
                        <span className="badge badge-dark">{workUnit} công</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            r.AttendanceStatus === 'LATE'
                              ? 'badge-gold'
                              : r.AttendanceStatus === 'MISSING_OUT'
                              ? 'badge-red'
                              : 'badge-green'
                          }`}
                        >
                          {r.AttendanceStatus === 'LATE'
                            ? 'Đi muộn'
                            : r.AttendanceStatus === 'MISSING_OUT'
                            ? 'Chưa quét cuối ngày'
                            : 'Đủ công'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}
