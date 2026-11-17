import React, { useState, useEffect } from 'react';

const SHOWCASE_SLIDES = [
  {
    headlinePrefix: 'Kiểm soát ra vào & chấm công chuẩn xác cùng',
    headlineBrand: 'SeaZen VMS',
    subtext: 'Kết nối trực tiếp 4 cổng ZKTeco SenseFace 4A (172.16.56.136 – 139), ghi nhận giờ vào đầu – ra cuối theo khung 07:45 – 16:45.',
    cardTitle: 'Cổng ZKTeco 4A',
    cardSub: '4 Thiết bị · TCP 4370',
    cardPill: 'TZ1 = 1',
    cardPercent: '100%',
  },
  {
    headlinePrefix: 'Tiếp đón khách & cấp thẻ NFC tức thì với',
    headlineBrand: 'SeaZen VMS',
    subtext: 'Quét mã QR CCCD, tự động gợi ý từ 670 hồ sơ khách quen và nạp thẻ trực tiếp vào khe phần cứng không qua trung gian.',
    cardTitle: 'Kho Thẻ Khách NFC',
    cardSub: '36 Thẻ vật lý · 20 Khe',
    cardPill: 'Mở tức thì',
    cardPercent: '100%',
  },
  {
    headlinePrefix: 'Đồng bộ SharePoint & xuất bảng công trên',
    headlineBrand: 'SeaZen VMS',
    subtext: 'Tự động đồng bộ 18 danh sách SharePoint Online (ONESEAZEN) qua MSAL Token và kết xuất ma trận công Excel theo phòng ban.',
    cardTitle: 'SharePoint VMS',
    cardSub: '18 Danh sách · SQL',
    cardPill: 'OAuth2',
    cardPercent: '24/7',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="tino-diamond-logo" style={{ width: 34, height: 34, borderRadius: 9 }}>
              <span style={{ fontSize: 13.5 }}>SZ.</span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--jet)', letterSpacing: '-0.02em' }}>
                SeaZen VMS
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                Smart Access & Visitor Control
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
          Phân quyền theo vai trò?{' '}
          <strong style={{ color: '#15803d', fontWeight: 700 }}>
            Lễ tân & Quản trị viên An ninh SeaZen
          </strong>
        </div>
      </div>

      {/* RIGHT HALF: FULL-HEIGHT INSET SHOWCASE CANVAS */}
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
              color: '#3f4a3c',
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
                padding: '4px 12px',
                fontSize: 11.5,
                color: '#111111',
              }}
            >
              LAN Port 6868 · 4/4 Cổng Online
            </span>
          </div>

          {/* Central Editorial Line-Art Illustration + Floating Widgets */}
          <div className="sz-showcase-stage">
            {/* Top-Left Floating Avatar/Biometric Orb */}
            <div
              className="sz-floating-orb"
              style={{
                top: 26,
                left: 34,
                width: 68,
                height: 68,
                background: '#d9f99d',
              }}
              title="Nhận diện khuôn mặt SenseFace 4A"
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2">
                <path d="M4 8V6a2 2 0 0 1 2-2h2" />
                <path d="M4 16v2a2 2 0 0 0 2 2h2" />
                <path d="M16 4h2a2 2 0 0 1 2 2v2" />
                <path d="M16 20h2a2 2 0 0 0 2-2v-2" />
                <circle cx="9" cy="10" r="1" fill="#111111" />
                <circle cx="15" cy="10" r="1" fill="#111111" />
                <path d="M9.5 15a3.5 3.5 0 0 0 5 0" />
              </svg>
            </div>

            {/* Bottom-Right Floating NFC Card Orb */}
            <div
              className="sz-floating-orb"
              style={{
                bottom: 58,
                right: 26,
                width: 64,
                height: 64,
                background: '#fef08a',
              }}
              title="Cấp thẻ khách RFID & Quét QR CCCD"
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
                <line x1="6" y1="15" x2="10" y2="15" />
              </svg>
            </div>

            {/* Central Custom Editorial Line-Art Vector Illustration */}
            <svg
              width="380"
              height="350"
              viewBox="0 0 380 350"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ zIndex: 2 }}
            >
              {/* Soft Decorative Signal Loops (Echoing the editorial line-art loops) */}
              <path
                d="M92 146 C82 104, 118 76, 146 92 C142 62, 188 46, 206 76 C228 52, 268 74, 254 104 C284 98, 298 132, 278 156"
                stroke="#84cc16"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="90" cy="152" r="3.5" fill="#84cc16" />
              <circle cx="282" cy="162" r="3.5" fill="#84cc16" />

              {/* Shadow Base */}
              <ellipse cx="190" cy="312" rx="118" ry="12" fill="#e2e8d8" />

              {/* Left & Right Turnstile Wings */}
              <path
                d="M78 210 L132 192 L132 276 L78 292 Z"
                fill="#ffffff"
                stroke="#111111"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <path
                d="M302 210 L248 192 L248 276 L302 292 Z"
                fill="#ffffff"
                stroke="#111111"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />

              {/* Turnstile Wing Accent Bars */}
              <line x1="94" y1="232" x2="120" y2="224" stroke="#84cc16" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="94" y1="252" x2="120" y2="244" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="286" y1="232" x2="260" y2="224" stroke="#84cc16" strokeWidth="3.5" strokeLinecap="round" />
              <line x1="286" y1="252" x2="260" y2="244" stroke="#111111" strokeWidth="2.5" strokeLinecap="round" />

              {/* Central Smart Pedestal Pillar */}
              <rect
                x="132"
                y="138"
                width="116"
                height="168"
                rx="22"
                fill="#ffffff"
                stroke="#111111"
                strokeWidth="2.8"
              />

              {/* Upper Sage-Green Shield Header on Pedestal */}
              <path
                d="M134 160 C134 146, 144 140, 156 140 L224 140 C236 140, 246 146, 246 160 L246 218 L134 218 Z"
                fill="#a3e635"
                stroke="#111111"
                strokeWidth="2.5"
              />

              {/* SeaZen Emblem Shield in Center of Pedestal */}
              <path
                d="M190 156 L214 166 L214 188 C214 202, 190 210, 190 210 C190 210, 166 202, 166 188 L166 166 Z"
                fill="#ffffff"
                stroke="#111111"
                strokeWidth="2.4"
                strokeLinejoin="round"
              />
              <path
                d="M182 183 L188 189 L200 175"
                stroke="#111111"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* ZKTeco SenseFace 4A Terminal Head Mounted on Top */}
              <rect
                x="154"
                y="68"
                width="72"
                height="86"
                rx="14"
                fill="#111111"
                stroke="#111111"
                strokeWidth="2.5"
              />
              <rect
                x="161"
                y="76"
                width="58"
                height="62"
                rx="9"
                fill="#ffffff"
              />
              {/* Dual Biometric Lenses */}
              <circle cx="182" cy="86" r="3" fill="#111111" />
              <circle cx="198" cy="86" r="3" fill="#111111" />
              {/* Face Scan Frame on Screen */}
              <path d="M174 98 L174 94 L178 94" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
              <path d="M206 98 L206 94 L202 94" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
              <path d="M174 122 L174 126 L178 126" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
              <path d="M206 122 L206 126 L202 126" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
              <circle cx="190" cy="107" r="6" fill="#f5b82e" stroke="#111111" strokeWidth="2" />
              <path d="M180 123 C182 117, 198 117, 200 123" stroke="#111111" strokeWidth="2" strokeLinecap="round" />

              {/* NFC Reader Pad on Lower Pedestal */}
              <rect
                x="156"
                y="236"
                width="68"
                height="48"
                rx="10"
                fill="#f8fafc"
                stroke="#111111"
                strokeWidth="2.2"
              />
              {/* RFID Wave Icon */}
              <path d="M182 260 C186 254, 194 254, 198 260" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
              <path d="M177 255 C184 246, 196 246, 203 255" stroke="#84cc16" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="190" cy="265" r="2.5" fill="#111111" />
            </svg>

            {/* Bottom-Left Floating Card (Matches the "Canva Design / 84%" card in reference) */}
            <div className="sz-floating-widget sz-floating-widget-left">
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--jet)', letterSpacing: '-0.02em' }}>
                {activeSlide.cardTitle}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 500 }}>
                {activeSlide.cardSub}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 14,
                }}
              >
                <span
                  style={{
                    border: '1.5px solid #111111',
                    borderRadius: 999,
                    padding: '4px 12px',
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: '#111111',
                    background: '#ffffff',
                  }}
                >
                  {activeSlide.cardPill}
                </span>

                {/* Circular Progress Ring */}
                <div style={{ position: 'relative', width: 42, height: 42 }}>
                  <svg width="42" height="42" viewBox="0 0 42 42">
                    <circle
                      cx="21"
                      cy="21"
                      r="17"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="4"
                    />
                    <circle
                      cx="21"
                      cy="21"
                      r="17"
                      fill="none"
                      stroke="#84cc16"
                      strokeWidth="4"
                      strokeDasharray="106.8"
                      strokeDashoffset="14"
                      strokeLinecap="round"
                      transform="rotate(-90 21 21)"
                    />
                  </svg>
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 800,
                      color: '#111111',
                    }}
                  >
                    {activeSlide.cardPercent}
                  </span>
                </div>
              </div>
            </div>

            {/* Top-Right Floating Status Card */}
            <div className="sz-floating-widget sz-floating-widget-right">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
                  SHAREPOINT VMS
                </span>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#16a34a',
                  }}
                />
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--jet)', marginTop: 4 }}>
                18 Danh sách & Kho Thẻ
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                Đồng bộ tự động · Ca 07:45 – 16:45
              </div>
            </div>
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
