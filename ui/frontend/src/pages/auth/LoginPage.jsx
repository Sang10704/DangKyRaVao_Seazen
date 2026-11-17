import React, { useState, useEffect } from 'react';

const SHOWCASE_SLIDES = [
  {
    headlinePrefix: 'Kiểm soát ra vào & chấm công chuẩn xác cùng',
    headlineBrand: 'SeaZen VMS',
    subtext:
      'Kết nối trực tiếp 4 cổng ZKTeco SenseFace 4A (172.16.56.136 – 139), ghi nhận giờ vào đầu – ra cuối theo khung 07:45 – 16:45.',
  },
  {
    headlinePrefix: 'Tiếp đón khách & cấp thẻ NFC tức thì với',
    headlineBrand: 'SeaZen VMS',
    subtext:
      'Quét mã QR CCCD, tự động gợi ý từ 670 hồ sơ khách quen và nạp thẻ trực tiếp vào khe phần cứng với chuẩn TZ1 = 1.',
  },
  {
    headlinePrefix: 'Đồng bộ SharePoint & xuất bảng công trên',
    headlineBrand: 'SeaZen VMS',
    subtext:
      'Tự động đồng bộ 18 danh sách SharePoint Online (ONESEAZEN) qua MSAL Token và kết xuất ma trận công Excel theo phòng ban.',
  },
];

export default function LoginPage({ onLoginSuccess, clockAudit }) {
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % SHOWCASE_SLIDES.length);
    }, 4800);
    return () => clearInterval(timer);
  }, []);

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

  const pcClockValid = clockAudit?.pc_clock_valid !== false;
  const activeSlide = SHOWCASE_SLIDES[slideIdx];

  return (
    <div id="loginView">
      {/* LEFT HALF: CLEAN EDITORIAL LOGIN WORKSPACE */}
      <div className="sz-login-form-pane">
        {/* Top Brand & NTP Status Bar */}
        <div className="sz-login-brand-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <img
              src="/img/app_icon.png"
              alt="SeaZen Portal"
              style={{
                width: 40,
                height: 40,
                objectFit: 'contain',
                filter: 'drop-shadow(0 4px 10px rgba(17, 17, 17, 0.15))',
              }}
            />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--jet)', letterSpacing: '-0.02em' }}>
                SeaZen Portal
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                Hệ thống Kiểm soát Ra vào & An ninh
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 12px',
              borderRadius: 999,
              background: pcClockValid ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${pcClockValid ? '#bbf7d0' : '#fecaca'}`,
              fontSize: 11.5,
              fontWeight: 600,
              color: pcClockValid ? '#15803d' : '#dc2626',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: pcClockValid ? '#16a34a' : '#dc2626',
              }}
            />
            <span>{clockAudit?.vietnam_ntp_time || 'Giờ chuẩn VN'}</span>
          </div>
        </div>

        {/* Center Login Form */}
        <div className="sz-login-form-center">
          <div className="sz-login-heading">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <img
                src="/img/app_icon.png"
                alt="SeaZen Shield"
                style={{
                  width: 68,
                  height: 68,
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 8px 18px rgba(17, 17, 17, 0.16))',
                }}
              />
            </div>
            <h1>Chào mừng trở lại!</h1>
            <p>
              Vận hành cổng kiểm soát sinh trắc học, đăng ký thẻ khách ra vào và tổng hợp công nhân sự cùng{' '}
              <strong style={{ color: 'var(--jet)' }}>SeaZen VMS</strong>.
            </p>
          </div>

          {errorMsg && (
            <div
              style={{
                background: 'var(--red-soft)',
                border: '1px solid #fecaca',
                color: 'var(--red)',
                padding: '11px 16px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 18,
                textAlign: 'center',
              }}
            >
              {errorMsg}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              performLogin(credential, password);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div className="sz-pill-input-wrap">
              <input
                type="text"
                className="sz-pill-input"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder="Tài khoản vận hành hoặc Email"
                autoComplete="username"
                required
              />
            </div>

            <div className="sz-pill-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="sz-pill-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mật khẩu"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="sz-pill-eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 8px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                Ca chuẩn: 07:45 – 16:45
              </span>
              <span>
                {pcClockValid ? 'Đồng hồ máy chủ hợp lệ' : `Lệch giờ ${clockAudit?.pc_drift_sec}s`}
              </span>
            </div>

            <button
              type="submit"
              className="sz-pill-submit-btn"
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              {loading ? 'Đang xác thực...' : 'Đăng nhập'}
            </button>
          </form>

          <div className="sz-login-divider">hạ tầng kết nối trực tiếp</div>

          {/* 3 Architectural Pillars (ZKTeco TCP, SQL Server, SharePoint Online) */}
          <div className="sz-infra-circles">
            <div className="sz-infra-circle" title="4 Cổng ZKTeco SenseFace 4A (TCP 4370 · 172.16.56.136–139)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="10" r="1.5" />
                <circle cx="15" cy="10" r="1.5" />
                <path d="M9 15c1.5 1.2 4.5 1.2 6 0" />
              </svg>
              <span className="sz-infra-dot" />
            </div>

            <div className="sz-infra-circle" title="Microsoft SQL Server (SeaZen_AccessControl · 18 Bảng)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <ellipse cx="12" cy="5" rx="8" ry="3" />
                <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
                <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
              </svg>
              <span className="sz-infra-dot" />
            </div>

            <div className="sz-infra-circle" title="Microsoft SharePoint Online (ONESEAZEN · 18 Danh sách VMS)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
              <span className="sz-infra-dot" />
            </div>
          </div>
        </div>

        {/* Bottom Footer */}
        <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>
          Phân quyền theo vai trò:{' '}
          <strong style={{ color: 'var(--jet)', fontWeight: 700 }}>
            Lễ tân & Quản trị viên An ninh SeaZen
          </strong>
        </div>
      </div>

      {/* RIGHT HALF: FULL-HEIGHT INSET SHOWCASE CANVAS WITH CLEAN HERO ARTWORK */}
      <div className="sz-login-showcase-wrap">
        <div className="sz-login-showcase-canvas">
          {/* Top Subtle Pill Badge inside Showcase */}
          <div
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 700,
              color: '#524e42',
            }}
          >
            <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              SEAZEN SECURITY · ACCESS CONTROL HUB
            </span>
            <span
              style={{
                background: '#ffffff',
                border: '1.5px solid #111111',
                borderRadius: 999,
                padding: '4px 13px',
                fontSize: 11.5,
                color: '#111111',
              }}
            >
              LAN Port 6868 · 4/4 Cổng Online
            </span>
          </div>

          {/* Central Hero Illustration (Cleaned, Symmetrical, No Wall Logo) */}
          <div className="sz-showcase-stage">
            <img
              src="/img/login_hero_illustration.jpg"
              alt="SeaZen Smart Access Control Gate"
              className="sz-showcase-hero-img"
            />
          </div>

          {/* Bottom Interactive Carousel Dots & Headline */}
          <div style={{ textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
            <div className="sz-carousel-dots">
              {SHOWCASE_SLIDES.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`sz-carousel-dot ${idx === slideIdx ? 'active' : ''}`}
                  onClick={() => setSlideIdx(idx)}
                  aria-label={`Slide ${idx + 1}`}
                />
              ))}
            </div>

            <h2
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: 'var(--jet)',
                lineHeight: 1.35,
                letterSpacing: '-0.02em',
              }}
            >
              {activeSlide.headlinePrefix}{' '}
              <strong style={{ fontWeight: 800 }}>{activeSlide.headlineBrand}</strong>
            </h2>
            <p
              style={{
                fontSize: 12.5,
                color: 'var(--text-secondary)',
                marginTop: 8,
                lineHeight: 1.55,
              }}
            >
              {activeSlide.subtext}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
