import React, { useState } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function ClockSafetyModal({ open, onClose, clockAudit, onSynced, notify }) {
  const [step1Confirmed, setStep1Confirmed] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [syncing, setSyncing] = useState(false);

  if (!open) return null;

  const pcClockInvalid = clockAudit && clockAudit.pc_clock_valid === false;

  const handleConfirmSync = async () => {
    if (!step1Confirmed || confirmCode !== 'CONFIRM_VN_NTP_SYNC') {
      notify('Vui lòng hoàn tất đủ 2 bước xác nhận trước khi đồng bộ giờ chuẩn.', 'error');
      return;
    }
    setSyncing(true);
    try {
      const { ok, data } = await apiFetch('/api/clock/sync_ntp', {
        method: 'POST',
        body: JSON.stringify({
          confirm_layer1: step1Confirmed,
          confirm_code: confirmCode,
        }),
      });
      if (ok && data.success) {
        notify('Đã đồng bộ Giờ chuẩn Việt Nam xuống 4 thiết bị cổng thành công.', 'success');
        setStep1Confirmed(false);
        setConfirmCode('');
        onSynced(data.audit);
        onClose();
      } else {
        notify(data.error || 'Không thể thực hiện đồng bộ giờ.', 'error');
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>
              Đối Soát & Bảo Vệ Đồng Hồ Thiết Bị Theo Giờ Chuẩn Việt Nam
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Chống trôi giờ chấm công khi đồng hồ trên máy tính mở ứng dụng bị sai lệch
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Đóng
          </button>
        </div>

        <div className="modal-body">
          <div
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 12.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Giờ chuẩn Quốc gia Việt Nam (UTC+7):</span>
              <strong style={{ color: 'var(--green-text)', fontFamily: 'var(--font-mono)' }}>
                {clockAudit?.vietnam_ntp_time || '--'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Giờ trên thiết bị đang mở ứng dụng:</span>
              <strong
                style={{
                  color: pcClockInvalid ? 'var(--red-text)' : 'var(--text-main)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {clockAudit?.local_pc_time || '--'} (Độ lệch: {clockAudit?.pc_drift_sec ?? 0} giây)
              </strong>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--border)',
                paddingTop: 8,
                marginTop: 4,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>
                Trạng thái đồng hồ trên 4 thiết bị nhận diện tại cổng:
              </div>
              {Object.entries(clockAudit?.devices || {}).map(([name, info]) => (
                <div
                  key={name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '3px 0',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                >
                  <span>{name} ({info.ip})</span>
                  <span>
                    {info.device_time || info.status} ({info.drift_vs_vn_sec ?? 0} giây)
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: 'var(--amber-soft)',
              border: '1px solid #fde68a',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--amber-text)' }}>
              XÁC NHẬN AN TOÀN 2 BƯỚC TRƯỚC KHI CẬP NHẬT GIỜ THIẾT BỊ:
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={step1Confirmed}
                onChange={(e) => setStep1Confirmed(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Bước xác nhận 1:</strong> Tôi xác nhận chỉ sử dụng{' '}
                <strong>Giờ chuẩn Quốc gia Việt Nam ({clockAudit?.vietnam_ntp_time})</strong> để cập nhật xuống 4 thiết bị cổng, không lấy theo giờ của máy tính cá nhân.
              </span>
            </label>

            <div className="field-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>
                  <strong>Bước xác nhận 2:</strong> Nhập mã xác thực đồng bộ (CONFIRM_VN_NTP_SYNC)
                </label>
                <button
                  type="button"
                  onClick={() => setConfirmCode('CONFIRM_VN_NTP_SYNC')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Điền mã xác nhận
                </button>
              </div>
              <input
                type="text"
                className="form-control"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="Nhập CONFIRM_VN_NTP_SYNC"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Hủy thao tác
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncing || !step1Confirmed || confirmCode !== 'CONFIRM_VN_NTP_SYNC'}
            onClick={handleConfirmSync}
          >
            {syncing ? 'Đang cập nhật giờ chuẩn...' : 'Đồng bộ Giờ chuẩn Việt Nam'}
          </button>
        </div>
      </div>
    </div>
  );
}
