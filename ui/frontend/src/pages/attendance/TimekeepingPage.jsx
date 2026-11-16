import React, { useState } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function TimekeepingPage({
  onCollapseSidebar,
  dailyTimekeeping,
  shifts,
  onRefreshData,
  notify,
}) {
  const [subTab, setSubTab] = useState('daily');
  const [searchQuery, setSearchQuery] = useState('');

  const [shiftForm, setShiftForm] = useState({
    ShiftCode: '',
    ShiftName: '',
    CheckInTime: '08:00',
    CheckOutTime: '17:30',
    BreakStartTime: '12:00',
    BreakEndTime: '13:30',
    GraceLateMinutes: 5,
    GraceEarlyMinutes: 5,
    WorkingHours: 8.0,
  });

  const filteredRecords = dailyTimekeeping.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      String(r.FullName || '').toLowerCase().includes(q) ||
      String(r.EmployeeATID || '').toLowerCase().includes(q) ||
      String(r.DepartmentName || '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onCollapseSidebar}
            title="Thu gọn thanh điều hướng"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          <div className="topbar-title-wrap">
            <div className="topbar-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </div>
            <div>
              <h1 className="topbar-title">Tổng hợp Chấm công & Thiết lập Ca làm việc</h1>
              <div className="topbar-sub">
                Đối soát giờ vào đầu tiên, giờ ra cuối cùng, số phút đi muộn và tổng số giờ làm việc thực tế
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="subtab-bar">
        <button
          type="button"
          className={`subtab-btn ${subTab === 'daily' ? 'active' : ''}`}
          onClick={() => setSubTab('daily')}
        >
          <span>Bảng Tổng hợp Chấm công ({dailyTimekeeping.length} bản ghi)</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'shifts' ? 'active' : ''}`}
          onClick={() => setSubTab('shifts')}
        >
          <span>Danh mục Ca làm việc ({shifts.length})</span>
        </button>
      </div>

      <div className="content-wrap">
        {subTab === 'daily' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Bảng Tổng hợp Chấm công theo Ngày</div>
              <input
                type="text"
                className="form-control"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm họ tên, mã chấm công, phòng ban..."
                style={{ width: 260 }}
              />
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ngày làm việc</th>
                    <th>Mã chấm công</th>
                    <th>Họ và tên</th>
                    <th>Phòng ban</th>
                    <th>Giờ vào đầu</th>
                    <th>Giờ ra cuối</th>
                    <th>Số lần quét</th>
                    <th>Đi muộn (phút)</th>
                    <th>Tổng giờ</th>
                    <th>Đánh giá</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((r, idx) => (
                    <tr key={idx}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.WorkDate}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.EmployeeATID}</td>
                      <td style={{ fontWeight: 600 }}>{r.FullName}</td>
                      <td>{r.DepartmentName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--green-text)' }}>
                        {r.FirstInTime?.split(' ')[1] || r.FirstInTime}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>
                        {r.LastOutTime?.split(' ')[1] || '---'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.TotalScans}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: r.LateMinutes > 0 ? 'var(--amber-text)' : 'inherit' }}>
                        {r.LateMinutes}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.TotalHours}h</td>
                      <td>
                        <span className={`badge ${r.AttendanceStatus === 'LATE' ? 'badge-amber' : 'badge-green'}`}>
                          {r.AttendanceStatus === 'LATE'
                            ? 'Đi muộn'
                            : r.AttendanceStatus === 'MISSING_OUT'
                            ? 'Chưa quét ra'
                            : 'Đúng giờ'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {subTab === 'shifts' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Thiết lập Ca làm việc</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/attendance/shift', {
                      method: 'POST',
                      body: JSON.stringify(shiftForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu ca làm việc.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Mã ca làm việc *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={shiftForm.ShiftCode}
                        onChange={(e) => setShiftForm({ ...shiftForm, ShiftCode: e.target.value })}
                        placeholder="Ví dụ: CA_HANH_CHINH"
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Tên ca làm việc *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={shiftForm.ShiftName}
                        onChange={(e) => setShiftForm({ ...shiftForm, ShiftName: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Giờ bắt đầu ca</label>
                      <input
                        type="text"
                        className="form-control"
                        value={shiftForm.CheckInTime}
                        onChange={(e) => setShiftForm({ ...shiftForm, CheckInTime: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Giờ kết thúc ca</label>
                      <input
                        type="text"
                        className="form-control"
                        value={shiftForm.CheckOutTime}
                        onChange={(e) => setShiftForm({ ...shiftForm, CheckOutTime: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Số phút cho phép đi trễ</label>
                      <input
                        type="number"
                        className="form-control"
                        value={shiftForm.GraceLateMinutes}
                        onChange={(e) => setShiftForm({ ...shiftForm, GraceLateMinutes: Number(e.target.value) })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Số giờ công chuẩn</label>
                      <input
                        type="number"
                        step="0.5"
                        className="form-control"
                        value={shiftForm.WorkingHours}
                        onChange={(e) => setShiftForm({ ...shiftForm, WorkingHours: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Lưu Ca Làm Việc
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh mục Ca làm việc ({shifts.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã ca</th>
                      <th>Tên ca làm việc</th>
                      <th>Giờ vào - Giờ ra</th>
                      <th>Nghỉ giữa ca</th>
                      <th>Công chuẩn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((s) => (
                      <tr key={s.ShiftID}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.ShiftCode}</td>
                        <td style={{ fontWeight: 600 }}>{s.ShiftName}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {s.CheckInTime} - {s.CheckOutTime}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {s.BreakStartTime} - {s.BreakEndTime}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{s.WorkingHours} giờ</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
