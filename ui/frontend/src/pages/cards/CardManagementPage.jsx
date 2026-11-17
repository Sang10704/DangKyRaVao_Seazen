import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../../services/apiClient';

function compressImageToDataUrl(fileOrBlob, maxDim = 1080, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh'));
    reader.onload = () => {
      const rawUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => resolve(rawUrl);
      img.onload = () => {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          resolve(rawUrl);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.round(w * scale);
        const ch = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(fileOrBlob);
  });
}

export default function CardManagementPage({
  customerCards = [],
  activeVisitors = [],
  user = null,
  onRefreshData,
  notify,
}) {
  const [cards, setCards] = useState(customerCards);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [selectedNumbers, setSelectedNumbers] = useState([]);

  // Quick evidence upload modal & lightbox state
  const [evidenceModalCard, setEvidenceModalCard] = useState(null);
  const [evidencePhoto, setEvidencePhoto] = useState('');
  const [evidenceCode, setEvidenceCode] = useState('');
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [previewLightbox, setPreviewLightbox] = useState(null);

  const formFileRef = useRef(null);
  const modalFileRef = useRef(null);

  const [formData, setFormData] = useState({
    CardID: null,
    CardCode: '',
    CardNumber: '',
    CardType: 'VISITOR',
    Status: 'AVAILABLE',
    Notes: '',
    CardPhotoBase64: '',
  });

  useEffect(() => {
    setCards(customerCards);
  }, [customerCards]);

  const loadCards = useCallback(async () => {
    const { ok, data } = await apiFetch('/api/visitor/cards?include_photos=1');
    if (ok && data?.rows) {
      setCards(data.rows);
    }
    if (onRefreshData) onRefreshData();
  }, [onRefreshData]);

  useEffect(() => {
    loadCards();
  }, []);

  const activeCardHolderMap = useMemo(() => {
    const map = {};
    for (const v of activeVisitors) {
      if (v.card_number) {
        const clean = String(v.card_number).trim();
        map[clean] = v;
        if (/^\d+$/.test(clean)) {
          map[clean.replace(/^0+/, '') || '0'] = v;
        }
      }
    }
    return map;
  }, [activeVisitors]);

  const isPendingPhoto = useCallback((c) => {
    return !c?.HasPhoto || c?.EvidenceStatus === 'PENDING_PHOTO';
  }, []);

  const pendingPhotoCount = useMemo(
    () => cards.filter((c) => isPendingPhoto(c)).length,
    [cards, isPendingPhoto]
  );

  const lostCount = useMemo(
    () => cards.filter((c) => ['LOST', 'LOCKED'].includes(String(c.Status || '').toUpperCase())).length,
    [cards]
  );

  // Support Ctrl+V image paste directly when Evidence Modal is open
  useEffect(() => {
    if (!evidenceModalCard) return undefined;
    const onPaste = async (e) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            const compressed = await compressImageToDataUrl(blob);
            setEvidencePhoto(compressed);
            if (notify) notify('Đã dán ảnh chụp thẻ từ Clipboard.', 'info');
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [evidenceModalCard, notify]);

  const resetForm = () => {
    setFormData({
      CardID: null,
      CardCode: '',
      CardNumber: '',
      CardType: 'VISITOR',
      Status: 'AVAILABLE',
      Notes: '',
      CardPhotoBase64: '',
    });
    if (formFileRef.current) formFileRef.current.value = '';
  };

  const handleFormFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file);
      setFormData((prev) => ({ ...prev, CardPhotoBase64: compressed }));
    } catch (err) {
      if (notify) notify(err.message || 'Không thể xử lý ảnh.', 'error');
    }
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    const num = String(formData.CardNumber || '').trim();
    if (!num) {
      if (notify) notify('Vui lòng nhập hoặc quẹt Số thẻ từ RFID/NFC.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...formData,
        CardNumber: num,
        CardCode: String(formData.CardCode || '').trim() || `THE-KHACH-${num}`,
      };
      const { ok, data } = await apiFetch('/api/visitor/card', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (ok && data?.success) {
        if (notify) notify(data.message || 'Đã lưu thẻ vào CSDL Kho thẻ.', 'success');
        resetForm();
        await loadCards();
      } else {
        if (notify) notify(data?.error || 'Không thể lưu thẻ.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEditSelect = (card) => {
    setFormData({
      CardID: card.CardID || null,
      CardCode: card.CardCode || '',
      CardNumber: card.CardNumber || '',
      CardType: card.CardType || 'VISITOR',
      Status: card.Status || 'AVAILABLE',
      Notes: card.Notes || '',
      CardPhotoBase64: card.CardPhotoBase64 || '',
    });
  };

  const openEvidenceModal = (card) => {
    setEvidenceModalCard(card);
    setEvidencePhoto(card.CardPhotoBase64 || '');
    setEvidenceCode(card.CardCode || `THE-KHACH-${card.CardNumber}`);
    setEvidenceNotes(card.Notes || '');
    if (modalFileRef.current) modalFileRef.current.value = '';
  };

  const handleModalFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file);
      setEvidencePhoto(compressed);
    } catch (err) {
      if (notify) notify(err.message || 'Không thể đọc tệp ảnh.', 'error');
    }
  };

  const handleSubmitEvidence = async (e) => {
    e.preventDefault();
    if (!evidenceModalCard) return;
    if (!evidencePhoto || evidencePhoto.length < 25) {
      if (notify) notify('Vui lòng chọn tệp hoặc dán ảnh (Ctrl+V) mặt thẻ thực tế.', 'error');
      return;
    }
    setUploadingEvidence(true);
    try {
      const { ok, data } = await apiFetch('/api/visitor/card/upload_evidence', {
        method: 'POST',
        body: JSON.stringify({
          CardID: evidenceModalCard.CardID,
          CardNumber: evidenceModalCard.CardNumber,
          CardCode: evidenceCode.trim(),
          Notes: evidenceNotes.trim(),
          CardPhotoBase64: evidencePhoto,
        }),
      });
      if (ok && data?.success) {
        if (notify) notify(data.message || 'Đã lưu ảnh bằng chứng & đồng bộ SharePoint.', 'success');
        setEvidenceModalCard(null);
        await loadCards();
      } else {
        if (notify) notify(data?.error || 'Không thể lưu ảnh bằng chứng.', 'error');
      }
    } finally {
      setUploadingEvidence(false);
    }
  };

  const handleToggleLostStatus = async (card) => {
    const curStatus = String(card.Status || 'AVAILABLE').toUpperCase();
    const nextStatus = curStatus === 'LOST' ? 'AVAILABLE' : 'LOST';
    const msg =
      nextStatus === 'LOST'
        ? `Xác nhận đánh dấu MẤT THẺ ${card.CardNumber} (${card.CardCode})? Hệ thống sẽ khóa thẻ và thu hồi quyền mở cửa trên 4 máy ZKTeco.`
        : `Xác nhận tìm lại được thẻ ${card.CardNumber} và khôi phục về trạng thái Sẵn sàng cấp?`;
    if (!window.confirm(msg)) return;

    const { ok, data } = await apiFetch('/api/visitor/card', {
      method: 'POST',
      body: JSON.stringify({
        CardID: card.CardID,
        CardCode: card.CardCode,
        CardNumber: card.CardNumber,
        CardType: card.CardType || 'VISITOR',
        Status: nextStatus,
        Notes:
          nextStatus === 'LOST'
            ? `${card.Notes ? `${card.Notes} · ` : ''}Báo mất lúc ${new Date().toLocaleString('vi-VN')}`
            : card.Notes || '',
      }),
    });
    if (ok && data?.success) {
      if (notify) {
        notify(
          nextStatus === 'LOST'
            ? `Đã khóa thẻ ${card.CardNumber} và thu hồi quyền mở cổng trên 4 thiết bị.`
            : `Đã khôi phục thẻ ${card.CardNumber} về trạng thái Sẵn sàng.`,
          'success'
        );
      }
      await loadCards();
    } else {
      if (notify) notify(data?.error || 'Không thể cập nhật trạng thái thẻ.', 'error');
    }
  };

  const handleDeleteCard = async (card) => {
    const holder = activeCardHolderMap[String(card.CardNumber || '').trim()];
    if (holder) {
      if (notify) {
        notify(
          `Thẻ ${card.CardNumber} đang được khách "${holder.full_name}" giữ. Vui lòng check-out trả thẻ trước khi xóa.`,
          'error'
        );
      }
      return;
    }
    const confirmMsg = `Xóa thẻ "${card.CardCode || card.CardNumber}" (RFID: ${card.CardNumber}) khỏi SQL Server & SharePoint (không xóa cấu hình máy cửa)?`;
    if (!window.confirm(confirmMsg)) return;

    const { ok, data } = await apiFetch('/api/visitor/card/delete', {
      method: 'POST',
      body: JSON.stringify({
        CardID: card.CardID,
        CardNumber: card.CardNumber,
        skip_hardware: true,
      }),
    });

    if (ok && data?.success) {
      if (notify) notify(data.message || `Đã xóa thẻ ${card.CardNumber}.`, 'success');
      setSelectedNumbers((prev) => prev.filter((n) => n !== card.CardNumber));
      if (formData.CardNumber === card.CardNumber) resetForm();
      await loadCards();
    } else {
      if (notify) notify(data?.error || 'Không thể xóa thẻ.', 'error');
    }
  };

  const handleBulkClear = async (clearAll = false) => {
    if (clearAll) {
      if (
        !window.confirm(
          `Xác nhận XÓA SẠCH toàn bộ ${cards.length} thẻ hiện có trong SQL Server & SharePoint 'VMS SEAZEN - KHO THẺ KHÁCH' để thu thập lại từ đầu?\n(Thao tác này không làm gián đoạn 4 máy ZKTeco và tự chừa lại thẻ nếu đang có khách giữ.)`
        )
      ) {
        return;
      }
    } else if (selectedNumbers.length === 0) {
      return;
    } else if (
      !window.confirm(`Xác nhận xóa ${selectedNumbers.length} thẻ đã chọn khỏi SQL Server & SharePoint?`)
    ) {
      return;
    }

    const { ok, data } = await apiFetch('/api/visitor/cards/clear', {
      method: 'POST',
      body: JSON.stringify({
        clear_all: clearAll,
        card_numbers: clearAll ? [] : selectedNumbers,
      }),
    });
    if (ok && data?.success) {
      if (notify) notify(data.message || 'Đã dọn sạch Kho thẻ SQL & SharePoint.', 'success');
      setSelectedNumbers([]);
      resetForm();
      await loadCards();
    } else {
      if (notify) notify(data?.error || 'Không thể xóa hàng loạt.', 'error');
    }
  };

  const filteredCards = useMemo(() => {
    return (cards || []).filter((c) => {
      const cleanNum = String(c.CardNumber || '').trim();
      const holder =
        activeCardHolderMap[cleanNum] ||
        (/^\d+$/.test(cleanNum) ? activeCardHolderMap[cleanNum.replace(/^0+/, '') || '0'] : null);
      const curStatus = String(c.Status || 'AVAILABLE').toUpperCase();
      const effectiveStatus = holder ? 'IN_USE' : curStatus;

      if (statusFilter === 'PENDING_PHOTO') {
        if (!isPendingPhoto(c)) return false;
      } else if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${c.CardCode || ''} ${c.CardNumber || ''} ${c.CardType || ''} ${c.Notes || ''} ${
          holder?.full_name || ''
        } ${c.CurrentHolderName || ''} ${c.DetectedBy || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, activeCardHolderMap, statusFilter, searchQuery, isPendingPhoto]);

  const toggleSelectRow = (cardNum) => {
    setSelectedNumbers((prev) =>
      prev.includes(cardNum) ? prev.filter((x) => x !== cardNum) : [...prev, cardNum]
    );
  };

  const toggleSelectAllFiltered = () => {
    const allFilteredNums = filteredCards.map((c) => String(c.CardNumber || '').trim()).filter(Boolean);
    const allChecked =
      allFilteredNums.length > 0 && allFilteredNums.every((n) => selectedNumbers.includes(n));
    if (allChecked) {
      setSelectedNumbers((prev) => prev.filter((n) => !allFilteredNums.includes(n)));
    } else {
      setSelectedNumbers(Array.from(new Set([...selectedNumbers, ...allFilteredNums])));
    }
  };

  const isAdmin = user?.role === 'admin';

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* TOP HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 10,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              CSDL SQL Server (tbl_CustomerCards) · SharePoint (VMS SEAZEN - KHO THẺ KHÁCH)
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Quản lý Kho Thẻ RFID & Ảnh Bằng Chứng ({cards.length} thẻ)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-dark">Tổng kho: {cards.length} thẻ</span>
            <span
              className="badge"
              style={{
                background: pendingPhotoCount > 0 ? '#fef2f2' : '#f0fdf4',
                color: pendingPhotoCount > 0 ? '#b91c1c' : '#15803d',
                border: `1px solid ${pendingPhotoCount > 0 ? '#fecaca' : '#bbf7d0'}`,
              }}
            >
              Chờ ảnh bằng chứng: {pendingPhotoCount}
            </span>
            <span className="badge badge-gold">
              Đang cấp cho khách: {Object.keys(activeCardHolderMap).length}
            </span>
            {lostCount > 0 && <span className="badge badge-red">Mất / Khóa: {lostCount}</span>}
            <button type="button" className="btn btn-sm" onClick={loadCards}>
              Làm mới
            </button>
            {isAdmin && selectedNumbers.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}
                onClick={() => handleBulkClear(false)}
              >
                Xóa {selectedNumbers.length} thẻ đã chọn
              </button>
            )}
            {isAdmin && cards.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ borderColor: '#e5e7eb', color: '#374151' }}
                onClick={() => handleBulkClear(true)}
              >
                Dọn sạch Kho thẻ
              </button>
            )}
          </div>
        </div>

        {/* ALERT BANNER WHEN NEW AUTO-DETECTED CARDS NEED EVIDENCE PHOTO */}
        {pendingPhotoCount > 0 && (
          <div
            style={{
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 12,
              padding: '10px 16px',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#b45309"
                strokeWidth="2.2"
                style={{ flexShrink: 0 }}
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <div style={{ fontSize: 13, color: '#78350f', fontWeight: 600 }}>
                Có <strong>{pendingPhotoCount} thẻ mới</strong> phát hiện từ tiếp đón khách đang chờ bổ sung{' '}
                <strong>ảnh bằng chứng mặt thẻ</strong> để kiểm soát mất/hỏng.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: '#111111',
                color: '#ffffff',
                borderColor: '#111111',
                whiteSpace: 'nowrap',
              }}
              onClick={() =>
                setStatusFilter((prev) => (prev === 'PENDING_PHOTO' ? 'ALL' : 'PENDING_PHOTO'))
              }
            >
              {statusFilter === 'PENDING_PHOTO'
                ? 'Hiện tất cả thẻ'
                : `Lọc ${pendingPhotoCount} thẻ chờ ảnh`}
            </button>
          </div>
        )}

        {/* ADD / EDIT CARD FORM BAR */}
        <form
          onSubmit={handleSaveCard}
          className="card"
          style={{ padding: '12px 16px', marginBottom: 12, flexShrink: 0 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              {formData.CardID
                ? `Chỉnh sửa thẻ #${formData.CardID} (RFID: ${formData.CardNumber})`
                : 'Thêm mới / Đăng ký Thẻ từ RFID kèm Ảnh bằng chứng'}
            </div>
            {formData.CardID && (
              <button type="button" className="btn btn-sm" onClick={resetForm}>
                Hủy sửa
              </button>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.1fr 1fr 0.85fr 0.85fr 1.1fr 1.1fr auto',
              gap: 10,
              alignItems: 'end',
            }}
          >
            <div className="v-field">
              <label>
                <span className="req">*</span>Số thẻ RFID / NFC
              </label>
              <input
                type="text"
                className="v-input"
                placeholder="Quẹt đầu đọc..."
                value={formData.CardNumber}
                onChange={(e) => setFormData({ ...formData, CardNumber: e.target.value })}
              />
            </div>

            <div className="v-field">
              <label>Mã nhãn thẻ</label>
              <input
                type="text"
                className="v-input"
                placeholder="VD: THE-KHACH-01"
                value={formData.CardCode}
                onChange={(e) => setFormData({ ...formData, CardCode: e.target.value })}
              />
            </div>

            <div className="v-field">
              <label>Loại thẻ</label>
              <select
                className="v-input"
                value={formData.CardType}
                onChange={(e) => setFormData({ ...formData, CardType: e.target.value })}
              >
                <option value="VISITOR">Thẻ Khách</option>
                <option value="VIP">Khách VIP</option>
                <option value="CONTRACTOR">Nhà thầu</option>
                <option value="TEMP_STAFF">Tạm NV</option>
              </select>
            </div>

            <div className="v-field">
              <label>Trạng thái</label>
              <select
                className="v-input"
                value={formData.Status}
                onChange={(e) => setFormData({ ...formData, Status: e.target.value })}
              >
                <option value="AVAILABLE">Sẵn sàng</option>
                <option value="IN_USE">Đang cấp</option>
                <option value="LOST">Mất thẻ</option>
                <option value="LOCKED">Khóa / Hỏng</option>
              </select>
            </div>

            <div className="v-field">
              <label>Ghi chú nhận dạng</label>
              <input
                type="text"
                className="v-input"
                placeholder="Số in trên thẻ..."
                value={formData.Notes}
                onChange={(e) => setFormData({ ...formData, Notes: e.target.value })}
              />
            </div>

            <div className="v-field">
              <label>Ảnh bằng chứng thẻ</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  ref={formFileRef}
                  type="file"
                  accept="image/*"
                  className="v-input"
                  style={{ padding: '4px 6px', fontSize: 11.5 }}
                  onChange={handleFormFileChange}
                />
                {formData.CardPhotoBase64 && (
                  <img
                    src={formData.CardPhotoBase64}
                    alt="Card"
                    style={{
                      width: 38,
                      height: 28,
                      objectFit: 'cover',
                      borderRadius: 4,
                      border: '1px solid var(--border-main)',
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>
            </div>

            <button type="submit" className="btn btn-gold" style={{ height: 36 }} disabled={saving}>
              {saving ? 'Đang lưu...' : formData.CardID ? 'Cập nhật thẻ' : '+ Lưu thẻ'}
            </button>
          </div>
        </form>

        {/* FILTER & TABLE */}
        <div className="card card-table-fill">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="card-title">Danh sách Thẻ trong Kho ({filteredCards.length})</div>
              <div className="tino-search-bar" style={{ marginTop: 0, padding: '6px 12px', width: 250 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  placeholder="Tìm số RFID, mã thẻ, khách giữ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="v-input"
                style={{ width: 210, height: 32 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">Tất cả trạng thái ({cards.length})</option>
                <option value="PENDING_PHOTO">Chờ ảnh bằng chứng ({pendingPhotoCount})</option>
                <option value="AVAILABLE">Sẵn sàng cấp</option>
                <option value="IN_USE">Đang cấp cho khách</option>
                <option value="LOST">Đã báo mất</option>
                <option value="LOCKED">Đang khóa / Hỏng</option>
              </select>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Thẻ mới phát hiện tự động khi đăng ký khách sẽ ưu tiên xếp lên đầu để Admin bổ sung ảnh
            </span>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={
                        filteredCards.length > 0 &&
                        filteredCards.every((c) => selectedNumbers.includes(String(c.CardNumber || '').trim()))
                      }
                      onChange={toggleSelectAllFiltered}
                    />
                  </th>
                  <th>Ảnh bằng chứng</th>
                  <th>Mã nhãn thẻ</th>
                  <th>Số RFID / NFC</th>
                  <th>Trạng thái</th>
                  <th>Người đang giữ / Ghi nhận</th>
                  <th>Ghi chú</th>
                  <th>Cập nhật</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((c) => {
                  const cleanNum = String(c.CardNumber || '').trim();
                  const holder =
                    activeCardHolderMap[cleanNum] ||
                    (/^\d+$/.test(cleanNum)
                      ? activeCardHolderMap[cleanNum.replace(/^0+/, '') || '0']
                      : null);
                  const curStatus = String(c.Status || 'AVAILABLE').toUpperCase();
                  const isUsed = Boolean(holder) || curStatus === 'IN_USE';
                  const missingPhoto = isPendingPhoto(c);

                  return (
                    <tr
                      key={c.CardID || cleanNum}
                      style={missingPhoto ? { background: '#fffdf5' } : undefined}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedNumbers.includes(cleanNum)}
                          onChange={() => toggleSelectRow(cleanNum)}
                        />
                      </td>
                      <td>
                        {c.CardPhotoBase64 ? (
                          <button
                            type="button"
                            onClick={() => setPreviewLightbox(c)}
                            title="Bấm để xem ảnh thẻ kích thước lớn"
                            style={{
                              padding: 0,
                              border: '1px solid var(--border-main)',
                              borderRadius: 6,
                              overflow: 'hidden',
                              background: '#fff',
                              cursor: 'pointer',
                              display: 'inline-block',
                            }}
                          >
                            <img
                              src={c.CardPhotoBase64}
                              alt={c.CardCode || cleanNum}
                              style={{ width: 58, height: 38, objectFit: 'cover', display: 'block' }}
                            />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              borderColor: '#f59e0b',
                              background: '#fffbeb',
                              color: '#b45309',
                              fontWeight: 700,
                              fontSize: 11.5,
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => openEvidenceModal(c)}
                          >
                            + Ảnh thẻ
                          </button>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{c.CardCode || `THE-KHACH-${cleanNum}`}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          #{c.CardID} · {c.CardType || 'VISITOR'}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13.5 }}>
                        {cleanNum}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {curStatus === 'LOST' ? (
                            <span className="badge badge-red">Đã báo mất</span>
                          ) : curStatus === 'LOCKED' ? (
                            <span className="badge badge-red">Đang khóa / Hỏng</span>
                          ) : isUsed ? (
                            <span className="badge badge-gold">Đang cấp cho khách</span>
                          ) : (
                            <span className="badge badge-green">Sẵn sàng cấp</span>
                          )}
                          {missingPhoto ? (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#b91c1c',
                                background: '#fef2f2',
                                border: '1px solid #fecaca',
                                padding: '1px 6px',
                                borderRadius: 4,
                              }}
                            >
                              Chờ ảnh bằng chứng
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: '#15803d', fontWeight: 600 }}>
                              Đã xác minh ảnh
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {holder ? (
                          <div>
                            <div style={{ fontWeight: 700 }}>{holder.full_name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              CCCD: {holder.cccd_number || '—'} · Vào: {holder.checkin_time}
                            </div>
                          </div>
                        ) : c.CurrentHolderName ? (
                          <div>
                            <div style={{ fontWeight: 600 }}>{c.CurrentHolderName}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              CCCD: {c.CurrentHolderCCCD || '—'}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Trong kho lễ tân</span>
                            {c.DetectedBy && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Nguồn: {c.DetectedBy}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', maxWidth: 210, fontSize: 12.5 }}>
                        {c.Notes || '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }}>
                        <div>{String(c.UpdatedAt || c.CreatedAt || '').slice(0, 16)}</div>
                        {c.VerifiedBy && (
                          <div style={{ fontSize: 10.5, fontFamily: 'inherit' }}>
                            Xác minh: {c.VerifiedBy}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => openEvidenceModal(c)}
                          >
                            {c.CardPhotoBase64 ? 'Đổi ảnh' : 'Bổ sung ảnh'}
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => handleEditSelect(c)}>
                            Sửa
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={
                              curStatus === 'LOST'
                                ? { borderColor: '#bbf7d0', background: '#f0fdf4', color: '#15803d' }
                                : { borderColor: '#fde68a', background: '#fffbeb', color: '#b45309' }
                            }
                            onClick={() => handleToggleLostStatus(c)}
                          >
                            {curStatus === 'LOST' ? 'Khôi phục' : 'Báo mất'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#dc2626' }}
                            onClick={() => handleDeleteCard(c)}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredCards.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                      {cards.length === 0
                        ? 'Kho thẻ hiện đang trống. Mỗi khi lễ tân đăng ký khách với thẻ RFID mới, hệ thống sẽ tự động thêm thẻ vào đây và yêu cầu ảnh bằng chứng.'
                        : 'Không có thẻ nào khớp bộ lọc hiện tại.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* EVIDENCE PHOTO UPLOAD MODAL */}
      {evidenceModalCard && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 17, 17, 0.55)',
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !uploadingEvidence && setEvidenceModalCard(null)}
        >
          <form
            onSubmit={handleSubmitEvidence}
            className="card"
            style={{ width: '100%', maxWidth: 480, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                  XÁC MINH ẢNH BẰNG CHỨNG THẺ VẬT LÝ
                </div>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: '2px 0 0' }}>
                  Thẻ RFID: {evidenceModalCard.CardNumber}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={uploadingEvidence}
                onClick={() => setEvidenceModalCard(null)}
              >
                Đóng
              </button>
            </div>

            <div className="v-field" style={{ marginBottom: 10 }}>
              <label>Mã nhãn / Số thứ tự in trên thẻ</label>
              <input
                type="text"
                className="v-input"
                value={evidenceCode}
                onChange={(e) => setEvidenceCode(e.target.value)}
                placeholder="VD: THE-KHACH-03"
              />
            </div>

            <div className="v-field" style={{ marginBottom: 10 }}>
              <label>Ghi chú nhận dạng (màu sắc, số tem dán, tình trạng...)</label>
              <input
                type="text"
                className="v-input"
                value={evidenceNotes}
                onChange={(e) => setEvidenceNotes(e.target.value)}
                placeholder="VD: Thẻ nhựa trắng mặt trước dán số 03"
              />
            </div>

            <div className="v-field" style={{ marginBottom: 14 }}>
              <label>
                <span className="req">*</span>Ảnh chụp thẻ (Chọn tệp hoặc bấm Ctrl+V để dán trực tiếp)
              </label>
              <div
                style={{
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: 10,
                  padding: 14,
                  textAlign: 'center',
                  background: '#f8fafc',
                }}
              >
                {evidencePhoto ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <img
                      src={evidencePhoto}
                      alt="Evidence preview"
                      style={{
                        maxWidth: '100%',
                        maxHeight: 220,
                        borderRadius: 8,
                        border: '1px solid var(--border-main)',
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => modalFileRef.current?.click()}
                    >
                      Chọn ảnh khác
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      Dán ảnh trực tiếp bằng <strong>Ctrl + V</strong> hoặc chọn file ảnh chụp mặt thẻ
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => modalFileRef.current?.click()}
                    >
                      Chọn ảnh từ máy / Camera
                    </button>
                  </div>
                )}
                <input
                  ref={modalFileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleModalFileChange}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={uploadingEvidence}
                onClick={() => setEvidenceModalCard(null)}
              >
                Hủy
              </button>
              <button type="submit" className="btn btn-gold" disabled={uploadingEvidence}>
                {uploadingEvidence ? 'Đang tải lên...' : 'Lưu ảnh & Đồng bộ SharePoint'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* PHOTO LIGHTBOX */}
      {previewLightbox && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 17, 17, 0.72)',
            zIndex: 1300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setPreviewLightbox(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 560, width: '100%', padding: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {previewLightbox.CardCode} (RFID: {previewLightbox.CardNumber})
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {previewLightbox.VerifiedBy
                    ? `Xác minh bởi ${previewLightbox.VerifiedBy} lúc ${String(previewLightbox.VerifiedAt || '').slice(0, 19)}`
                    : 'Ảnh bằng chứng thẻ vật lý'}
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setPreviewLightbox(null)}>
                Đóng
              </button>
            </div>
            <img
              src={previewLightbox.CardPhotoBase64}
              alt={previewLightbox.CardCode}
              style={{
                width: '100%',
                maxHeight: 420,
                objectFit: 'contain',
                borderRadius: 8,
                background: '#f8fafc',
                border: '1px solid var(--border-main)',
              }}
            />
            {previewLightbox.Notes && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                Ghi chú: {previewLightbox.Notes}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
