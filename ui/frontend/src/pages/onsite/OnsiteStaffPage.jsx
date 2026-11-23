import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

const TABS = [
  { id: 'all', label: 'Tất cả nhân sự' },
  { id: 'working', label: 'Đang làm việc' },
  { id: 'resigned', label: 'Đã ngưng làm việc' },
  { id: 'mismatch', label: 'Cảnh báo lệch dữ liệu' },
  { id: 'absent', label: 'Vắng / Nghỉ phép hôm nay' },
];

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
  const unregisteredVp = payload?.unregistered_van_phong || [];

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedDept !== 'ALL' && emp.department !== selectedDept) return false;
      if (activeTab === 'working' && emp.master_status !== 'WORKING') return false;
      if (activeTab === 'resigned' && emp.master_status !== 'RESIGNED') return false;
      if (activeTab === 'mismatch' && !emp.mismatch_flag) return false;
      if (activeTab === 'absent' && emp.attendance_status !== 'ABSENT_OR_LEAVE') return false;
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
    return <span className="badge">Ngưng làm việc</span>;
  };

  const renderMasterBadge = (emp) => {
    if (emp.master_status === 'WORKING') {
      return (
        <span className="badge badge-success">
          Đang làm ({emp.match_method === 'MA_NV' ? 'Mã NV' : 'Họ tên'})
        </span>
      );
    }
    return (
      <span className="badge badge-danger">
        {emp.master_working_status || 'Đã ngưng làm việc'}
      </span>
    );
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
              Nhân viên tại chỗ &amp; Thống kê nhân sự
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

        {/* 4 KPI SUMMARY CARDS */}
        <div className="kpi-grid-4" style={{ marginBottom: 16 }}>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đang làm việc (Master)</span>
            <span className="kpi-stat-value" style={{ color: '#047857' }}>
              {summary.working ?? 0} ({summary.working_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Tổng hệ thống: {summary.total_local ?? 0} · Master SP: {summary.master_total ?? 0}
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đã ngưng làm việc</span>
            <span className="kpi-stat-value" style={{ color: '#be123c' }}>
              {summary.resigned ?? 0} ({summary.resigned_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Lệch Active trên ZKTeco/SQL: {summary.mismatch_count ?? 0}
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đi làm / Có mặt hôm nay</span>
            <span className="kpi-stat-value" style={{ color: '#1d4ed8' }}>
              {summary.attended_today ?? 0} ({summary.attended_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Đang ở trong công ty: {summary.present_now ?? 0} ({summary.present_pct ?? 0}%)
            </span>
          </div>

          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Vắng / Nghỉ phép hôm nay</span>
            <span className="kpi-stat-value" style={{ color: '#b45309' }}>
              {summary.absent_or_leave ?? 0} ({summary.absent_pct ?? 0}%)
            </span>
            <span className="kpi-stat-sub">
              Tính trên {summary.working ?? 0} nhân sự đang làm việc
            </span>
          </div>
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
                Tổng hợp tỷ lệ theo Phòng ban ({departments.length} phòng ban)
              </h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Nhấp vào một phòng ban để lọc danh sách nhân viên chi tiết bên dưới
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
                  <th style={{ textAlign: 'right' }}>Tổng NV</th>
                  <th style={{ textAlign: 'right' }}>Đang làm</th>
                  <th style={{ textAlign: 'right' }}>Đi làm hôm nay</th>
                  <th style={{ textAlign: 'right' }}>Đang có mặt</th>
                  <th style={{ textAlign: 'right' }}>Vắng / Nghỉ phép</th>
                  <th style={{ textAlign: 'right' }}>Đã ngưng việc</th>
                  <th style={{ textAlign: 'right' }}>Tỷ lệ đi làm</th>
                  <th style={{ textAlign: 'right' }}>Tỷ lệ nghỉ việc</th>
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
                        background: isSelected ? '#eff6ff' : undefined,
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>
                        {d.department}
                        {d.mismatch_count > 0 && (
                          <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                            {d.mismatch_count} lệch
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{d.total}</td>
                      <td style={{ textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        {d.working}
                      </td>
                      <td style={{ textAlign: 'right', color: '#1d4ed8', fontWeight: 600 }}>
                        {d.attended_today}
                      </td>
                      <td style={{ textAlign: 'right' }}>{d.present_now}</td>
                      <td style={{ textAlign: 'right', color: '#b45309' }}>{d.absent_or_leave}</td>
                      <td style={{ textAlign: 'right', color: '#be123c' }}>{d.resigned}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{d.attended_pct}%</td>
                      <td style={{ textAlign: 'right', color: '#64748b' }}>{d.resigned_pct}%</td>
                    </tr>
                  );
                })}
                {departments.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
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
                  {t.label}
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
                    {d.department} ({d.total})
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
                  <th>Đối chiếu Master SharePoint</th>
                  <th>Trạng thái hôm nay</th>
                  <th>Giờ vào / ra</th>
                  <th>Ghi chú đối soát</th>
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
                      <td>{renderMasterBadge(emp)}</td>
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
                      <td style={{ fontSize: 12 }}>
                        {emp.mismatch_flag ? (
                          <span style={{ color: '#be123c', fontWeight: 600 }}>
                            {emp.mismatch_reason}
                          </span>
                        ) : emp.resign_reason ? (
                          <span style={{ color: '#475569' }}>{emp.resign_reason}</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>Khớp dữ liệu</span>
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
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
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
