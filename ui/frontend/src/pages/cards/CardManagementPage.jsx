import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function CardManagementPage({
  customerCards = [],
  activeVisitors = [],
  onRefreshData,
  notify,
}) {
  const [cards, setCards] = useState(customerCards);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    CardID: null,
    CardCode: '',
    CardNumber: '',
    CardType: 'VISITOR',
    Status: 'AVAILABLE',
    Notes: '',
  });

  useEffect(() => {
    setCards(customerCards);
  }, [customerCards]);

  const loadCards = async () => {
    const { ok, data } = await apiFetch('/api/visitor/cards');
    if (ok && data?.rows) {
      setCards(data.rows);
    }
    if (onRefreshData) onRefreshData();
  };

  useEffect(() => {
    loadCards();
  }, []);

  const activeCardHolderMap = useMemo(() => {
    const map = {};
    for (const v of activeVisitors) {
      if (v.card_number) {
        map[String(v.card_number).trim()] = v;
      }
    }
    return map;
  }, [activeVisitors]);

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
        setFormData({
          CardID: null,
          CardCode: '',
          CardNumber: '',
          CardType: 'VISITOR',
          Status: 'AVAILABLE',
          Notes: '',
        });
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
    });
  };

  const handleDeleteCard = async (card) => {
    const holder = activeCardHolderMap[String(card.CardNumber || '').trim()];
    const confirmMsg = holder
      ? `Thẻ ${card.CardNumber} đang được khách "${holder.full_name}" giữ. Bạn có chắc chắn muốn XÓA thẻ này khỏi CSDL Kho thẻ và thu hồi khỏi 4 máy cửa?`
      : `Bạn có chắc chắn muốn XÓA thẻ "${card.CardCode || card.CardNumber}" (Số RFID: ${card.CardNumber}) khỏi CSDL Kho thẻ?`;

    if (!window.confirm(confirmMsg)) return;

    const { ok, data } = await apiFetch('/api/visitor/card/delete', {
      method: 'POST',
      body: JSON.stringify({
        CardID: card.CardID,
        CardNumber: card.CardNumber,
      }),
    });

    if (ok && data?.success) {
      if (notify) notify(data.message || `Đã xóa thẻ ${card.CardNumber} khỏi CSDL Kho thẻ.`, 'success');
      if (formData.CardNumber === card.CardNumber) {
        setFormData({
          CardID: null,
          CardCode: '',
          CardNumber: '',
          CardType: 'VISITOR',
          Status: 'AVAILABLE',
          Notes: '',
        });
      }
      await loadCards();
    } else {
      if (notify) notify(data?.error || 'Không thể xóa thẻ.', 'error');
    }
  };

  const filteredCards = useMemo(() => {
    return (cards || []).filter((c) => {
      const holder = activeCardHolderMap[String(c.CardNumber || '').trim()];
      const effectiveStatus = holder ? 'IN_USE' : c.Status || 'AVAILABLE';
      if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${c.CardCode || ''} ${c.CardNumber || ''} ${c.CardType || ''} ${c.Notes || ''} ${holder?.full_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, activeCardHolderMap, statusFilter, searchQuery]);

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* TOP HEADER (FIXED) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              CSDL SQL Server (tbl_CustomerCards) & SharePoint (VMS SEAZEN - KHO THẺ KHÁCH)
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Quản lý Kho Thẻ RFID / NFC ({cards.length} thẻ)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-dark">Tổng kho: {cards.length} thẻ</span>
            <span className="badge badge-gold">
              Đang cấp cho khách: {Object.keys(activeCardHolderMap).length} thẻ
            </span>
            <button type="button" className="btn btn-sm" onClick={loadCards}>
              Làm mới kho thẻ
            </button>
          </div>
        </div>

        {/* ADD / EDIT CARD FORM BAR (FIXED, COMPACT) */}
        <form
          onSubmit={handleSaveCard}
          className="card"
          style={{ padding: '14px 18px', marginBottom: 14, flexShrink: 0 }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>
              {formData.CardID
                ? `Đang chỉnh sửa thẻ #${formData.CardID} (Số RFID: ${formData.CardNumber})`
                : 'Thêm mới / Đăng ký Thẻ từ RFID vào Kho thẻ'}
            </div>
            {formData.CardID && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setFormData({
                    CardID: null,
                    CardCode: '',
                    CardNumber: '',
                    CardType: 'VISITOR',
                    Status: 'AVAILABLE',
                    Notes: '',
                  })
                }
              >
                Hủy chế độ sửa
              </button>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.3fr 1.1fr 0.9fr 0.9fr 1.4fr auto',
              gap: 10,
              alignItems: 'end',
            }}
          >
            <div className="v-field">
              <label>
                <span className="req">*</span>Số thẻ RFID / NFC (Quẹt đầu đọc)
              </label>
              <input
                type="text"
                className="v-input"
                placeholder="VD: 0013245812"
                value={formData.CardNumber}
                onChange={(e) => setFormData({ ...formData, CardNumber: e.target.value })}
              />
            </div>

            <div className="v-field">
              <label>Mã nhãn thẻ (Tên in trên thẻ)</label>
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
                <option value="VISITOR">Thẻ Khách (VISITOR)</option>
                <option value="VIP">Thẻ Khách VIP</option>
                <option value="CONTRACTOR">Thẻ Nhà thầu</option>
                <option value="TEMP_STAFF">Thẻ Tạm nhân viên</option>
              </select>
            </div>

            <div className="v-field">
              <label>Trạng thái thẻ</label>
              <select
                className="v-input"
                value={formData.Status}
                onChange={(e) => setFormData({ ...formData, Status: e.target.value })}
              >
                <option value="AVAILABLE">Sẵn sàng (AVAILABLE)</option>
                <option value="IN_USE">Đang cấp (IN_USE)</option>
                <option value="LOCKED">Khóa / Hỏng (LOCKED)</option>
              </select>
            </div>

            <div className="v-field">
              <label>Ghi chú</label>
              <input
                type="text"
                className="v-input"
                placeholder="Ghi chú bàn lễ tân / khu vực..."
                value={formData.Notes}
                onChange={(e) => setFormData({ ...formData, Notes: e.target.value })}
              />
            </div>

            <button
              type="submit"
              className="btn btn-gold"
              style={{ height: 36 }}
              disabled={saving}
            >
              {formData.CardID ? 'Cập nhật thẻ' : '+ Thêm vào Kho thẻ'}
            </button>
          </div>
        </form>

        {/* FILTER & FIXED-HEIGHT INTERNAL SCROLL TABLE */}
        <div className="card card-table-fill">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="card-title">Danh sách Thẻ trong Kho ({filteredCards.length})</div>
              <div className="tino-search-bar" style={{ marginTop: 0, padding: '6px 12px', width: 260 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  placeholder="Tìm số thẻ, mã nhãn, người giữ..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <select
                className="v-input"
                style={{ width: 165, height: 32 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="AVAILABLE">Sẵn sàng cấp</option>
                <option value="IN_USE">Đang sử dụng</option>
                <option value="LOCKED">Đang khóa</option>
              </select>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Chọn &quot;Sửa&quot; để cập nhật hoặc &quot;Xóa thẻ&quot; để xóa khỏi CSDL Kho thẻ
            </span>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Mã nhãn thẻ (CardCode)</th>
                  <th>Số thẻ từ RFID / NFC</th>
                  <th>Loại thẻ</th>
                  <th>Trạng thái</th>
                  <th>Khách đang giữ thẻ</th>
                  <th>Ghi chú</th>
                  <th>Cập nhật lúc</th>
                  <th style={{ textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredCards.map((c) => {
                  const holder = activeCardHolderMap[String(c.CardNumber || '').trim()];
                  const isUsed = Boolean(holder) || c.Status === 'IN_USE';
                  return (
                    <tr key={c.CardID || c.CardNumber}>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        #{c.CardID}
                      </td>
                      <td style={{ fontWeight: 700 }}>{c.CardCode || `CARD-${c.CardNumber}`}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13.5 }}>
                        {c.CardNumber}
                      </td>
                      <td>
                        <span className="badge badge-dark">{c.CardType || 'VISITOR'}</span>
                      </td>
                      <td>
                        {isUsed ? (
                          <span className="badge badge-gold">Đang cấp cho khách</span>
                        ) : c.Status === 'LOCKED' ? (
                          <span className="badge badge-red">Đã khóa</span>
                        ) : (
                          <span className="badge badge-green">Sẵn sàng sử dụng</span>
                        )}
                      </td>
                      <td>
                        {holder ? (
                          <div>
                            <div style={{ fontWeight: 700 }}>{holder.full_name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              CCCD: {holder.cccd_number || '—'} · Vào: {holder.checkin_time}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Trong kho lễ tân</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{c.Notes || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                        {String(c.UpdatedAt || c.CreatedAt || '').slice(0, 19)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleEditSelect(c)}
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              borderColor: '#fecaca',
                              background: '#fef2f2',
                              color: '#dc2626',
                            }}
                            onClick={() => handleDeleteCard(c)}
                          >
                            Xóa thẻ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredCards.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                      Chưa có thẻ nào trong kho khớp với tìm kiếm. Hãy nhập số thẻ ở thanh phía trên để thêm mới.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
