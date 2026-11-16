import React from 'react';
import { ROUTES } from '../../constants/routes';

export default function SidebarShell({
  currentPath,
  onNavigate,
  user,
  onLogout,
  onExpandSidebar,
  activeVisitorsCount = 0,
}) {
  const navGroups = [
    {
      sectionLabel: 'Giám sát & Điều hành',
      items: [
        {
          path: ROUTES.LIVE,
          label: 'Điều khiển Cổng & Giám sát',
          svg: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            </svg>
          ),
        },
        {
          path: ROUTES.VISITORS,
          label: 'Tiếp đón Khách & Nhà thầu',
          badge: activeVisitorsCount > 0 ? activeVisitorsCount : null,
          svg: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M19 8v6M22 11h-6"></path>
            </svg>
          ),
        },
      ],
    },
    {
      sectionLabel: 'Nhân sự & Chấm công',
      items: [
        {
          path: ROUTES.HRM,
          label: 'Quản lý Nhân sự & Khuôn mặt',
          svg: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="17" rx="2"></rect>
              <circle cx="9" cy="10" r="2"></circle>
              <path d="M5 17c0-2 1.5-3 4-3s4 1 4 3M15 9h4M15 13h4M15 17h4"></path>
            </svg>
          ),
        },
        {
          path: ROUTES.TIMEKEEPING,
          label: 'Tổng hợp Công & Ca trực',
          svg: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          ),
        },
      ],
    },
    {
      sectionLabel: 'Phân quyền & Hệ thống',
      items: [
        {
          path: ROUTES.ACCESS_RULES,
          label: 'Phân quyền Cổng & Khung giờ',
          svg: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          ),
        },
        {
          path: ROUTES.DATA_SYNC,
          label: 'Quản trị Dữ liệu & Đồng bộ',
          svg: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
          ),
        },
      ],
    },
  ];

  const roleLabel = user?.role === 'admin' ? 'Quản trị viên hệ thống' : 'Nhân viên tiếp đón';

  return (
    <aside className="sidebar" id="sidebarContainer">
      <div className="sidebar-brand-wrap">
        <button
          type="button"
          className="sz-btn-expand-sidebar"
          onClick={onExpandSidebar}
          title="Mở rộng thanh điều hướng"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <a
          href={ROUTES.LIVE}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(ROUTES.LIVE);
          }}
          className="sidebar-brand"
        >
          <img src="/images/app_icon.png" alt="SeaZen" />
          <div>
            <div className="sidebar-brand-title">SEAZEN PORTAL</div>
            <div className="sidebar-brand-sub">Kiểm soát Ra vào & An ninh</div>
          </div>
        </a>
      </div>

      <div className="sidebar-nav">
        {navGroups.map((grp) => (
          <div key={grp.sectionLabel} className="nav-group">
            <div className="nav-section-label">{grp.sectionLabel}</div>
            {grp.items.map((item) => {
              const active = currentPath === item.path;
              return (
                <a
                  key={item.path}
                  href={item.path}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(item.path);
                  }}
                  className={`nav-item ${active ? 'active' : ''}`}
                  title={item.label}
                >
                  {item.svg}
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="user-info-name">{user?.full_name || 'Cán bộ vận hành'}</div>
        <div className="user-info-role">{roleLabel}</div>
        <div
          className="sidebar-version-row"
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            margin: '4px 0 10px 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Phiên bản:</span>
          <span className="badge" style={{ background: '#e2e8f0', color: '#334155' }}>
            v2.5
          </span>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="btn btn-sm"
          style={{ width: '100%' }}
          title="Đăng xuất tài khoản"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          <span>Đăng xuất hệ thống</span>
        </button>
      </div>
    </aside>
  );
}
