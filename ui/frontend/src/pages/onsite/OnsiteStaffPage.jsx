import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

const TABS = [
  { id: 'working', label: 'Đang làm việc (Hôm nay)' },
  { id: 'present', label: 'Đang có mặt' },
  { id: 'absent', label: 'Vắng / Nghỉ phép hôm nay' },
  { id: 'left', label: 'Đã chấm công & ra về' },
  { id: 'resigned', label: 'Đã ngưng / Lệch ZKTeco' },
];

function AttendanceDonutChart({ presentNow, leftToday, absentOrLeave, title, subtitle }) {
  const total = presentNow + leftToday + absentOrLeave;
  const r = 46;
  const c = 2 * Math.PI * r;

  const seg1 = total > 0 ? (presentNow / total) * c : 0;
  const seg2 = total > 0 ? (leftToday / total) * c : 0;
  const seg3 = total > 0 ? (absentOrLeave / total) * c : 0;
  const attendedPct = total > 0 ? Math.round(((presentNow + leftToday) / total) * 1000) / 10 : 0;

  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{subtitle}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: 124, height: 124, flexShrink: 0 }}>
          <svg width="124" height="124" viewBox="0 0 124 124" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="62" cy="62" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
            {total > 0 && (
              <>
                <circle
                  cx="62"
                  cy="62"
                  r={r}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="14"
                  strokeDasharray={`${seg1} ${c}`}
                  strokeDashoffset={0}
                />
                <circle
                  cx="62"
                  cy="62"
                  r={r}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="14"
                  strokeDasharray={`${seg2} ${c}`}
                  strokeDashoffset={-seg1}
                />
                <circle
                  cx="62"
                  cy="62"
                  r={r}
                  fill="none"
                  stroke="#d97706"
                  strokeWidth="14"
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

        <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#059669', display: 'inline-block' }} />
              Đang có mặt
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#047857' }}>{presentNow}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#2563eb', display: 'inline-block' }} />
              Đã chấm công &amp; ra về
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#1d4ed8' }}>{leftToday}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: '#d97706', display: 'inline-block' }} />
              Vắng / Nghỉ phép
            </span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#b45309' }}>{absentOrLeave}</strong>
          </div>
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
            <span>Tổng nhân sự đang làm</span>
            <strong style={{ color: '#0f172a' }}>{total}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function DepartmentAttendanceChart({ departments, selectedDept, onSelectDept }) {
  const maxWorking = Math.max(1, ...departments.map((d) => d.working || 0));

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
            Biểu đồ Đi làm &amp; Nghỉ phép theo Phòng ban
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Chỉ tính nhân sự đang làm việc (Chỉ Huy Đội xếp cuối do làm tại mục tiêu ngoài)
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#475569' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#059669', display: 'inline-block' }} />
            Đi làm
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: '#f59e0b', display: 'inline-block' }} />
            Vắng / Nghỉ phép
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                gridTemplateColumns: '140px 1fr 92px',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 6,
                background: isSelected ? '#eff6ff' : 'transparent',
                borderTop: d.is_field_team ? '1px dashed #cbd5e1' : 'none',
                paddingTop: d.is_field_team ? 8 : 4,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: d.is_field_team ? '#64748b' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.department}
              </div>
              <div style={{ height: 14, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
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
                <strong style={{ color: '#047857' }}>{d.attended_today}</strong> / {d.working} ({d.attended_pct}%)
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
  const [activeTab, setActiveTab] = useState('working');
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
  const unregisteredVp = payload?.unregistered_van_phong || [];

  const tabCounts = useMemo(() => ({
    working: employees.filter((e) => e.master_status === 'WORKING').length,
    present: employees.filter((e) => e.attendance_status === 'PRESENT').length,
    absent: employees.filter((e) => e.attendance_status === 'ABSENT_OR_LEAVE').length,
    left: employees.filter((e) => e.attendance_status === 'LEFT').length,
    resigned: employees.filter((e) => e.master_status === 'RESIGNED').length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedDept !== 'ALL' && emp.department !== selectedDept) return false;
      if (activeTab === 'working' && emp.master_status !== 'WORKING') return false;
      if (activeTab === 'present' && emp.attendance_status !== 'PRESENT') return false;
      if (activeTab === 'absent' && emp.attendance_status !== 'ABSENT_OR_LEAVE') return false;
      if (activeTab === 'left' && emp.attendance_status !== 'LEFT') return false;
      if (activeTab === 'resigned' && emp.master_status !== 'RESIGNED') return false;
      if (q) {
        const hay = `${emp.fullname} ${emp.code} ${emp.atid} ${emp.department} ${emp.master_target}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, selectedDept, activeTab, searchQuery]);

  const renderAttendanceBadge = (status) => {
    if (status === 'PRESENT') {
      return <span className="badge badge-success">Đang có mặt</span>;
    }
    if (status === 'LEFT') {
      return <span className="badge badge-info">Đã chấm công &amp; ra về</span>;
    }
    if (status === 'ABSENT_OR_LEAVE') {
      return <span className="badge badge-warning">Vắng / Nghỉ phép</span>;
    }
    return <span className="badge badge-danger">Đã ngưng làm việc</span>;
  };

  return (
    <div className="tino-body">
      <div className="tino-center">
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
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              Đối chiếu Master_NhanVien (SharePoint) · Chu kỳ cache{' '}
              {Math.round((cacheInfo.ttl_seconds || 1800) / 60)} phút
              {cacheInfo.synced_at ? ` · Đồng bộ gần nhất: ${cacheInfo.synced_at}` : ''}
              {cacheInfo.stale ? ' · Đang dùng cache dự phòng' : ''}
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Nhân viên tại chỗ — Tình hình đi làm &amp; nghỉ phép hôm nay
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="date"
              className="form-control"
              style={{ width: 155, height: 34, padding: '4px 10px' }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={syncing}
              onClick={() => loadReconcile(true)}
            >
              {syncing ? 'Đang đồng bộ SharePoint...' : 'Đồng bộ SharePoint ngay'}
            </button>
          </div>
        </div>

        {/* 4 KPI SUMMARY CARDS (TODAY ATTENDANCE FOCUS) */}
        <div className="kpi-grid-4" style={{ marginBottom: 16 }}>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Khối Văn phòng đang làm</span>
            <span className="kpi-stat-value" style={{ color: '#0f172a' }}>
              {summary.office_working ?? 0} NV
            </span>
            <span className="kpi-stat-sub">
              Tổng công ty (kể cả Chỉ Huy Đội): {summary.working ?? 0} NV đang làm
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đi làm hôm nay (Văn phòng)</span>
            <span className="kpi-stat-value" style={{ color: '#047857' }}>
              {summary.office_attended_today ?? 0} ({summary.office_attended_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Đã chấm công vào cổng trong ngày {selectedDate}
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đang có mặt tại công ty</span>
            <span className="kpi-stat-value" style={{ color: '#1d4ed8' }}>
              {summary.office_present_now ?? 0} ({summary.office_present_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Đã ra về: {summary.office_left_today ?? 0} NV
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Vắng / Nghỉ phép hôm nay</span>
            <span className="kpi-stat-value" style={{ color: '#b45309' }}>
              {summary.office_absent_or_leave ?? 0} ({summary.office_absent_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Tính trên {summary.office_working ?? 0} NV Khối Văn phòng
            </span>
          </div>
        </div>

        {/* CHARTS ROW */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <AttendanceDonutChart
            title="Cơ cấu hiện diện Khối Văn phòng hôm nay"
            subtitle="Không gồm Chỉ Huy Đội làm việc tại mục tiêu ngoài"
            presentNow={summary.office_present_now ?? 0}
            leftToday={summary.office_left_today ?? 0}
            absentOrLeave={summary.office_absent_or_leave ?? 0}
          />
          <DepartmentAttendanceChart
            departments={departments}
            selectedDept={selectedDept}
            onSelectDept={setSelectedDept}
          />
        </div>

        {/* DEPARTMENT SUMMARY TABLE */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            className="card-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h3 className="card-title" style={{ margin: 0 }}>
                Thống kê đi làm &amp; nghỉ phép theo Phòng ban ({departments.length} phòng ban)
              </h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Nhấp vào một phòng ban để lọc danh sách nhân viên chi tiết bên dưới (Chỉ Huy Đội ở cuối bảng)
              </div>
            </div>
            {selectedDept !== 'ALL' && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSelectedDept('ALL')}
              >
                Xem tất cả phòng ban
              </button>
            )}
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Phòng ban</th>
                  <th style={{ textAlign: 'right' }}>Đang làm việc</th>
                  <th style={{ textAlign: 'right' }}>Đi làm hôm nay</th>
                  <th style={{ textAlign: 'right' }}>Đang có mặt</th>
                  <th style={{ textAlign: 'right' }}>Vắng / Nghỉ phép</th>
                  <th style={{ textAlign: 'right' }}>Tỷ lệ đi làm</th>
                  <th style={{ textAlign: 'right' }}>Tỷ lệ vắng / phép</th>
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
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>
                        {d.department}
                        {d.is_field_team && (
                          <span className="badge" style={{ marginLeft: 8 }}>
                            Mục tiêu ngoài
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{d.working}</td>
                      <td style={{ textAlign: 'right', color: '#047857', fontWeight: 700 }}>
                        {d.attended_today}
                      </td>
                      <td style={{ textAlign: 'right', color: '#1d4ed8', fontWeight: 600 }}>
                        {d.present_now}
                      </td>
                      <td style={{ textAlign: 'right', color: '#b45309', fontWeight: 600 }}>
                        {d.absent_or_leave}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{d.attended_pct}%</td>
                      <td style={{ textAlign: 'right', color: '#64748b' }}>{d.absent_pct}%</td>
                    </tr>
                  );
                })}
                {departments.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                      Chưa có dữ liệu phòng ban
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* EMPLOYEE RECONCILIATION TABLE */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            className="card-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="form-control"
                style={{ width: 200, height: 34, padding: '4px 8px' }}
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
              >
                <option value="ALL">Tất cả phòng ban ({departments.length})</option>
                {departments.map((d) => (
                  <option key={d.department} value={d.department}>
                    {d.department} ({d.working})
                  </option>
                ))}
              </select>

              <input
                type="text"
                className="form-control"
                style={{ width: 220, height: 34, padding: '4px 10px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên, mã NV, ATID..."
              />
            </div>
          </div>

          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã NV / ATID</th>
                  <th>Họ và tên</th>
                  <th>Phòng ban</th>
                  <th>Trạng thái hôm nay</th>
                  <th>Giờ vào / ra</th>
                  <th>Cửa quét gần nhất</th>
                  <th>Đối chiếu Master</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                      Đang tải dữ liệu đối chiếu nhân viên...
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                      Không có nhân viên phù hợp với bộ lọc hiện tại
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => (
                    <tr
                      key={emp.atid || emp.code}
                      style={emp.mismatch_flag ? { background: '#fff1f2' } : undefined}
                    >
                      <td>
                        <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{emp.code || '—'}</div>
                        <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                          {emp.atid}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{emp.fullname}</div>
                        {emp.position ? (
                          <div style={{ fontSize: 12, color: '#64748b' }}>{emp.position}</div>
                        ) : null}
                      </td>
                      <td>
                        <div>{emp.department}</div>
                        {emp.master_target ? (
                          <div style={{ fontSize: 11, color: '#64748b' }}>{emp.master_target}</div>
                        ) : null}
                      </td>
                      <td>{renderAttendanceBadge(emp.attendance_status)}</td>
                      <td style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                        {emp.check_in_time ? (
                          <div>Vào: {emp.check_in_time.slice(11, 19) || emp.check_in_time}</div>
                        ) : (
                          '—'
                        )}
                        {emp.check_out_time ? (
                          <div>Ra: {emp.check_out_time.slice(11, 19) || emp.check_out_time}</div>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 12, color: '#475569' }}>
                        {emp.last_door || '—'}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {emp.master_status === 'WORKING' ? (
                          <span className="badge badge-success">Đang làm (Master)</span>
                        ) : (
                          <span className="badge badge-danger">
                            {emp.mismatch_flag ? 'Cần tắt Active ZKTeco' : 'Đã ngưng làm việc'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* UNREGISTERED VAN PHONG STAFF */}
        {unregisteredVp.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title" style={{ margin: 0 }}>
                Nhân sự Văn phòng trên Master_NhanVien chưa có trên máy chấm công ({unregisteredVp.length})
              </h3>
            </div>
            <div
              style={{
                padding: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 10,
              }}
            >
              {unregisteredVp.map((it) => (
                <div
                  key={it.sp_id || it.emp_code}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '8px 12px',
                    background: '#f8fafc',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>
                    {it.fullname} ({it.emp_code || '—'})
                  </div>
                  <div style={{ color: '#64748b', marginTop: 2 }}>
                    {it.target || it.team || 'VAN PHONG'} · {it.position || 'Nhân viên'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
