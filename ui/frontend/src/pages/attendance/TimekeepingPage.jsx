import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../services/apiClient';

function getMonthBounds(ymStr) {
  const parts = String(ymStr || '').split('-');
  const yr = parseInt(parts[0], 10) || new Date().getFullYear();
  const mo = parseInt(parts[1], 10) || new Date().getMonth() + 1;
  const lastDay = new Date(yr, mo, 0).getDate();
  const padMo = String(mo).padStart(2, '0');
  const padLast = String(lastDay).padStart(2, '0');
  return {
    from: `${yr}-${padMo}-01`,
    to: `${yr}-${padMo}-${padLast}`,
  };
}

export default function TimekeepingPage({ departments }) {
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const initBounds = getMonthBounds(defaultMonth);

  const [monthFilter, setMonthFilter] = useState(defaultMonth);
  const [fromDate, setFromDate] = useState(initBounds.from);
  const [toDate, setToDate] = useState(initBounds.to);
  const [deptFilter, setDeptFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [days, setDays] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dailyTotals, setDailyTotals] = useState({});
  const [loading, setLoading] = useState(false);

  const exportMenuRef = React.useRef(null);
  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showExportMenu]);

  const fetchMatrix = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (monthFilter) params.set('month', monthFilter);
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      if (deptFilter) params.set('department', deptFilter);
      if (searchQuery) params.set('search', searchQuery);

      const { ok, data } = await apiFetch(`/api/timekeeping/matrix?${params.toString()}`);
      if (ok && data?.success) {
        setDays(data.days || []);
        setEmployees(data.employees || []);
        setDailyTotals(data.daily_totals || {});
      }
    } finally {
      setLoading(false);
    }
  }, [monthFilter, fromDate, toDate, deptFilter, searchQuery]);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const handleMonthChange = (val) => {
    setMonthFilter(val);
    if (val && val.length === 7) {
      const bounds = getMonthBounds(val);
      setFromDate(bounds.from);
      setToDate(bounds.to);
    }
  };

  const [showExportMenu, setShowExportMenu] = React.useState(false);

  const buildParams = () => {
    const params = new URLSearchParams();
    if (monthFilter) params.set('month', monthFilter);
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);
    if (deptFilter) params.set('department', deptFilter);
    if (searchQuery) params.set('search', searchQuery);
    return params.toString();
  };

  const handleExportExcel = () => {
    window.location.href = `/api/timekeeping/export_excel?${buildParams()}`;
    setShowExportMenu(false);
  };

  const handleExportBCC = () => {
    window.location.href = `/api/timekeeping/export_excel_bcc?${buildParams()}`;
    setShowExportMenu(false);
  };

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* TOP HEADER & FILTERS (FIXED, NO WHOLE-PAGE SCROLL) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 12.5 }}>
              Giờ làm việc chuẩn: <strong>07:45 – 16:45</strong> · Đầu ngày quét (Giờ vào) – Cuối ngày quét (Giờ ra)
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 21 }}>
              Bảng Tổng hợp Công theo Ngày ({employees.length} nhân sự · {days.length} ngày)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <div className="v-field" style={{ gap: 3 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tháng</label>
              <input
                type="month"
                className="v-input"
                style={{ width: 142, height: 34 }}
                value={monthFilter}
                onChange={(e) => handleMonthChange(e.target.value)}
              />
            </div>

            <div className="v-field" style={{ gap: 3 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Từ ngày</label>
              <input
                type="date"
                className="v-input"
                style={{ width: 138, height: 34 }}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div className="v-field" style={{ gap: 3 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Đến ngày</label>
              <input
                type="date"
                className="v-input"
                style={{ width: 138, height: 34 }}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <div className="v-field" style={{ gap: 3 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Phòng ban</label>
              <select
                className="v-input"
                style={{ width: 165, height: 34 }}
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
            </div>

            <div className="v-field" style={{ gap: 3 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tìm nhân sự</label>
              <input
                type="text"
                className="v-input"
                style={{ width: 185, height: 34 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Mã số NV, họ tên..."
              />
            </div>

            {/* Export split-button */}
            <div style={{ position: 'relative' }} ref={exportMenuRef}>
              <div style={{ display: 'flex', border: '1px solid #B45309', borderRadius: 6, overflow: 'hidden' }}>
                <button
                  type="button"
                  className="btn btn-gold"
                  style={{ height: 34, padding: '0 14px', fontWeight: 700, border: 'none', borderRadius: 0 }}
                  onClick={handleExportExcel}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>Xuất Excel</span>
                </button>
                <button
                  type="button"
                  className="btn btn-gold"
                  style={{ height: 34, padding: '0 8px', border: 'none', borderRadius: 0, borderLeft: '1px solid rgba(0,0,0,0.15)' }}
                  onClick={() => setShowExportMenu(v => !v)}
                  title="Chọn định dạng xuất"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              </div>
              {showExportMenu && (
                <div
                  style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 200,
                  }}
                >
                  <button
                    type="button"
                    style={{ display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#111' }}
                    onClick={handleExportExcel}
                  >
                    Xuất chuẩn SeaZen
                    <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 400, marginTop: 1 }}>Bảng pivot theo ngày (mặc định)</div>
                  </button>
                  <div style={{ borderTop: '1px solid #F3F4F6' }} />
                  <button
                    type="button"
                    style={{ display: 'block', width: '100%', padding: '10px 16px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#111' }}
                    onClick={handleExportBCC}
                  >
                    Xuất BCC SZ-EXPERT
                    <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 400, marginTop: 1 }}>Mỗi dòng = 1 NV × 1 ngày, T7 đầu/cuối tháng đi làm</div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* PIVOT MATRIX TABLE (FIXED-HEIGHT INTERNAL SCROLL, STICKY LEFT & TOP & FOOTER) */}
        <div className="card card-table-fill">
          <div className="table-scroll">
            <table className="tk-matrix-table">
              <thead>
                <tr>
                  <th className="sticky-c1">STT</th>
                  <th className="sticky-c2">MÃ NV</th>
                  <th className="sticky-c3">HỌ VÀ TÊN</th>
                  <th className="sticky-c4">PHÒNG BAN</th>
                  {days.map((dm) => (
                    <th key={dm.date} className={dm.is_sunday ? 'sun-col' : ''}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--jet)' }}>
                        {dm.day_num}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: dm.is_sunday ? 'var(--gold-text)' : 'var(--text-muted)',
                        }}
                      >
                        {dm.dow}
                      </div>
                    </th>
                  ))}
                  <th style={{ minWidth: 78 }}>TỔNG GIỜ</th>
                  <th style={{ minWidth: 74 }}>NGÀY CÓ MẶT</th>
                </tr>
              </thead>

              <tbody>
                {loading && employees.length === 0 ? (
                  <tr>
                    <td colSpan={6 + days.length} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                      Đang tổng hợp bảng công theo ngày...
                    </td>
                  </tr>
                ) : employees.length === 0 ? (
                  <tr>
                    <td colSpan={6 + days.length} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                      Không có dữ liệu chấm công khớp với khoảng ngày và bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  employees.map((emp, idx) => {
                    const empDays = emp.days || {};
                    return (
                      <tr key={emp.employee_atid || idx}>
                        <td className="sticky-c1" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                          {idx + 1}
                        </td>
                        <td className="sticky-c2">{emp.employee_code}</td>
                        <td className="sticky-c3" title={emp.full_name}>
                          {String(emp.full_name || '').toUpperCase()}
                        </td>
                        <td className="sticky-c4" title={emp.department}>
                          {emp.department}
                        </td>

                        {days.map((dm) => {
                          const cell = empDays[dm.date];
                          return (
                            <td
                              key={dm.date}
                              className={`tk-day-cell ${dm.is_sunday ? 'sun-col' : ''}`}
                            >
                              {cell ? (
                                <div className={`tk-cell-box ${!cell.has_out ? 'incomplete' : ''}`}>
                                  {/* Dòng 1: Tổng giờ công */}
                                  <div className="tk-cell-hours">{cell.hours_display}</div>
                                  {/* Dòng 2: Giờ vào - Giờ ra */}
                                  <div className="tk-cell-times">{cell.time_range}</div>
                                </div>
                              ) : null}
                            </td>
                          );
                        })}

                        <td
                          style={{
                            textAlign: 'center',
                            fontWeight: 800,
                            color: '#0f766e',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {emp.total_hours}
                        </td>
                        <td
                          style={{
                            textAlign: 'center',
                            fontWeight: 700,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {emp.present_days}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {employees.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4} className="sticky-foot-label">
                      TỔNG CỘNG:
                    </td>
                    {days.map((dm) => {
                      const dtot = dailyTotals[dm.date] || { present_count: 0, total_hours: 0 };
                      return (
                        <td key={dm.date}>
                          {dtot.present_count > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ color: '#1d4ed8', fontSize: 11.5, fontWeight: 800 }}>
                                {dtot.present_count}
                              </span>
                              <span style={{ color: '#0f766e', fontSize: 11.5, fontWeight: 800 }}>
                                {dtot.total_hours}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ color: '#0f766e', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {Math.round(employees.reduce((s, e) => s + (e.total_hours || 0), 0) * 10) / 10}
                    </td>
                    <td style={{ color: '#1d4ed8', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {employees.reduce((s, e) => s + (e.present_days || 0), 0)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
