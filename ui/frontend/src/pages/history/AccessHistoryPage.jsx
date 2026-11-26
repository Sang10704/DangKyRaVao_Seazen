import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';
import { getLocalDateStr } from '../../utils/dateUtils';

export default function AccessHistoryPage({ notify }) {
  const todayStr = getLocalDateStr();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [directionFilter, setDirectionFilter] = useState('ALL'); // ALL | IN | OUT
  const [personFilter, setPersonFilter] = useState('ALL'); // ALL | STAFF | VISITOR
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const dateParam = selectedDate === 'ALL' ? 'ALL' : selectedDate;
        const { ok, data } = await apiFetch(
          `/api/door/realtime_logs?date=${encodeURIComponent(
            dateParam
          )}&category=${personFilter}&direction=${directionFilter}&search=${encodeURIComponent(
            searchQuery
          )}&limit=800`
        );
        if (ok && data?.logs) {
          setLogs(data.logs);
        }
      } catch (e) {
        if (!silent && notify) notify('Lỗi tải lịch sử ra vào: ' + e.message, 'error');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedDate, personFilter, directionFilter, searchQuery, notify]
  );

  useEffect(() => {
    loadHistory(false);
    const id = setInterval(() => loadHistory(true), 3500);
    return () => clearInterval(id);
  }, [loadHistory]);

  const stats = useMemo(() => {
    let staffCount = 0;
    let visitorCount = 0;
    let inCount = 0;
    let outCount = 0;
    for (const s of logs) {
      if (s.is_staff) staffCount += 1;
      else visitorCount += 1;
      if (s.direction === 'IN') inCount += 1;
      else outCount += 1;
    }
    return {
      total: logs.length,
      staffCount,
      visitorCount,
      inCount,
      outCount,
    };
  }, [logs]);

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* TOP HEADER & DATE CONTROLS (FIXED) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              Nhật ký trực tiếp TCP 4370 (CMD_REG_EVENT) & SQL Server (tbl_AttendanceLogs)
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Lịch sử Ra vào Chi tiết — Nhân viên & Khách ({stats.total} lượt)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${selectedDate === todayStr ? 'btn-primary' : ''}`}
              onClick={() => setSelectedDate(todayStr)}
            >
              Hôm nay ({todayStr})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${selectedDate === 'ALL' ? 'btn-gold' : ''}`}
              onClick={() => setSelectedDate('ALL')}
            >
              Tất cả các ngày
            </button>
            <input
              type="date"
              className="v-input"
              style={{ width: 150, height: 32 }}
              value={selectedDate === 'ALL' ? '' : selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || 'ALL')}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                loadHistory(false);
                if (notify) notify('Đã làm mới nhật ký ra vào.', 'success');
              }}
            >
              {loading ? 'Đang tải...' : 'Làm mới'}
            </button>
          </div>
        </div>

        {/* FILTER BAR & SUMMARY PILLS (FIXED) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="tino-search-bar" style={{ marginTop: 0, padding: '7px 14px', width: 320 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Tìm họ tên, mã ATID, thẻ, phòng ban, làn cửa..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="v-input"
              style={{ width: 170 }}
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
            >
              <option value="ALL">Mọi đối tượng ({stats.total})</option>
              <option value="STAFF">Chỉ Nhân viên ({stats.staffCount})</option>
              <option value="VISITOR">Chỉ Khách ({stats.visitorCount})</option>
            </select>

            <select
              className="v-input"
              style={{ width: 165 }}
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
            >
              <option value="ALL">Mọi hướng (VÀO & RA)</option>
              <option value="IN">Lượt VÀO ({stats.inCount})</option>
              <option value="OUT">Lượt RA ({stats.outCount})</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-dark">Tổng: {stats.total} lượt</span>
            <span className="badge badge-green">VÀO: {stats.inCount}</span>
            <span className="badge badge-gold">RA: {stats.outCount}</span>
            <span className="badge" style={{ background: '#f3f4f6', color: '#111111' }}>
              Nhân viên: {stats.staffCount} · Khách: {stats.visitorCount}
            </span>
          </div>
        </div>

        {/* FIXED-HEIGHT INTERNAL SCROLL TABLE */}
        <div className="card card-table-fill">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div>
              <div className="card-title">
                Danh sách Chi tiết Lượt Quét Khuôn mặt & Thẻ từ qua 4 Máy Cửa ZKTeco
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Khung bảng cố định chiều cao · Chỉ cuộn danh sách bên trong bảng
              </div>
            </div>
            <span className="badge badge-gold">{logs.length} bản ghi</span>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Thời gian quét</th>
                  <th>Mã định danh (ATID)</th>
                  <th>Họ và tên</th>
                  <th>Đối tượng</th>
                  <th>Phòng ban / Đơn vị</th>
                  <th>Mã thẻ RFID</th>
                  <th>Làn cửa</th>
                  <th>Hướng</th>
                  <th>Phương thức</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                      Không có lượt quét nào khớp với điều kiện lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  logs.map((row, idx) => (
                    <tr key={`${row.EmployeeATID}-${row.CheckTime}-${idx}`}>
                      <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {String(row.CheckTime || '').replace('T', ' ')}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {row.EmployeeATID}
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--jet)' }}>{row.FullName}</td>
                      <td>
                        <span className={`badge ${row.is_staff ? 'badge-dark' : 'badge-gold'}`}>
                          {row.is_staff ? 'Nhân viên' : 'Khách'}
                        </span>
                      </td>
                      <td>{row.Department || '---'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.CardNumber || '---'}</td>
                      <td>{row.DeviceName || row.SerialNumber}</td>
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
          </div>
        </div>
      </div>
    </div>
  );
}
