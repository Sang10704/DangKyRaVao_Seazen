import React from 'react';
import { DATA_CATEGORY_LABELS } from '../../constants/routes';

export default function DataManagementPage({
  onCollapseSidebar,
  sqlOverview,
  selectedSqlTable,
  setSelectedSqlTable,
  sqlTableRows,
  spStatus,
  syncBusy,
  lastSyncReport,
  onRunSafeSyncTest,
  onProvisionCloudLists,
  onSyncSingleCategory,
}) {
  const currentCategoryLabel = DATA_CATEGORY_LABELS[selectedSqlTable] || selectedSqlTable;
  const currentSpMeta = spStatus.schemas?.find((s) => s.sql_table === selectedSqlTable);

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
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              </svg>
            </div>
            <div>
              <h1 className="topbar-title">Quản trị Dữ liệu & Đồng bộ Lưu trữ Hệ thống</h1>
              <div className="topbar-sub">
                Tra cứu 18 danh mục dữ liệu nghiệp vụ, cập nhật từ thiết bị cổng và đồng bộ lên hệ thống lưu trữ trung tâm
              </div>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <div className="status-pill">
            <span>Tài khoản kết nối:</span>
            <strong>{spStatus.account || 'Đã kết nối hệ thống'}</strong>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            disabled={syncBusy}
            onClick={onRunSafeSyncTest}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>{syncBusy ? 'Đang xử lý...' : 'Cập nhật dữ liệu từ thiết bị'}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={syncBusy}
            onClick={onProvisionCloudLists}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <span>Đồng bộ Cấu trúc 18 Danh mục</span>
          </button>
        </div>
      </header>

      <div className="content-wrap">
        {lastSyncReport && (
          <div
            style={{
              background: 'var(--green-soft)',
              border: '1px solid #bbf7d0',
              color: 'var(--green-text)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              fontSize: 12.5,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              Đã hoàn tất cập nhật dữ liệu an toàn từ 4 thiết bị nhận diện tại cổng (Số hồ sơ cập nhật:{' '}
              {lastSyncReport.zk_hardware_readonly_sync?.hardware_users_synced ?? 0} · Giờ chuẩn Việt Nam:{' '}
              {lastSyncReport.zk_hardware_readonly_sync?.clock_audit?.vietnam_ntp_time}).
            </span>
            <span className="badge badge-green">An toàn 100%</span>
          </div>
        )}

        <div className="split-layout" style={{ gridTemplateColumns: '380px 1fr' }}>
          {/* Left: 18 Business Categories */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">18 Danh mục Dữ liệu Nghiệp vụ</div>
            </div>
            <div style={{ maxHeight: 540, overflowY: 'auto' }}>
              {sqlOverview.tables?.map((t, idx) => {
                const isSelected = selectedSqlTable === t.table_name;
                const spItem = spStatus.schemas?.find((s) => s.sql_table === t.table_name);
                const label = DATA_CATEGORY_LABELS[t.table_name] || t.vn_name;
                return (
                  <div
                    key={t.table_name}
                    onClick={() => setSelectedSqlTable(t.table_name)}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border)',
                      background: isSelected ? 'var(--primary-soft)' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: isSelected ? 'var(--primary)' : 'var(--text-main)',
                        }}
                      >
                        {idx + 1}. {label}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        Danh sách: {t.sharepoint_list_name} · {t.row_count} bản ghi
                        {spItem?.exists_on_sharepoint ? ` · Đã đồng bộ (${spItem.sp_item_count})` : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={syncBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSyncSingleCategory(t.table_name);
                      }}
                    >
                      Đồng bộ
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Data Preview & Column Labels */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">
                  Dữ liệu chi tiết: {currentCategoryLabel} ({sqlTableRows.length} dòng hiển thị)
                </div>
                {currentSpMeta?.vietnamese_columns && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {currentSpMeta.vietnamese_columns.map((c, i) => (
                      <span key={i} className="badge badge-blue">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="badge badge-green">{currentSpMeta?.list_title}</span>
            </div>

            <div className="table-scroll">
              {sqlTableRows.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Danh mục này hiện chưa có bản ghi nào.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>STT</th>
                      {Object.keys(sqlTableRows[0])
                        .slice(0, 7)
                        .map((col, idx) => (
                          <th key={col}>
                            {currentSpMeta?.vietnamese_columns?.[idx] || col}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sqlTableRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{rIdx + 1}</td>
                        {Object.keys(sqlTableRows[0])
                          .slice(0, 7)
                          .map((col) => (
                            <td
                              key={col}
                              style={{
                                maxWidth: 200,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {String(row[col] ?? '---')}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
