import React, { useState } from 'react';

export default function AccessLinksPage({ user, notify }) {
  const [copiedKey, setCopiedKey] = useState('');

  const basePcUrl = (user?.lan_url || window.location.origin).replace(/\/+$/, '');
  const baseIpUrl = (user?.lan_ip_url || '').replace(/\/+$/, '');

  const endpoints = [
    {
      key: 'main',
      title: 'Cổng Quản trị (Chính)',
      role: 'Admin / Ban Giám đốc',
      url: basePcUrl,
      ipUrl: baseIpUrl || '',
      desc: 'Truy cập toàn bộ phân hệ: Tổng quan, Nhân viên tại chỗ, Cửa, Kho thẻ, Chấm công.',
    },
    {
      key: 'visitors',
      title: 'Máy Lễ tân (Đăng ký & Cấp thẻ Khách)',
      role: 'Tài khoản Lễ tân',
      url: `${basePcUrl}/visitors`,
      ipUrl: baseIpUrl ? `${baseIpUrl}/visitors` : '',
      desc: 'Dành cho quầy Lễ tân: Quét QR CCCD, cấp thẻ NFC, quẹt cấp thẻ khách hẹn trước và trả thẻ.',
    },
    {
      key: 'appointments',
      title: 'Các Phòng ban (Khách mời & Lịch hẹn)',
      role: 'Tài khoản phòng ban (Khach)',
      url: `${basePcUrl}/appointments`,
      ipUrl: baseIpUrl ? `${baseIpUrl}/appointments` : '',
      desc: 'Dành cho nhân viên các phòng ban đăng ký khách hẹn trước để Lễ tân cấp thẻ nhanh khi khách đến.',
    },
  ];

  const handleCopy = async (text, key) => {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedKey(key);
      notify?.(`Đã sao chép: ${text}`, 'success');
      setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      notify?.('Không thể sao chép vào clipboard.', 'error');
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '18px 22px 28px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ marginBottom: 18 }}>
          <div className="tino-greeting-sub" style={{ fontSize: 12.5 }}>
            Đường dẫn truy cập cố định theo Tên máy chủ LAN (tự động cập nhật theo máy đang chạy server)
          </div>
          <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
            Quản lý truy cập
          </h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {endpoints.map((ep) => {
            const isCopiedPc = copiedKey === `${ep.key}_pc`;
            const isCopiedIp = copiedKey === `${ep.key}_ip`;
            return (
              <div key={ep.key} className="card" style={{ padding: 18 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: '#0f172a' }}>
                        {ep.title}
                      </h3>
                      <span className="badge badge-info">{ep.role}</span>
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#64748b' }}>{ep.desc}</p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${isCopiedPc ? 'btn-primary' : ''}`}
                      onClick={() => handleCopy(ep.url, `${ep.key}_pc`)}
                    >
                      {isCopiedPc ? 'Đã sao chép' : 'Sao chép link Tên PC'}
                    </button>
                    <a
                      href={ep.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-primary btn-sm"
                      style={{ textDecoration: 'none' }}
                    >
                      Mở trang
                    </a>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#475569' }}>
                      Đường dẫn chuẩn (Tên PC — khuyến nghị):
                    </span>
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#0f172a',
                        userSelect: 'all',
                      }}
                    >
                      {ep.url}
                    </code>
                  </div>

                  {ep.ipUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderTop: '1px dashed #e2e8f0', paddingTop: 6 }}>
                      <span style={{ fontSize: 11.5, color: '#64748b' }}>
                        Đường dẫn IP dự phòng (LAN hiện tại):
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            color: '#475569',
                            userSelect: 'all',
                          }}
                        >
                          {ep.ipUrl}
                        </code>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ padding: '2px 8px', fontSize: 11 }}
                          onClick={() => handleCopy(ep.ipUrl, `${ep.key}_ip`)}
                        >
                          {isCopiedIp ? 'Đã chép' : 'Chép IP'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
