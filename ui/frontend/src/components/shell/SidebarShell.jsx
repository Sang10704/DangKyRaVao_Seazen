import React, { useState } from 'react';
import { ROUTES } from '../../constants/routes';

export default function SidebarShell({
  currentPath,
  onNavigate,
  user,
  onLogout,
  activeVisitorsCount = 0,
  pendingCardPhotoCount = 0,
}) {
  const [copiedLan, setCopiedLan] = useState(false);

  const handleCopyLanUrl = async () => {
    const url = user?.lan_url;
    if (!url) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedLan(true);
      setTimeout(() => setCopiedLan(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };
  const navItems = [
    {
      path: ROUTES.OVERVIEW,
      label: 'Tổng quan',
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
        </svg>
      ),
    },
    {
      path: ROUTES.DOORS,
      label: 'Quản lý Cửa',
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"></path>
          <path d="M3 21h18"></path>
          <circle cx="15" cy="12" r="1"></circle>
        </svg>
      ),
    },
    {
      path: ROUTES.HISTORY,
      label: 'Lịch sử Ra vào',
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="12" cy="12" r="9"></circle>
          <polyline points="12 7 12 12 15.5 14"></polyline>
        </svg>
      ),
    },
    {
      path: ROUTES.VISITORS,
      label: 'Đăng ký Khách',
      badge: activeVisitorsCount > 0 ? activeVisitorsCount : null,
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M19 8v6M22 11h-6"></path>
        </svg>
      ),
    },
    {
      path: ROUTES.CARDS,
      label: 'Quản lý Kho Thẻ',
      badge: pendingCardPhotoCount > 0 ? pendingCardPhotoCount : null,
      badgeAlert: true,
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="2" y="5" width="20" height="14" rx="2.5"></rect>
          <line x1="2" y1="10" x2="22" y2="10"></line>
          <line x1="6" y1="15" x2="10" y2="15"></line>
        </svg>
      ),
    },
    {
      path: ROUTES.HRM,
      label: 'Nhân viên & Phòng ban',
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      ),
    },
    {
      path: ROUTES.BIOMETRICS,
      label: 'Dữ liệu Sinh trắc học',
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4z"></path>
        </svg>
      ),
    },
    {
      path: ROUTES.TIMEKEEPING,
      label: 'Tổng hợp Công ngày',
      svg: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      ),
    },
  ];

  const isAdmin = user?.role === 'admin';
  const visibleNavItems = isAdmin
    ? navItems
    : navItems.filter((item) => item.path === ROUTES.VISITORS);

  return (
    <aside className="tino-sidebar">
      <div>
        <div className="tino-logo-wrap">
          <img
            src="/img/app_icon.png"
            alt="SeaZen Portal"
            style={{
              width: 42,
              height: 42,
              objectFit: 'contain',
              flexShrink: 0,
              filter: 'drop-shadow(0 4px 10px rgba(17, 17, 17, 0.14))',
            }}
          />
          <div>
            <div className="tino-brand-title">SeaZen VMS</div>
            <div className="tino-brand-sub">Kiểm soát Ra vào</div>
          </div>
        </div>

        <nav className="tino-nav-list">
          {visibleNavItems.map((item) => {
            const active = currentPath === item.path;
            return (
              <a
                key={item.path}
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.path);
                }}
                className={`tino-nav-item ${active ? 'active' : ''}`}
              >
                {item.svg}
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className="tino-nav-badge"
                    style={
                      item.badgeAlert
                        ? { background: '#dc2626', color: '#ffffff' }
                        : undefined
                    }
                    title={item.badgeAlert ? `${item.badge} thẻ mới chờ bổ sung ảnh bằng chứng` : undefined}
                  >
                    {item.badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {user?.lan_url && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid var(--border-main)',
              borderRadius: 10,
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                Truy cập máy LAN
              </span>
              <button
                type="button"
                onClick={handleCopyLanUrl}
                title="Sao chép địa chỉ LAN"
                style={{
                  border: '1px solid var(--border-main)',
                  background: copiedLan ? '#f0fdf4' : '#ffffff',
                  color: copiedLan ? '#15803d' : 'var(--text-secondary)',
                  borderRadius: 5,
                  padding: '2px 7px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {copiedLan ? 'Đã chép' : 'Sao chép'}
              </button>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                fontWeight: 700,
                color: '#111111',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}
            >
              {user.lan_url}
            </div>
          </div>
        )}
        <div className="tino-workspace-box">
          <span className="tino-workspace-label">Không gian làm việc</span>
          <div className="tino-workspace-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--jet)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                SZ
              </div>
              <div>
                <div className="tino-workspace-name">SeaZen Security</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {user?.full_name || 'Quản trị viên'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              title="Đăng xuất"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                padding: 4,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
