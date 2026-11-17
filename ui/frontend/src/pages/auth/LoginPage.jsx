import React, { useState } from 'react';

export default function LoginPage({ onLoginSuccess, clockAudit }) {
  const [credential, setCredential] = useState('');
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

  const pcClockValid = clockAudit?.pc_clock_valid !== false;

  return (
    <div id="loginView">
      <div className="tino-login-card">
        <div className="tino-login-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                background: 'var(--gold)',
                color: 'var(--jet)',
                borderRadius: 10,
                transform: 'rotate(45deg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
              }}
            >
              <span style={{ transform: 'rotate(-45deg)' }}>SZ.</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>SeaZen Security</span>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              HỆ THỐNG KIỂM SOÁT RA VÀO
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 8, lineHeight: 1.25 }}>
              Quản lý Cổng, Sinh trắc học & Tiếp đón Khách
            </h1>
            <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 12, lineHeight: 1.6 }}>
              Điều khiển đóng mở trực tiếp 4 máy nhận diện khuôn mặt, tổng hợp công chuẩn 07:45 - 16:45, đồng bộ SharePoint Online và cấp thẻ khách qua mã QR căn cước.
            </p>
          </div>

          <div style={{ fontSize: 11.5, color: '#9ca3af' }}>
            Giờ chuẩn Việt Nam: <strong style={{ color: '#fff' }}>{clockAudit?.vietnam_ntp_time || 'Đang đồng bộ...'}</strong>
          </div>
        </div>

        <div className="tino-login-right">
          <div style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 500 }}>Xin chào!</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--jet)', marginBottom: 16 }}>
            Đăng nhập vào hệ thống
          </h2>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-subtle)',
              padding: '10px 14px',
              borderRadius: 10,
              marginBottom: 18,
              fontSize: 12.5,
            }}
          >
            <span>Trạng thái đồng hồ thiết bị:</span>
            <span className={`badge ${pcClockValid ? 'badge-green' : 'badge-red'}`}>
              {pcClockValid ? 'Chuẩn giờ Việt Nam' : `Lệch ${clockAudit?.pc_drift_sec}s`}
            </span>
          </div>

          {errorMsg && (
            <div
              style={{
                background: 'var(--red-soft)',
                color: 'var(--red)',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 14,
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
            <div className="v-field">
              <label>Tài khoản vận hành</label>
              <input
                type="text"
                className="v-input"
                style={{ height: 40, borderRadius: 10 }}
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                placeholder="Nhập tên tài khoản..."
                required
              />
            </div>

            <div className="v-field">
              <label>Mật khẩu</label>
              <input
                type="password"
                className="v-input"
                style={{ height: 40, borderRadius: 10 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ height: 42, borderRadius: 12, marginTop: 4 }}
            >
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập ngay'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
