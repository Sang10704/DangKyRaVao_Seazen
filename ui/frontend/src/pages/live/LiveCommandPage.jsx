import React from 'react';

export default function LiveCommandPage({
  onCollapseSidebar,
  clockAudit,
  onOpenClockModal,
  analytics,
  activeVisitorsCount,
  totalRecordsCount,
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
  const lanes = [
    { sn: '1313244800040', name: 'Làn VÀO phải', ip: '172.16.56.139', doorId: 1, dirLabel: 'Cổng Làn VÀO' },
    { sn: '1313244800129', name: 'Làn VÀO trái', ip: '172.16.56.138', doorId: 1, dirLabel: 'Cổng Làn VÀO' },
    { sn: '1313244800122', name: 'Làn RA trái', ip: '172.16.56.137', doorId: 2, dirLabel: 'Cổng Làn RA' },
    { sn: '1313244800130', name: 'Làn RA phải', ip: '172.16.56.136', doorId: 2, dirLabel: 'Cổng Làn RA' },
  ];

  const pcClockInvalid = clockAudit && clockAudit.pc_clock_valid === false;

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
                <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                <rect x="3" y="14" width="7" height="7" rx="1"></rect>
              </svg>
            </div>
            <div>
              <h1 className="topbar-title">Trung tâm Điều khiển Cổng & Giám sát Ra vào</h1>
              <div className="topbar-sub">
                Điều khiển đóng mở 4 làn cổng tự động và theo dõi nhân sự, khách ra vào theo thời gian thực
              </div>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <div className="status-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>Giờ chuẩn Việt Nam:</span>
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
              {clockAudit?.vietnam_ntp_time?.split(' ')[1] || '--:--:--'}
            </strong>
            <span className={`badge ${pcClockInvalid ? 'badge-red' : 'badge-green'}`}>
              {pcClockInvalid ? `Lệch ${clockAudit?.pc_drift_sec}s` : 'Chuẩn giờ'}
            </span>
          </div>

          <button type="button" className="btn btn-sm" onClick={onOpenClockModal}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span>Đối soát Giờ chuẩn</span>
          </button>

          <button
            type="button"
            className="btn btn-success btn-sm"
            onClick={() => onDoorAll('UNLOCK_ALL', 3)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </svg>
            <span>Mở khẩn cấp 4 làn (3 giây)</span>
          </button>

          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => onDoorAll('LOCK_ALL', 0)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>Khóa toàn bộ 4 làn</span>
          </button>
        </div>
      </header>

      <div className="content-wrap">
        {/* 1. KPI Summary Cards */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Quân số đang tại văn phòng</div>
            <div className="stat-value">{analytics?.currently_inside_staff ?? 0}</div>
            <div className="stat-sub">Nhân sự đã quét vào và chưa quét ra</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Khách đang làm việc</div>
            <div className="stat-value">{activeVisitorsCount}</div>
            <div className="stat-sub">Khách đang giữ thẻ ra vào tại tòa nhà</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Lượt quét trong ngày</div>
            <div className="stat-value">{realtimeLogs.length}</div>
            <div className="stat-sub">Ngày đang xem: {scanDate}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Tổng hồ sơ lưu trữ</div>
            <div className="stat-value">{(totalRecordsCount || 5152).toLocaleString()}</div>
            <div className="stat-sub">Đang đồng bộ trực tuyến trên toàn hệ thống</div>
          </div>
        </div>

        {/* 2. 4 Lane Hardware Control Cards */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"></path>
                <path d="M2 20h20"></path>
                <path d="M14 12v.01"></path>
              </svg>
              <span>Bảng Điều khiển Trực tiếp 4 Làn Cổng Kiểm Soát</span>
            </div>
            <span className="badge badge-green">4/4 Thiết bị đang kết nối</span>
          </div>

          <div className="card-body">
            <div className="lane-grid">
              {lanes.map((lane) => {
                const devClock = clockAudit?.devices?.[lane.name];
                const isBusy = doorLoading[`${lane.sn}_UNLOCK`];
                const driftSec = devClock?.drift_vs_vn_sec ?? 0;
                return (
                  <div key={lane.sn} className="lane-card">
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className={`badge ${lane.doorId === 1 ? 'badge-blue' : 'badge-amber'}`}>
                          {lane.dirLabel}
                        </span>
                        <span className="badge badge-green">Trực tuyến</span>
                      </div>

                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>
                        {lane.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Địa chỉ: {lane.ip} · Mã máy: {lane.sn}
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11.5,
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span>Giờ máy: {devClock?.device_time?.split(' ')[1] || '--:--:--'}</span>
                        <span style={{ color: Math.abs(driftSec) > 60 ? 'var(--amber-text)' : 'var(--text-muted)' }}>
                          Độ lệch: {driftSec}s
                        </span>
                      </div>
                    </div>

                    <div className="form-grid-3">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={isBusy}
                        onClick={() => onDoorControl('UNLOCK', lane.doorId, lane.sn, lane.name, 1)}
                      >
                        Mở 1 giây
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={isBusy}
                        onClick={() => onDoorControl('UNLOCK', lane.doorId, lane.sn, lane.name, 5)}
                      >
                        Mở 5 giây
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => onDoorControl('LOCK', lane.doorId, lane.sn, lane.name, 0)}
                      >
                        Khóa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. Realtime Scan Table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              <span>Nhật ký Nhận diện Khuôn mặt & Quẹt thẻ Thời gian thực</span>
            </div>

            <div className="filter-bar">
              <div className="field-group">
                <input
                  type="date"
                  className="form-control"
                  value={scanDate}
                  onChange={(e) => setScanDate(e.target.value)}
                  style={{ width: 145 }}
                />
              </div>

              <div className="field-group">
                <select
                  className="form-control"
                  value={scanDirection}
                  onChange={(e) => setScanDirection(e.target.value)}
                  style={{ width: 165 }}
                >
                  <option value="ALL">Tất cả hướng (Vào & Ra)</option>
                  <option value="IN">Chỉ Lượt VÀO</option>
                  <option value="OUT">Chỉ Lượt RA</option>
                </select>
              </div>

              <div className="field-group">
                <select
                  className="form-control"
                  value={scanCategory}
                  onChange={(e) => setScanCategory(e.target.value)}
                  style={{ width: 170 }}
                >
                  <option value="ALL">Tất cả đối tượng</option>
                  <option value="STAFF">Nhân sự công ty</option>
                  <option value="VISITOR">Khách & Thẻ tạm</option>
                </select>
              </div>

              <div className="field-group">
                <input
                  type="text"
                  className="form-control"
                  value={scanSearch}
                  onChange={(e) => setScanSearch(e.target.value)}
                  placeholder="Tìm họ tên, mã nhân sự, phòng ban..."
                  style={{ width: 240 }}
                />
              </div>
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>STT</th>
                  <th>Thời gian quét</th>
                  <th>Mã định danh</th>
                  <th>Họ và tên</th>
                  <th>Phòng ban / Đơn vị</th>
                  <th>Vị trí làn cổng</th>
                  <th>Hướng di chuyển</th>
                  <th>Hình thức xác thực</th>
                </tr>
              </thead>
              <tbody>
                {realtimeLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                      Chưa ghi nhận lượt quét nào khớp điều kiện lọc trong ngày {scanDate}.
                    </td>
                  </tr>
                ) : (
                  realtimeLogs.map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.CheckTime}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{row.EmployeeATID}</td>
                      <td style={{ fontWeight: 600 }}>{row.FullName}</td>
                      <td>{row.Department || '---'}</td>
                      <td>{row.DeviceName}</td>
                      <td>
                        <span className={`badge ${row.direction === 'IN' ? 'badge-green' : 'badge-amber'}`}>
                          {row.direction_label || (row.direction === 'IN' ? 'Lượt VÀO' : 'Lượt RA')}
                        </span>
                      </td>
                      <td>{row.VerifyMode === 'Card' ? 'Thẻ từ' : 'Khuôn mặt'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
