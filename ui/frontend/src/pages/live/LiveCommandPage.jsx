import React, { useState, useEffect, useCallback } from 'react';
import { ROUTES } from '../../constants/routes';
import { apiFetch } from '../../services/apiClient';
import { getLocalDateStr } from '../../utils/dateUtils';

export default function LiveCommandPage({
  user,
  clockAudit,
  onOpenClockModal,
  onNavigate,
  analytics,
  activeVisitors,
  realtimeLogs,
  scanDate,
  setScanDate,
  scanDirection,
  setScanDirection,
  scanCategory,
  setScanCategory,
  scanSearch,
  setScanSearch,
  onDoorControl,
  onDoorAll,
  doorLoading,
}) {
  const [doorTableTab, setDoorTableTab] = useState('SCANS');
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadDoorAuditLogs = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const { ok, data } = await apiFetch('/api/door/audit_logs?limit=100');
      const rows = data?.actions || data?.logs;
      if (ok && Array.isArray(rows)) setAuditLogs(rows);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    if (doorTableTab === 'AUDIT') {
      loadDoorAuditLogs();
    }
  }, [doorTableTab, loadDoorAuditLogs]);
  const lanes = [
    { sn: '1313244800040', name: 'Làn VÀO phải', ip: '172.16.56.139', doorId: 1, dirLabel: 'Cổng Làn VÀO', dark: false },
    { sn: '1313244800129', name: 'Làn VÀO trái', ip: '172.16.56.138', doorId: 1, dirLabel: 'Cổng Làn VÀO', dark: true },
    { sn: '1313244800122', name: 'Làn RA trái', ip: '172.16.56.137', doorId: 2, dirLabel: 'Cổng Làn RA', dark: false },
    { sn: '1313244800130', name: 'Làn RA phải', ip: '172.16.56.136', doorId: 2, dirLabel: 'Cổng Làn RA', dark: true },
  ];

  // Build 7-day strip around today
  const todayObj = new Date();
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayObj);
    d.setDate(todayObj.getDate() - 3 + i);
    const localIso = getLocalDateStr(d);
    return {
      name: dayNames[d.getDay()],
      num: d.getDate(),
      iso: localIso,
      isSelected: localIso === scanDate,
    };
  });

  const staffInside = analytics?.currently_inside_staff ?? 0;
  const auditDevicesList = Object.values(clockAudit?.devices || {});
  const onlineDevicesCount = auditDevicesList.filter(
    (d) => d?.status === 'OK' || d?.status === 'DRIFT_WARNING'
  ).length;
  const onlineSummaryLabel = auditDevicesList.length
    ? `${onlineDevicesCount}/${auditDevicesList.length} Online`
    : 'Đang kiểm tra kết nối';

  return (
    <div className="tino-body">
      {/* CENTER MAIN COLUMN */}
      <div className="tino-center">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="tino-greeting-sub">
              Điều khiển 4 Làn Cổng ZKTeco SenseFace · Giám sát đóng/mở trực tuyến
            </div>
            <h1 className="tino-greeting-title">
              Quản lý Cửa &amp; Làn Ra Vào ({onlineSummaryLabel})
            </h1>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-gold"
              disabled={Boolean(doorLoading?.ALL_DOORS)}
              onClick={() => onDoorAll('UNLOCK_ALL', 3)}
            >
              Mở khẩn cấp 4 làn (3s)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(doorLoading?.ALL_DOORS)}
              onClick={() => onDoorAll('LOCK_ALL', 0)}
            >
              Khóa toàn bộ 4 làn
            </button>
          </div>
        </div>

        {/* Search Bar & Date Filter Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 12, flexShrink: 0 }}>
          <div className="tino-search-bar" style={{ marginTop: 0, padding: '9px 16px', flex: 1 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              value={scanSearch}
              onChange={(e) => setScanSearch(e.target.value)}
              placeholder="Tìm nhanh họ tên nhân viên, khách, mã chấm công hoặc làn cửa..."
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--jet)', whiteSpace: 'nowrap' }}>
              Điều khiển 4 Làn Cổng
            </h2>
            <input
              type="date"
              className="v-input"
              style={{ width: 145, borderRadius: 10 }}
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
            />
          </div>
        </div>

        <div className="tino-tabs" style={{ margin: '12px 0 12px', flexShrink: 0 }}>
          {[
            { id: 'ALL_DIR', label: 'Tất cả lượt quét', dir: 'ALL', cat: 'ALL' },
            { id: 'IN_ONLY', label: 'Lượt VÀO', dir: 'IN', cat: 'ALL' },
            { id: 'OUT_ONLY', label: 'Lượt RA', dir: 'OUT', cat: 'ALL' },
            { id: 'STAFF_ONLY', label: 'Nhân viên', dir: 'ALL', cat: 'STAFF' },
            { id: 'VISITOR_ONLY', label: `Khách (${activeVisitors.length} đang ở)`, dir: 'ALL', cat: 'VISITOR' },
          ].map((t) => {
            const isActive = scanDirection === t.dir && scanCategory === t.cat;
            return (
              <button
                key={t.id}
                type="button"
                className={`tino-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setScanDirection(t.dir);
                  setScanCategory(t.cat);
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 4 Door Control Cards (White & Jet Black Tino Cards) */}
        <div className="tino-cards-grid">
          {lanes.map((lane) => {
            const devClock = clockAudit?.devices?.[lane.name];
            const isBusy = doorLoading[`${lane.sn}_UNLOCK`];
            const cardClass = lane.dark ? 'tino-card-black' : 'tino-card-white';
            const subColor = lane.dark ? '#9ca3af' : 'var(--text-muted)';

            return (
              <div key={lane.sn} className={cardClass}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{lane.name}</span>
                    <span className={`badge ${lane.dark ? 'badge-gold' : 'badge-green'}`}>
                      {lane.dirLabel} · {lane.ip}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: subColor, marginTop: 4 }}>
                    Serial: {lane.sn} · Giờ máy: {devClock?.device_time?.split(' ')[1] || 'Trực tuyến'}
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, fontWeight: 700 }}>
                    <span>Trạng thái kết nối trực tiếp</span>
                    <span style={{ color: lane.dark ? '#fff' : 'var(--gold-text)' }}>100% Online</span>
                  </div>
                  <div className="tino-progress-track">
                    <div
                      className={lane.dark ? 'tino-progress-fill-white' : 'tino-progress-fill-gold'}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${lane.dark ? 'btn-gold' : 'btn-primary'}`}
                    disabled={isBusy}
                    onClick={() => onDoorControl('UNLOCK', lane.doorId, lane.sn, lane.name, 1)}
                  >
                    Mở 1 giây
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={
                      lane.dark
                        ? { background: '#27272a', borderColor: '#3f3f46', color: '#fff' }
                        : {}
                    }
                    disabled={isBusy}
                    onClick={() => onDoorControl('UNLOCK', lane.doorId, lane.sn, lane.name, 5)}
                  >
                    Mở 5 giây
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={Boolean(doorLoading?.[`${lane.sn}_LOCK`] || isBusy)}
                    style={
                      lane.dark
                        ? { background: 'transparent', borderColor: '#3f3f46', color: '#fca5a5' }
                        : { color: 'var(--red)' }
                    }
                    onClick={() => onDoorControl('LOCK', lane.doorId, lane.sn, lane.name, 0)}
                  >
                    Khóa cửa
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Real-time Access History & Door Audit Logs Table */}
        <div className="card card-table-fill">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${doorTableTab === 'SCANS' ? 'btn-primary' : ''}`}
                onClick={() => setDoorTableTab('SCANS')}
              >
                Sự kiện quét tại 4 cổng ({realtimeLogs.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${doorTableTab === 'AUDIT' ? 'btn-primary' : ''}`}
                onClick={() => setDoorTableTab('AUDIT')}
              >
                Nhật ký Lệnh Điều khiển Cửa
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {doorTableTab === 'AUDIT' ? (
                <button type="button" className="btn btn-sm" onClick={loadDoorAuditLogs}>
                  {loadingAudit ? 'Đang tải...' : 'Làm mới nhật ký'}
                </button>
              ) : (
                <>
                  <span className="badge badge-gold">Tự động bắt sự kiện trực tiếp</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onNavigate(ROUTES.HISTORY)}
                  >
                    Xem trang Lịch sử chi tiết
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="table-scroll">
            {doorTableTab === 'AUDIT' ? (
              <table className="data-table" key="door-audit-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Thời gian</th>
                    <th>Người thực hiện</th>
                    <th>Làn cửa / Thiết bị</th>
                    <th>Lệnh điều khiển</th>
                    <th>Kết quả</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                        {loadingAudit ? 'Đang tải nhật ký điều khiển cửa...' : 'Chưa có lệnh điều khiển cửa nào được ghi nhận.'}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((a, idx) => {
                      const isOk =
                        typeof a.success === 'boolean'
                          ? a.success
                          : String(a.Status || a.status || '').toUpperCase() === 'SUCCESS' || Boolean(a.Success);
                      const ts = String(a.timestamp || a.CreatedAt || a.created_at || '').replace('T', ' ').slice(0, 19);
                      const detailTxt =
                        a.Detail ||
                        a.Message ||
                        a.detail ||
                        (a.duration_sec ? `Giữ mở ${a.duration_sec} giây` : '—');
                      return (
                        <tr key={a.id || a.AuditID || idx}>
                          <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{ts}</td>
                          <td style={{ fontWeight: 700 }}>{a.Operator || a.operator || 'Quản trị viên'}</td>
                          <td>{a.DoorName || a.DeviceIP || a.door_name || 'Toàn bộ 4 làn'}</td>
                          <td>
                            <span className="badge badge-dark">{a.Action || a.action || 'CMD'}</span>
                          </td>
                          <td>
                            <span className={`badge ${isOk ? 'badge-green' : 'badge-red'}`}>
                              {a.Status || (isOk ? 'SUCCESS' : 'FAILED')}
                            </span>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{detailTxt}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className="data-table" key="door-scans-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Thời gian</th>
                  <th>Mã định danh</th>
                  <th>Họ và tên</th>
                  <th>Đối tượng</th>
                  <th>Phòng ban / Đơn vị</th>
                  <th>Làn cửa</th>
                  <th>Hướng</th>
                  <th>Phương thức</th>
                </tr>
              </thead>
              <tbody>
                {realtimeLogs.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      Chưa có lượt quét nào trong ngày {scanDate}.
                    </td>
                  </tr>
                ) : (
                  realtimeLogs.map((row, idx) => (
                    <tr key={`${row.CheckTime || ''}_${row.EmployeeATID || ''}_${row.SerialNumber || ''}_${idx}`}>
                      <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{row.CheckTime}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.EmployeeATID}</td>
                      <td style={{ fontWeight: 700, color: 'var(--jet)' }}>{row.FullName}</td>
                      <td>
                        <span className={`badge ${row.is_staff ? 'badge-dark' : 'badge-gold'}`}>
                          {row.is_staff ? 'Nhân viên' : 'Khách'}
                        </span>
                      </td>
                      <td>{row.Department || '---'}</td>
                      <td>{row.DeviceName}</td>
                      <td>
                        <span className={`badge ${row.direction === 'IN' ? 'badge-green' : 'badge-gold'}`}>
                          {row.direction === 'IN' ? 'Lượt VÀO' : 'Lượt RA'}
                        </span>
                      </td>
                      <td>{row.VerifyMode === 'Card' ? 'Thẻ từ' : 'Khuôn mặt'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT TIMELINE & LIVE TRACKER COLUMN */}
      <aside className="tino-right">
        {/* Top User Profile Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src="/images/app_icon.png"
              alt="Avatar"
              style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'contain', background: '#fff', border: '1px solid var(--border)' }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--jet)' }}>
                {user?.full_name || 'Quản trị viên'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {user?.role === 'admin' ? 'Quản trị hệ thống' : 'Bàn Tiếp đón Lễ tân'}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={onOpenClockModal}
            title="Đối soát đồng hồ"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
        </div>

        {/* Clock Safety Tracker Card (Tino Tracker Style) */}
        <div className="tino-tracker-card">
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--jet)' }}>
              Giờ chuẩn Việt Nam (UTC+7)
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {clockAudit?.vietnam_ntp_time || 'Đang đồng bộ...'}
            </div>
          </div>
          <button
            type="button"
            className="tino-gold-icon-btn"
            onClick={onOpenClockModal}
            title="Khóa an toàn giờ 2 lớp"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        </div>

        {/* Date Header + Quick Register Visitor Button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>{scanDate}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--jet)' }}>Hôm nay</div>
          </div>
          <button
            type="button"
            className="tino-black-pill-btn"
            onClick={() => onNavigate(ROUTES.VISITORS)}
          >
            <span>+ Đăng ký khách</span>
          </button>
        </div>

        {/* 7-Day Week Strip */}
        <div className="tino-week-strip">
          {weekDays.map((wd) => (
            <div
              key={wd.iso}
              onClick={() => setScanDate(wd.iso)}
              className={`tino-day-col ${wd.isSelected ? 'active' : ''}`}
              style={{ cursor: 'pointer' }}
            >
              <span className="tino-day-name">{wd.name}</span>
              <span className="tino-day-num">{wd.num}</span>
            </div>
          ))}
        </div>

        {/* Vertical Gold Timeline of Latest Events */}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--jet)', flexShrink: 0 }}>
          Hoạt động vừa diễn ra tại 4 cổng
        </div>

        <div className="tino-timeline" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
          {realtimeLogs.slice(0, 5).map((item, idx) => {
            const isFirst = idx === 0;
            const timeShort = item.CheckTime?.split(' ')[1] || item.CheckTime;
            return (
              <div key={idx} className="tino-timeline-item">
                <div className="tino-timeline-dot" />
                <div className={isFirst ? 'tino-timeline-card-gold' : 'tino-timeline-card-white'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{item.FullName}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {timeShort}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.82, marginTop: 3 }}>
                    {item.Department || 'Nhân sự'} · {item.DeviceName}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <span className={`badge ${item.direction === 'IN' ? 'badge-green' : 'badge-dark'}`}>
                      {item.direction === 'IN' ? 'Lượt VÀO' : 'Lượt RA'}
                    </span>
                    {isFirst && (
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'var(--jet)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
