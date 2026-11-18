import React, { useMemo, useState } from 'react';
import { ROUTES } from '../../constants/routes';

function formatSmoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function SvgDonut({ segments, centerLabel, centerValue, size = 136 }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const strokeWidth = 18;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((acc, s) => acc + (s.value || 0), 0);

  let offsetAcc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            segments.map((seg, idx) => {
              const frac = (seg.value || 0) / total;
              const dashLen = Math.max(0, frac * circumference);
              const dashGap = Math.max(0, circumference - dashLen);
              const rot = -90 + (offsetAcc / total) * 360;
              offsetAcc += seg.value || 0;
              if (seg.value <= 0) return null;
              return (
                <circle
                  key={seg.label}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={hoverIdx === idx ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={`${dashLen} ${dashGap}`}
                  transform={`rotate(${rot} ${cx} ${cy})`}
                  style={{ transition: 'stroke-width 0.15s ease', cursor: 'pointer' }}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                />
              );
            })}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111111', lineHeight: 1.1 }}>
            {hoverIdx !== null && segments[hoverIdx] ? segments[hoverIdx].value : centerValue}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', marginTop: 2 }}>
            {hoverIdx !== null && segments[hoverIdx] ? segments[hoverIdx].short || segments[hoverIdx].label : centerLabel}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 140 }}>
        {segments.map((seg, idx) => {
          const pct = total > 0 ? Math.round(((seg.value || 0) / total) * 100) : 0;
          return (
            <div
              key={seg.label}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: 12,
                padding: '3px 6px',
                borderRadius: 6,
                background: hoverIdx === idx ? '#f8fafc' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 3,
                    background: seg.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: '#334155', fontWeight: 600 }}>{seg.label}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#111111' }}>
                {seg.value} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OverviewDashboardPage({
  user,
  analytics,
  activeVisitors = [],
  customerCards = [],
  pendingCardPhotoCount = 0,
  realtimeLogs = [],
  scanDate,
  setScanDate,
  onNavigate,
  clockAudit,
}) {
  const [hoverHourIdx, setHoverHourIdx] = useState(null);
  const [deptTab, setDeptTab] = useState('staff');

  const kpi = analytics?.kpi || {};
  const hourly = analytics?.hourly || { labels: [], staff: [], visitors: [] };
  const staffInside = analytics?.currently_inside_staff ?? kpi.staff_present ?? 0;
  const staffUniqueToday = kpi.staff_unique_today ?? staffInside;
  const totalIn = kpi.total_in ?? 0;
  const totalOut = kpi.total_out ?? 0;

  const overdueVisitors = useMemo(
    () => (activeVisitors || []).filter((v) => Boolean(v.expiry_alert_type || v.overdue_alert)),
    [activeVisitors]
  );

  const incompleteCards = useMemo(
    () =>
      (customerCards || []).filter((c) => {
        const hasName = Boolean(String(c.CardName || '').trim());
        const hasPhoto = Boolean(c.HasPhoto) || (c.CardPhotoBase64 && String(c.CardPhotoBase64).length > 20);
        return !hasName || !hasPhoto;
      }),
    [customerCards]
  );

  const cardSegments = useMemo(() => {
    let available = 0;
    let inUse = 0;
    let lostOrLocked = 0;
    (customerCards || []).forEach((c) => {
      const st = String(c.Status || 'AVAILABLE').toUpperCase();
      if (st === 'LOST' || st === 'LOCKED') lostOrLocked += 1;
      else if (st === 'IN_USE') inUse += 1;
      else available += 1;
    });
    return [
      { label: 'Sẵn sàng cấp', short: 'Sẵn sàng', value: available, color: '#16a34a' },
      { label: 'Đang cấp cho khách', short: 'Đang cấp', value: inUse, color: '#d97706' },
      { label: 'Báo mất / Khóa', short: 'Mất/Khóa', value: lostOrLocked, color: '#dc2626' },
    ];
  }, [customerCards]);

  const verifySegments = useMemo(() => {
    let face = 0;
    let card = 0;
    let other = 0;
    (realtimeLogs || []).forEach((log) => {
      const vm = String(log.VerifyMode || log.verify_mode || '').toLowerCase();
      if (vm.includes('face') || vm.includes('khuôn') || vm === '15') face += 1;
      else if (vm.includes('card') || vm.includes('thẻ') || vm === '4') card += 1;
      else other += 1;
    });
    return [
      { label: 'Nhận diện Khuôn mặt', short: 'Khuôn mặt', value: face, color: '#111111' },
      { label: 'Quẹt Thẻ RFID', short: 'Thẻ RFID', value: card, color: '#d97706' },
      { label: 'Khác / Vân tay', short: 'Khác', value: other, color: '#64748b' },
    ];
  }, [realtimeLogs]);

  const deptList = useMemo(() => {
    const raw =
      deptTab === 'staff'
        ? analytics?.top_staff_departments || []
        : analytics?.top_visitor_departments || analytics?.top_departments || [];
    return raw.slice(0, 7);
  }, [analytics, deptTab]);

  const maxDeptCount = useMemo(
    () => Math.max(1, ...deptList.map((d) => Number(d.count || 0))),
    [deptList]
  );

  // Hourly Chart geometry
  const chartW = 640;
  const chartH = 220;
  const padL = 34;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const hourLabels = hourly.labels || [];
  const staffSeries = hourly.staff || [];
  const visitorSeries = hourly.visitors || [];
  const maxHourVal = Math.max(5, ...staffSeries, ...visitorSeries);

  const staffPts = hourLabels.map((_, i) => {
    const x = padL + (hourLabels.length > 1 ? (i / (hourLabels.length - 1)) * plotW : plotW / 2);
    const y = padT + plotH - ((staffSeries[i] || 0) / maxHourVal) * plotH;
    return { x, y, val: staffSeries[i] || 0 };
  });

  const visitorPts = hourLabels.map((_, i) => {
    const x = padL + (hourLabels.length > 1 ? (i / (hourLabels.length - 1)) * plotW : plotW / 2);
    const y = padT + plotH - ((visitorSeries[i] || 0) / maxHourVal) * plotH;
    return { x, y, val: visitorSeries[i] || 0 };
  });

  const staffLineD = formatSmoothPath(staffPts);
  const staffAreaD =
    staffPts.length > 0
      ? `${staffLineD} L ${staffPts[staffPts.length - 1].x} ${padT + plotH} L ${staffPts[0].x} ${padT + plotH} Z`
      : '';
  const visitorLineD = formatSmoothPath(visitorPts);

  const staffOut = kpi.staff_checked_out ?? Math.max(0, staffUniqueToday - staffInside);
  const visitorInside = activeVisitors.length;
  const visitorOut = kpi.visitor_checked_out ?? 0;

  return (
    <div className="tino-body">
      <div className="tino-center" style={{ overflowY: 'auto', paddingBottom: 24 }}>
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 14,
            marginBottom: 14,
          }}
        >
          <div>
            <div className="tino-greeting-sub">
              Xin chào, {user?.full_name || 'Quản trị viên'} · Tổng quan An ninh &amp; Ra vào
            </div>
            <h1 className="tino-greeting-title" style={{ marginBottom: 0 }}>
              Bảng điều hành SeaZen VMS
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {clockAudit && (
              <span
                className="badge"
                style={{
                  background: clockAudit.pc_clock_valid ? '#f0fdf4' : '#fef2f2',
                  color: clockAudit.pc_clock_valid ? '#15803d' : '#dc2626',
                  border: `1px solid ${clockAudit.pc_clock_valid ? '#bbf7d0' : '#fecaca'}`,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  padding: '6px 10px',
                }}
              >
                UTC+7: {String(clockAudit.vietnam_ntp_time || '').slice(11, 19) || 'Online'}
              </span>
            )}
            <input
              type="date"
              className="v-input"
              style={{ width: 145, height: 36, borderRadius: 10 }}
              value={scanDate}
              onChange={(e) => setScanDate(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm"
              style={{ height: 36 }}
              onClick={() => onNavigate(ROUTES.DOORS)}
            >
              Điều khiển 4 Cửa
            </button>
            <button
              type="button"
              className="btn btn-gold"
              style={{ height: 36 }}
              onClick={() => onNavigate(ROUTES.VISITORS)}
            >
              + Đăng ký khách
            </button>
          </div>
        </div>

        {/* 4 KPI SUMMARY CARDS */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div
            className="card"
            style={{ padding: '14px 16px', cursor: 'pointer' }}
            onClick={() => onNavigate(ROUTES.TIMEKEEPING)}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Nhân sự đang có mặt
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
                {staffInside}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                / {staffUniqueToday} đi làm hôm nay
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#15803d', fontWeight: 600, marginTop: 4 }}>
              {kpi.staff_in_scans ?? 0} lượt vào · {kpi.staff_out_scans ?? 0} lượt ra
            </div>
          </div>

          <div
            className="card"
            style={{
              padding: '14px 16px',
              cursor: 'pointer',
              borderColor: overdueVisitors.length > 0 ? '#fca5a5' : undefined,
              background: overdueVisitors.length > 0 ? '#fffbfb' : undefined,
            }}
            onClick={() => onNavigate(ROUTES.VISITORS)}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Khách đang giữ thẻ
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
                {visitorInside}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                ({visitorOut} đã trả thẻ hôm nay)
              </span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                marginTop: 4,
                color: overdueVisitors.length > 0 ? '#dc2626' : '#64748b',
              }}
            >
              {overdueVisitors.length > 0
                ? `${overdueVisitors.length} khách đến hạn / chưa trả thẻ`
                : 'Không có khách quá hạn trả thẻ'}
            </div>
          </div>

          <div
            className="card"
            style={{
              padding: '14px 16px',
              cursor: 'pointer',
              borderColor: pendingCardPhotoCount > 0 ? '#fcd34d' : undefined,
            }}
            onClick={() => onNavigate(ROUTES.CARDS)}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Kho Thẻ RFID
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
                {customerCards.length}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                thẻ quản lý
              </span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                marginTop: 4,
                color: pendingCardPhotoCount > 0 ? '#b45309' : '#15803d',
              }}
            >
              {pendingCardPhotoCount > 0
                ? `${pendingCardPhotoCount} thẻ thiếu Tên / Ảnh bằng chứng`
                : '100% thẻ đủ Tên & Ảnh'}
            </div>
          </div>

          <div
            className="card"
            style={{ padding: '14px 16px', cursor: 'pointer' }}
            onClick={() => onNavigate(ROUTES.DOORS)}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Lưu lượng qua 4 Cổng
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: '#111111', fontVariantNumeric: 'tabular-nums' }}>
                {totalIn + totalOut}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                lượt quét ngày {scanDate}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#334155', fontWeight: 600, marginTop: 4 }}>
              Vào: {totalIn} · Ra: {totalOut} · 4/4 ZKTeco Online
            </div>
          </div>
        </div>

        {/* ROW 2: CHARTS 1 & 2 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.35fr 1fr',
            gap: 14,
            marginBottom: 14,
          }}
        >
          {/* CHART 1: HOURLY TRAFFIC */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111111' }}>
                  Lưu lượng Ra / Vào theo khung giờ
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Phân bố lượt quét từ 06:00 đến 22:00 (Nhân viên &amp; Khách)
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11.5, fontWeight: 600 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 3, background: '#111111', borderRadius: 2 }} />
                  Nhân viên
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 3, background: '#d97706', borderRadius: 2 }} />
                  Khách
                </span>
              </div>
            </div>

            <div style={{ position: 'relative', width: '100%' }}>
              <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="staffAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#111111" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#111111" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                  const y = padT + plotH * (1 - t);
                  const val = Math.round(maxHourVal * t);
                  return (
                    <g key={idx}>
                      <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                      <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="monospace">
                        {val}
                      </text>
                    </g>
                  );
                })}

                {staffAreaD && <path d={staffAreaD} fill="url(#staffAreaGrad)" />}
                {staffLineD && <path d={staffLineD} fill="none" stroke="#111111" strokeWidth="2.4" />}
                {visitorLineD && <path d={visitorLineD} fill="none" stroke="#d97706" strokeWidth="2.2" strokeDasharray="5 3" />}

                {hourLabels.map((lbl, i) => {
                  const ptS = staffPts[i];
                  const ptV = visitorPts[i];
                  const showTick = i % 2 === 0;
                  return (
                    <g key={lbl}>
                      {showTick && (
                        <text
                          x={ptS.x}
                          y={chartH - 8}
                          textAnchor="middle"
                          fontSize="10"
                          fill="#64748b"
                          fontFamily="monospace"
                        >
                          {lbl.slice(0, 2)}h
                        </text>
                      )}
                      {hoverHourIdx === i && (
                        <>
                          <line x1={ptS.x} y1={padT} x2={ptS.x} y2={padT + plotH} stroke="#cbd5e1" strokeDasharray="3 3" />
                          <circle cx={ptS.x} cy={ptS.y} r="4.5" fill="#111111" stroke="#ffffff" strokeWidth="1.5" />
                          <circle cx={ptV.x} cy={ptV.y} r="4" fill="#d97706" stroke="#ffffff" strokeWidth="1.5" />
                        </>
                      )}
                      <rect
                        x={ptS.x - plotW / Math.max(1, hourLabels.length * 2)}
                        y={padT}
                        width={plotW / Math.max(1, hourLabels.length)}
                        height={plotH}
                        fill="transparent"
                        style={{ cursor: 'crosshair' }}
                        onMouseEnter={() => setHoverHourIdx(i)}
                        onMouseLeave={() => setHoverHourIdx(null)}
                      />
                    </g>
                  );
                })}
              </svg>

              {hoverHourIdx !== null && hourLabels[hoverHourIdx] && (
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 12,
                    background: '#111111',
                    color: '#ffffff',
                    padding: '6px 10px',
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontFamily: 'var(--font-mono)',
                    pointerEvents: 'none',
                  }}
                >
                  <strong>{hourLabels[hoverHourIdx]}</strong> · NV: {staffSeries[hoverHourIdx] || 0} · Khách:{' '}
                  {visitorSeries[hoverHourIdx] || 0}
                </div>
              )}
            </div>
          </div>

          {/* CHART 2: DEPARTMENT BREAKDOWN */}
          <div className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111111' }}>
                  Phân bổ theo Phòng ban
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Top phòng ban có lượt ra vào nhiều nhất
                </div>
              </div>
              <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 8, padding: 2 }}>
                <button
                  type="button"
                  onClick={() => setDeptTab('staff')}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 9px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: deptTab === 'staff' ? '#ffffff' : 'transparent',
                    color: deptTab === 'staff' ? '#111111' : 'var(--text-muted)',
                  }}
                >
                  Nhân viên
                </button>
                <button
                  type="button"
                  onClick={() => setDeptTab('visitor')}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 9px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: deptTab === 'visitor' ? '#ffffff' : 'transparent',
                    color: deptTab === 'visitor' ? '#111111' : 'var(--text-muted)',
                  }}
                >
                  Khách đến
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center' }}>
              {deptList.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, padding: 24 }}>
                  Chưa có dữ liệu phòng ban trong ngày.
                </div>
              ) : (
                deptList.map((d, i) => {
                  const pct = Math.max(6, Math.round((Number(d.count || 0) / maxDeptCount) * 100));
                  return (
                    <div key={d.name || i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{d.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#111111' }}>
                          {d.count}
                        </span>
                      </div>
                      <div style={{ height: 7, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            borderRadius: 99,
                            background: deptTab === 'staff' ? (i === 0 ? '#111111' : '#475569') : '#d97706',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ROW 3: CHARTS 3 & 4 (DONUTS + PRESENCE) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 14,
            marginBottom: 14,
          }}
        >
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111111', marginBottom: 4 }}>
              Cơ cấu Kho Thẻ Khách
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              Tỷ lệ thẻ sẵn sàng, đang cấp và báo mất
            </div>
            <SvgDonut segments={cardSegments} centerLabel="Tổng thẻ" centerValue={customerCards.length} />
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111111', marginBottom: 4 }}>
              Phương thức Xác thực
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              Tỷ lệ quét khuôn mặt và thẻ RFID hôm nay
            </div>
            <SvgDonut
              segments={verifySegments}
              centerLabel="Lượt quét"
              centerValue={realtimeLogs.length}
            />
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111111', marginBottom: 4 }}>
              Hiện diện tại Văn phòng
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              Đang ở trong tòa nhà so với đã ra về
            </div>
            <SvgDonut
              segments={[
                { label: 'NV đang tại VP', short: 'NV có mặt', value: staffInside, color: '#111111' },
                { label: 'NV đã về', short: 'NV đã về', value: staffOut, color: '#94a3b8' },
                { label: 'Khách đang ở trong', short: 'Khách', value: visitorInside, color: '#d97706' },
              ]}
              centerLabel="Đang có mặt"
              centerValue={staffInside + visitorInside}
            />
          </div>
        </div>

        {/* ROW 4: ACTIONABLE ALERTS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111111' }}>
                Khách đến hạn / Chưa trả thẻ ({overdueVisitors.length})
              </div>
              <button type="button" className="btn btn-sm" onClick={() => onNavigate(ROUTES.VISITORS)}>
                Mở Đăng ký Khách
              </button>
            </div>
            {overdueVisitors.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 0' }}>
                Hiện không có khách nào quá hạn trả thẻ hoặc đã qua Làn RA chưa check-out.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {overdueVisitors.slice(0, 4).map((v) => (
                  <div
                    key={v.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #fecaca',
                      background: '#fef2f2',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#991b1b' }}>
                      {v.full_name} · Thẻ {v.card_display_name || v.card_number || '—'}
                    </div>
                    <div style={{ color: '#b91c1c', fontSize: 11.5, marginTop: 2 }}>
                      {v.expiry_alert_message || v.alert_message || 'Đến hạn trả thẻ — cần kiểm tra'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111111' }}>
                Thẻ cần bổ sung Tên / Ảnh ({incompleteCards.length})
              </div>
              <button type="button" className="btn btn-sm" onClick={() => onNavigate(ROUTES.CARDS)}>
                Mở Kho Thẻ
              </button>
            </div>
            {incompleteCards.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', padding: '10px 0' }}>
                Tất cả thẻ trong kho đều đã có đủ Tên thẻ và Ảnh bằng chứng.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {incompleteCards.slice(0, 4).map((c) => {
                  const hasName = Boolean(String(c.CardName || '').trim());
                  const hasPhoto = Boolean(c.HasPhoto) || (c.CardPhotoBase64 && String(c.CardPhotoBase64).length > 20);
                  return (
                    <div
                      key={c.CardID || c.CardNumber}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #fde68a',
                        background: '#fffbeb',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 12,
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 800, color: '#111111' }}>
                          {c.CardName || `RFID ${c.CardNumber}`}
                        </span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>
                          {c.CardCode}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>
                        {!hasName && !hasPhoto ? 'Thiếu Tên & Ảnh' : !hasName ? 'Thiếu Tên thẻ' : 'Thiếu Ảnh'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
