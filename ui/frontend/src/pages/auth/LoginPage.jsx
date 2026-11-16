import React, { useState } from 'react';

export default function LoginPage({ onLoginSuccess, clockAudit }) {
  const [credential, setCredential] = useState('admin');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const performLogin = async (credVal, pwdVal) => {
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: credVal, password: pwdVal }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        onLoginSuccess(data.user);
      } else {
        setErrorMsg(data.error || 'Tài khoản hoặc mật khẩu không chính xác.');
      }
    } catch (_) {
      setErrorMsg('Không thể kết nối máy chủ hệ thống. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    performLogin(credential, password);
  };

  const pcClockValid = clockAudit?.pc_clock_valid !== false;

  return (
    <div id="loginView">
      <div className="login-card">
        {/* Left Column: SeaZen Portal Corporate Gradient & Wave SVG */}
        <div className="login-left">
          <svg
            className="login-wave-svg"
            viewBox="0 0 100 800"
            preserveAspectRatio="none"
            fill="#ffffff"
          >
            <path d="M100,0 L100,800 L20,800 C75,600 -10,420 55,220 C85,110 35,40 100,0 Z" />
          </svg>

          <div className="login-welcome-label">CỔNG QUẢN TRỊ AN NINH NỘI BỘ</div>

          <div>
            <div className="login-logo-box">
              <img src="/images/app_icon.png" alt="SeaZen Logo" />
            </div>
            <div className="login-brand-title">SEAZEN PORTAL</div>
            <div className="login-brand-desc">
              Hệ thống Điều hành Kiểm soát Ra vào, Quản lý Danh bạ Nhận diện Khuôn mặt và Tiếp đón Khách chuyên nghiệp của Công ty Cổ phần Dịch vụ Bảo vệ SeaZen.
            </div>
          </div>

          <div className="login-left-footer">
            <span>SEAZEN SECURITY SERVICES</span>
            <span>·</span>
            <span>PHIÊN BẢN 2.5</span>
          </div>
        </div>

        {/* Right Column: Login Form */}
        <div className="login-right">
          <h2>Đăng nhập hệ thống</h2>
          <p className="login-subtitle">
            Sử dụng tài khoản cán bộ quản trị hoặc nhân viên lễ tân được cấp quyền để tiếp tục.
          </p>

          {/* Vietnam Standard Time Status Bar */}
          <div className="ms-status-bar">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span className={`ms-dot ${pcClockValid ? 'online' : ''}`}></span>
              <span>
                Giờ chuẩn Việt Nam:{' '}
                <strong style={{ fontFamily: 'var(--font-mono)' }}>
                  {clockAudit?.vietnam_ntp_time || 'Đang đồng bộ...'}
                </strong>
              </span>
            </div>
            <span className={`badge ${pcClockValid ? 'badge-green' : 'badge-red'}`}>
              {pcClockValid ? 'Đồng hồ chuẩn' : `Lệch ${clockAudit?.pc_drift_sec}s`}
            </span>
          </div>

          {errorMsg && (
            <div className="login-error-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="underline-group">
              <label>Tài khoản hoặc Email công ty</label>
              <div className="underline-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <input
                  type="text"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder="Nhập tên tài khoản (ví dụ: admin hoặc nhanvien)"
                  required
                />
              </div>
            </div>

            <div className="underline-group">
              <label>Mật khẩu xác thực</label>
              <div className="underline-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu..."
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ height: 38, width: '100%' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                  <polyline points="10 17 15 12 10 7"></polyline>
                  <line x1="15" y1="12" x2="3" y2="12"></line>
                </svg>
                <span>{loading ? 'Đang kết nối tài khoản...' : 'Đăng nhập hệ thống'}</span>
              </button>
            </div>
          </form>

          <div
            style={{
              marginTop: 22,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}
          >
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              Đăng nhập nhanh theo vai trò vận hành:
            </div>
            <div className="form-grid-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setCredential('admin');
                  setPassword('Admin@123');
                  performLogin('admin', 'Admin@123');
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
                <span>Quản trị viên (admin)</span>
              </button>

              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setCredential('nhanvien');
                  setPassword('Nhanvien@123');
                  performLogin('nhanvien', 'Nhanvien@123');
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                </svg>
                <span>Bàn Lễ tân (nhanvien)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
