import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

const TABS = [
  { id: 'all', label: 'Tất cả đang làm' },
  { id: 'present', label: 'Đang có mặt' },
  { id: 'absent', label: 'Vắng / Nghỉ phép' },
  { id: 'left', label: 'Đã ra về' },
];

function AttendanceDonutCard({ presentNow, leftToday, absentOrLeave }) {
  const total = presentNow + leftToday + absentOrLeave;
  const r = 44;
  const c = 2 * Math.PI * r;

  const seg1 = total > 0 ? (presentNow / total) * c : 0;
  const seg2 = total > 0 ? (leftToday / total) * c : 0;
  const seg3 = total > 0 ? (absentOrLeave / total) * c : 0;
  const attendedPct = total > 0 ? Math.round(((presentNow + leftToday) / total) * 1000) / 10 : 0;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        Cơ cấu hiện diện Khối Văn phòng
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
        Không tính Chỉ Huy Đội &amp; nhân sự đã nghỉ việc
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 18 }}>
        <div style={{ position: 'relative', width: 116, height: 116, flexShrink: 0 }}>
          <svg width="116" height="116" viewBox="0 0 116 116" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="58" cy="58" r={r} fill="none" stroke="#f1f5f9" strokeWidth="13" />
            {total > 0 && (
              <>
                <circle
                  cx="58"
                  cy="58"
                  r={r}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="13"
                  strokeDasharray={`${seg1} ${c}`}
                  strokeDashoffset={0}
                />
                <circle
                  cx="58"
                  cy="58"
                  r={r}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="13"
                  strokeDasharray={`${seg2} ${c}`}
                  strokeDashoffset={-seg1}
                />
                <circle
                  cx="58"
                  cy="58"
                  r={r}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="13"
                  strokeDasharray={`${seg3} ${c}`}
                  strokeDashoffset={-(seg1 + seg2)}
                />
              </>
            )}
          </svg>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
              {attendedPct}%
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>Đi làm</span>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: '#059669', display: 'inline-block' }} />
              Đang có mặt
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#047857' }}>{presentNow}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: '#2563eb', display: 'inline-block' }} />
              Đã ra về
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#1d4ed8' }}>{leftToday}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
              Vắng / Nghỉ phép
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#b45309' }}>{absentOrLeave}</strong>
          </div>
          <div
            style={{
              borderTop: '1px solid #e2e8f0',
              paddingTop: 8,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: '#64748b',
            }}
          >
            <span>Tổng Khối Văn phòng</span>
            <strong style={{ color: '#0f172a' }}>{total} NV</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function DepartmentBarCard({ departments, selectedDept, onSelectDept }) {
  const maxWorking = Math.max(1, ...departments.map((d) => d.working || 0));

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
            Biểu đồ Đi làm &amp; Nghỉ phép theo Phòng ban
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Nhấp vào phòng ban để lọc danh sách bên dưới (Chỉ Huy Đội xếp cuối)
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#475569' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#059669', display: 'inline-block' }} />
            Đi làm
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
            Vắng / Nghỉ phép
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {departments.map((d) => {
          const attW = ((d.attended_today || 0) / maxWorking) * 100;
          const absW = ((d.absent_or_leave || 0) / maxWorking) * 100;
          const isSelected = selectedDept === d.department;
          return (
            <div
              key={d.department}
              onClick={() => onSelectDept(isSelected ? 'ALL' : d.department)}
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 1fr 88px',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 6,
                background: isSelected ? '#eff6ff' : 'transparent',
                borderTop: d.is_field_team ? '1px dashed #cbd5e1' : 'none',
                marginTop: d.is_field_team ? 4 : 0,
                paddingTop: d.is_field_team ? 8 : 4,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: d.is_field_team ? '#64748b' : '#0f172a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {d.department}
              </div>
              <div style={{ height: 11, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                {attW > 0 && (
                  <div
                    style={{ width: `${attW}%`, background: '#059669', transition: 'width 0.3s ease' }}
                    title={`Đi làm: ${d.attended_today}`}
                  />
                )}
                {absW > 0 && (
                  <div
                    style={{ width: `${absW}%`, background: '#f59e0b', transition: 'width 0.3s ease' }}
                    title={`Vắng / Nghỉ phép: ${d.absent_or_leave}`}
                  />
                )}
              </div>
              <div style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#334155' }}>
                <strong style={{ color: '#047857' }}>{d.attended_today}</strong>/{d.working} ({d.attended_pct}%)
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OnsiteStaffPage({ onToast }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState('all');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const loadReconcile = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setSyncing(true);
    else setLoading(true);
    try {
      const qs = new URLSearchParams({ date: selectedDate });
      if (forceRefresh) qs.set('refresh', '1');
      const { ok, data } = await apiFetch(`/api/staff/onsite-reconcile?${qs.toString()}`);
      if (ok && data?.success) {
        setPayload(data);
        if (forceRefresh) {
          onToast?.('Đã đồng bộ dữ liệu Master_NhanVien từ SharePoint', 'success');
        }
      } else {
        onToast?.(data?.error || 'Không thể tải dữ liệu đối chiếu nhân viên', 'error');
      }
    } catch (err) {
      onToast?.(err?.message || 'Lỗi kết nối máy chủ', 'error');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [selectedDate, onToast]);

  useEffect(() => {
    loadReconcile(false);
  }, [loadReconcile]);

  const summary = payload?.summary || {};
  const cacheInfo = payload?.cache_info || {};
  const departments = payload?.departments || [];
  const employees = payload?.employees || [];

  const officeWorking = summary.office_working ?? 0;
  const officeAttended = summary.office_attended_today ?? 0;
  const officePresent = summary.office_present_now ?? 0;
  const officeLeft = summary.office_left_today ?? 0;
  const officeAbsent = summary.office_absent_or_leave ?? 0;
  const chdWorking = Math.max(0, (summary.working ?? 0) - officeWorking);

  const tabCounts = useMemo(() => ({
    all: employees.length,
    present: employees.filter((e) => e.attendance_status === 'PRESENT').length,
    absent: employees.filter((e) => e.attendance_status === 'ABSENT_OR_LEAVE').length,
    left: employees.filter((e) => e.attendance_status === 'LEFT').length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedDept !== 'ALL' && emp.department !== selectedDept) return false;
      if (activeTab === 'present' && emp.attendance_status !== 'PRESENT') return false;
      if (activeTab === 'absent' && emp.attendance_status !== 'ABSENT_OR_LEAVE') return false;
      if (activeTab === 'left' && emp.attendance_status !== 'LEFT') return false;
      if (q) {
        const hay = `${emp.fullname} ${emp.code} ${emp.atid} ${emp.department}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, selectedDept, activeTab, searchQuery]);

  const renderAttendanceBadge = (status) => {
    if (status === 'PRESENT') return <span className="badge badge-success">Đang có mặt</span>;
    if (status === 'LEFT') return <span className="badge badge-info">Đã ra về</span>;
    return <span className="badge badge-warning">Vắng / Nghỉ phép</span>;
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', padding: '16px 22px 18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ maxWidth: 1480, width: '100%', margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 12 }}>
              Nguồn chuẩn: Master_NhanVien (SharePoint) · Cache mỗi{' '}
              {Math.round((cacheInfo.ttl_seconds || 1800) / 60)} phút
              {cacheInfo.synced_at ? ` · Đồng bộ: ${cacheInfo.synced_at}` : ''}
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Nhân viên tại chỗ — Đi làm &amp; Nghỉ phép hôm nay
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="date"
              className="form-control"
              style={{ width: 150, height: 34, padding: '4px 10px' }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncing}
              onClick={() => loadReconcile(true)}
            >
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ SharePoint'}
            </button>
          </div>
        </div>

        {/* 4 KPI SUMMARY CARDS */}
        <div className="kpi-grid-4" style={{ marginBottom: 16 }}>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Khối Văn phòng đang làm</span>
            <span className="kpi-stat-value" style={{ color: '#0f172a' }}>
              {officeWorking} NV
            </span>
            <span className="kpi-stat-sub">
              Chỉ Huy Đội (mục tiêu ngoài): {chdWorking} NV
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đi làm hôm nay (Văn phòng)</span>
            <span className="kpi-stat-value" style={{ color: '#047857' }}>
              {officeAttended} ({summary.office_attended_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Đã chấm công ngày {selectedDate}
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đang có mặt tại công ty</span>
            <span className="kpi-stat-value" style={{ color: '#1d4ed8' }}>
              {officePresent} ({summary.office_present_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Đã ra về trong ngày: {officeLeft} NV
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Vắng / Nghỉ phép hôm nay</span>
            <span className="kpi-stat-value" style={{ color: '#b45309' }}>
              {officeAbsent} ({summary.office_absent_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Tính trên {officeWorking} NV Khối Văn phòng
            </span>
          </div>
        </div>

        {/* 2-COLUMN BALANCED LAYOUT (FIXED VIEWPORT, INTERNAL TABLE SCROLL ONLY) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 0.92fr) minmax(480px, 1.38fr)',
            gap: 16,
            flex: 1,
            minHeight: 0,
            alignItems: 'stretch',
          }}
        >
          {/* LEFT COLUMN: DONUT + DEPARTMENT SUMMARY */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
            <AttendanceDonutCard
              presentNow={officePresent}
              leftToday={officeLeft}
              absentOrLeave={officeAbsent}
            />

            <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div
                className="card-header"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}
              >
                <h3 className="card-title" style={{ margin: 0, fontSize: 14 }}>
                  Tổng hợp theo Phòng ban ({departments.length})
                </h3>
                {selectedDept !== 'ALL' && (
                  <button type="button" className="btn btn-sm" onClick={() => setSelectedDept('ALL')}>
                    Tất cả
                  </button>
                )}
              </div>
              <div className="table-wrap" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Phòng ban</th>
                      <th style={{ textAlign: 'right' }}>Đang làm</th>
                      <th style={{ textAlign: 'right' }}>Đi làm</th>
                      <th style={{ textAlign: 'right' }}>Vắng/Phép</th>
                      <th style={{ textAlign: 'right' }}>Tỷ lệ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => {
                      const isSelected = selectedDept === d.department;
                      return (
                        <tr
                          key={d.department}
                          onClick={() => setSelectedDept(isSelected ? 'ALL' : d.department)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? '#eff6ff' : d.is_field_team ? '#f8fafc' : undefined,
                            borderTop: d.is_field_team ? '2px solid #e2e8f0' : undefined,
                          }}
                        >
                          <td style={{ fontWeight: 600 }}>
                            {d.department}
                            {d.is_field_team && (
                              <span style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 400 }}>
                                Mục tiêu ngoài
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>{d.working}</td>
                          <td style={{ textAlign: 'right', color: '#047857', fontWeight: 700 }}>{d.attended_today}</td>
                          <td style={{ textAlign: 'right', color: '#b45309', fontWeight: 600 }}>{d.absent_or_leave}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{d.attended_pct}%</td>
                        </tr>
                      );
                    })}
                    {departments.length === 0 && !loading && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                          Chưa có dữ liệu phòng ban
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: DEPARTMENT BAR CHART + TODAY EMPLOYEE LIST */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
            <DepartmentBarCard
              departments={departments}
              selectedDept={selectedDept}
              onSelectDept={setSelectedDept}
            />

            <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div
                className="card-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`btn btn-sm ${activeTab === t.id ? 'btn-primary' : ''}`}
                      onClick={() => setActiveTab(t.id)}
                    >
                      {t.label} ({tabCounts[t.id] ?? 0})
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  className="form-control"
                  style={{ width: 200, height: 32, padding: '4px 10px' }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm tên, mã NV..."
                />
              </div>

              <div className="table-wrap" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
                    <tr>
                      <th>Mã NV</th>
                      <th>Họ và tên</th>
                      <th>Phòng ban</th>
                      <th>Trạng thái hôm nay</th>
                      <th>Giờ vào / ra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                          Đang tải dữ liệu...
                        </td>
                      </tr>
                    ) : filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                          Không có nhân viên phù hợp
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map((emp) => (
                        <tr key={emp.atid || emp.code}>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>
                            {emp.code || emp.atid}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{emp.fullname}</div>
                            {emp.position ? (
                              <div style={{ fontSize: 11, color: '#64748b' }}>{emp.position}</div>
                            ) : null}
                          </td>
                          <td style={{ fontSize: 12 }}>{emp.department}</td>
                          <td>{renderAttendanceBadge(emp.attendance_status)}</td>
                          <td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                            {emp.check_in_time ? (
                              <div>Vào: {emp.check_in_time.slice(11, 19) || emp.check_in_time}</div>
                            ) : (
                              '—'
                            )}
                            {emp.check_out_time ? (
                              <div style={{ color: '#64748b' }}>
                                Ra: {emp.check_out_time.slice(11, 19) || emp.check_out_time}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
