import React, { useState, useRef, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function VisitorManagementPage({
  departments,
  employees,
  activeVisitors,
  visitorHistory = [],
  customerCards,
  onRefreshData,
  notify,
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowTimeStr = new Date().toTimeString().slice(0, 5);

  // DEFAULT CLOSED: Mặc định thu gọn thành nút "+ Đăng ký khách", danh sách khách dồn lên trên
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [listTab, setListTab] = useState('ACTIVE'); // ACTIVE | HISTORY
  const [visitorSearch, setVisitorSearch] = useState('');

  const mainQrInputRef = useRef(null);
  const compQrInputRef = useRef(null);
  const [showMainQrBox, setShowMainQrBox] = useState(false);
  const [showCompQrBox, setShowCompQrBox] = useState(false);
  const [mainQrRaw, setMainQrRaw] = useState('');
  const [compQrRaw, setCompQrRaw] = useState('');
  const [checkoutQuery, setCheckoutQuery] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    birth_date: '',
    from_date: todayStr,
    from_time: nowTimeStr,
    to_date: todayStr,
    to_time: '17:30',
    purpose: '',
    cccd_number: '',
    phone: '',
    company: '',
    access_area: 'Sảnh Chính (Cổng Làn Vào & Làn Ra)',
    notes: '',
    use_phone: false,
    department: 'BGĐ SeaZen',
    host_person: '',
    host_phone: '',
    card_number: '',
    auto_unlock: false,
  });

  const [compForm, setCompForm] = useState({
    full_name: '',
    birth_date: '',
    cccd_number: '',
    from_time: `${todayStr} ${nowTimeStr}`,
    to_time: `${todayStr} 17:30`,
    card_number: '',
  });

  const [companions, setCompanions] = useState([]);
  const [selectedCompIdx, setSelectedCompIdx] = useState([]);

  // Filter employees belonging to the selected contact department for fast selection
  const deptEmployees = employees.filter((e) => {
    const dName = e.department || e.DepartmentName || '';
    return !form.department || dName === form.department;
  });

  const parseQrForMain = async (raw) => {
    setMainQrRaw(raw);
    if (!raw.includes('|')) return;
    const { ok, data } = await apiFetch('/api/visitor/parse_cccd', {
      method: 'POST',
      body: JSON.stringify({ qr_string: raw }),
    });
    if (ok && data.success && data.data) {
      const p = data.data;
      setForm((prev) => ({
        ...prev,
        full_name: p.full_name || prev.full_name,
        cccd_number: p.cccd_number || prev.cccd_number,
        birth_date: p.birth_date || prev.birth_date,
      }));
      setShowMainQrBox(false);
      setMainQrRaw('');
      notify(`Đã đọc QR căn cước: ${p.full_name} (${p.cccd_number})`, 'success');
    }
  };

  const parseQrForCompanion = async (raw) => {
    setCompQrRaw(raw);
    if (!raw.includes('|')) return;
    const { ok, data } = await apiFetch('/api/visitor/parse_cccd', {
      method: 'POST',
      body: JSON.stringify({ qr_string: raw }),
    });
    if (ok && data.success && data.data) {
      const p = data.data;
      setCompForm((prev) => ({
        ...prev,
        full_name: p.full_name || prev.full_name,
        cccd_number: p.cccd_number || prev.cccd_number,
        birth_date: p.birth_date || prev.birth_date,
      }));
      setShowCompQrBox(false);
      setCompQrRaw('');
      notify(`Đã đọc QR người đi cùng: ${p.full_name}`, 'success');
    }
  };

  const handleAddCompanion = () => {
    if (!compForm.full_name.trim() && !compForm.cccd_number.trim()) {
      notify('Vui lòng nhập họ tên hoặc quét QR căn cước cho nhân sự đi cùng.', 'error');
      return;
    }
    setCompanions((prev) => [...prev, { ...compForm }]);
    setCompForm({
      full_name: '',
      birth_date: '',
      cccd_number: '',
      from_time: `${form.from_date} ${form.from_time}`,
      to_time: `${form.to_date} ${form.to_time}`,
      card_number: '',
    });
  };

  const handleDeleteSelectedCompanions = () => {
    if (selectedCompIdx.length === 0) {
      setCompanions([]);
      return;
    }
    setCompanions((prev) => prev.filter((_, idx) => !selectedCompIdx.includes(idx)));
    setSelectedCompIdx([]);
  };

  const handleResetForm = () => {
    setForm({
      full_name: '',
      birth_date: '',
      from_date: todayStr,
      from_time: nowTimeStr,
      to_date: todayStr,
      to_time: '17:30',
      purpose: '',
      cccd_number: '',
      phone: '',
      company: '',
      access_area: 'Sảnh Chính (Cổng Làn Vào & Làn Ra)',
      notes: '',
      use_phone: false,
      department: 'BGĐ SeaZen',
      host_person: '',
      host_phone: '',
      card_number: '',
      auto_unlock: false,
    });
    setCompanions([]);
    setSelectedCompIdx([]);
  };

  const handleSubmitRegistration = async (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      expected_checkout_time: `${form.to_date} ${form.to_time}:00`,
      companions,
    };
    const { ok, data } = await apiFetch('/api/visitor/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (ok && data.success) {
      notify(data.message || 'Đã đăng ký khách và nạp thẻ thành công.', 'success');
      handleResetForm();
      setIsFormOpen(false);
      onRefreshData();
    } else {
      notify(data.error || 'Không thể đăng ký khách.', 'error');
    }
  };

  const handleFastCheckout = async (qVal) => {
    const q = qVal || checkoutQuery;
    if (!q) return;
    const { ok, data } = await apiFetch('/api/visitor/fast_checkout', {
      method: 'POST',
      body: JSON.stringify({ query: q }),
    });
    if (ok && data.success) {
      notify(data.message || 'Đã thu hồi thẻ và hoàn tất trả khách.', 'success');
      setCheckoutQuery('');
      onRefreshData();
    } else {
      notify(data.error || 'Không tìm thấy khách đang có mặt.', 'error');
    }
  };

  const filteredActiveVisitors = useMemo(() => {
    if (!visitorSearch.trim()) return activeVisitors;
    const q = visitorSearch.toLowerCase();
    return activeVisitors.filter((v) =>
      `${v.full_name || ''} ${v.cccd_number || ''} ${v.card_number || ''} ${v.department || ''} ${v.host_person || ''} ${v.company || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [activeVisitors, visitorSearch]);

  const filteredHistoryVisitors = useMemo(() => {
    if (!visitorSearch.trim()) return visitorHistory;
    const q = visitorSearch.toLowerCase();
    return visitorHistory.filter((v) =>
      `${v.FullName || v.full_name || ''} ${v.CCCDNumber || v.cccd_number || ''} ${v.CardNumber || v.card_number || ''} ${v.HostDepartment || v.department || ''} ${v.HostPerson || v.host_person || ''} ${v.Company || v.company || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [visitorHistory, visitorSearch]);

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* THANH TIÊU ĐỀ & NÚT MỞ / THU GỌN PHIẾU ĐĂNG KÝ KHÁCH (MẶC ĐỊNH ĐÓNG) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              Quản lý Khách Ra vào · Cấp thẻ NFC 4 máy ZKTeco · Đồng bộ SharePoint VMS
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Danh sách Khách & Đăng ký Ra vào ({activeVisitors.length} khách đang làm việc)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              className="v-input"
              style={{ width: 240 }}
              value={checkoutQuery}
              onChange={(e) => setCheckoutQuery(e.target.value)}
              placeholder="Quẹt thẻ trả lại hoặc quét CCCD..."
            />
            <button type="button" className="btn" onClick={() => handleFastCheckout()}>
              Trả thẻ & Check-out
            </button>

            {!isFormOpen ? (
              <button
                type="button"
                className="btn btn-gold"
                style={{ padding: '0 20px', height: 38, fontWeight: 700 }}
                onClick={() => setIsFormOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Đăng ký khách</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '0 18px', height: 38 }}
                onClick={() => setIsFormOpen(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
                <span>Thu gọn phiếu đăng ký</span>
              </button>
            )}
          </div>
        </div>

        {/* PHIẾU ĐĂNG KÝ LÀM VIỆC TRONG NHÀ MÁY / TÒA NHÀ (CHỈ MỞ KHI BẤM NÚT "ĐĂNG KÝ KHÁCH") */}
        {isFormOpen && (
          <form
            onSubmit={handleSubmitRegistration}
            className="visitor-sheet"
            style={{
              marginBottom: 14,
              maxHeight: '54vh',
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            <div className="visitor-sheet-header">
              <div className="visitor-sheet-title">Phiếu đăng ký làm việc trong nhà máy / tòa nhà</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn-qr-navy"
                  onClick={() => {
                    setShowMainQrBox((v) => !v);
                    setTimeout(() => mainQrInputRef.current?.focus(), 60);
                  }}
                >
                  Đọc thông tin từ QR căn cước
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setIsFormOpen(false)}
                  title="Thu nhỏ phiếu đăng ký thành nút"
                >
                  Thu gọn phiếu
                </button>
              </div>
            </div>

            {/* Instant QR Scanner Input Bar when clicked */}
            {showMainQrBox && (
              <div
                style={{
                  background: 'var(--gold-soft)',
                  border: '1px solid var(--gold)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <input
                  ref={mainQrInputRef}
                  type="text"
                  className="v-input"
                  value={mainQrRaw}
                  onChange={(e) => parseQrForMain(e.target.value)}
                  placeholder="Đặt con trỏ tại đây và bấm súng quét mã QR trên căn cước công dân (Định dạng: Số CCCD||Họ tên|Ngày sinh...)..."
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setShowMainQrBox(false)}
                >
                  Đóng
                </button>
              </div>
            )}

            {/* 3-COLUMN PRIMARY VISITOR GRID */}
            <div className="visitor-3col-grid">
              {/* CỘT 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Họ tên khách
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    required
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Ngày tháng năm sinh
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="dd/MM/yyyy"
                    value={form.birth_date}
                    onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Từ thời gian
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
                    <input
                      type="date"
                      className="v-input"
                      value={form.from_date}
                      onChange={(e) => setForm({ ...form, from_date: e.target.value })}
                    />
                    <input
                      type="time"
                      className="v-input"
                      value={form.from_time}
                      onChange={(e) => setForm({ ...form, from_time: e.target.value })}
                    />
                  </div>
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Đến thời gian
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
                    <input
                      type="date"
                      className="v-input"
                      value={form.to_date}
                      onChange={(e) => setForm({ ...form, to_date: e.target.value })}
                    />
                    <input
                      type="time"
                      className="v-input"
                      value={form.to_time}
                      onChange={(e) => setForm({ ...form, to_time: e.target.value })}
                    />
                  </div>
                </div>

                <div className="v-field">
                  <label>Nội dung làm việc</label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  />
                </div>
              </div>

              {/* CỘT 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>CMND/CCCD/Passport
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.cccd_number}
                    onChange={(e) => setForm({ ...form, cccd_number: e.target.value })}
                    required
                  />
                </div>

                <div className="v-field">
                  <label>Số điện thoại</label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Tên công ty
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Khu vực được phép truy cập
                  </label>
                  <select
                    className="v-input"
                    value={form.access_area}
                    onChange={(e) => setForm({ ...form, access_area: e.target.value })}
                  >
                    <option value="Sảnh Chính (Cổng Làn Vào & Làn Ra)">Sảnh Chính (Cổng Làn Vào & Làn Ra)</option>
                    <option value="Khu vực Văn phòng & Phòng họp">Khu vực Văn phòng & Phòng họp</option>
                    <option value="Khu vực Kỹ thuật & Nhà máy">Khu vực Kỹ thuật & Nhà máy</option>
                    <option value="Toàn bộ các cửa kiểm soát">Toàn bộ các cửa kiểm soát</option>
                  </select>
                </div>

                <div className="v-field">
                  <label>Ghi chú</label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Sử dụng điện thoại</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.use_phone}
                      onChange={(e) => setForm({ ...form, use_phone: e.target.checked })}
                    />
                    <span>Có</span>
                  </label>
                </div>
              </div>

              {/* CỘT 3 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Phòng ban liên hệ
                  </label>
                  <select
                    className="v-input"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  >
                    {departments.map((d) => (
                      <option key={d.DepartmentID} value={d.DepartmentName}>
                        {d.DepartmentName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Người liên hệ
                  </label>
                  <input
                    type="text"
                    list="dept-employees-datalist"
                    className="v-input"
                    placeholder="Chọn nhanh hoặc gõ tên người liên hệ..."
                    value={form.host_person}
                    onChange={(e) => {
                      const val = e.target.value;
                      const found = deptEmployees.find((emp) => (emp.fullname || emp.FullName) === val);
                      setForm({
                        ...form,
                        host_person: val,
                        host_phone: found?.phone || found?.Phone || form.host_phone,
                      });
                    }}
                  />
                  <datalist id="dept-employees-datalist">
                    {deptEmployees.slice(0, 100).map((emp, idx) => (
                      <option key={idx} value={emp.fullname || emp.FullName}>
                        {emp.department || emp.DepartmentName}
                      </option>
                    ))}
                  </datalist>
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Số điện thoại người liên hệ
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.host_phone}
                    onChange={(e) => setForm({ ...form, host_phone: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Mã thẻ
                  </label>
                  <input
                    type="text"
                    list="visitor-cards-datalist"
                    className="v-input"
                    placeholder="Quẹt thẻ NFC lên đầu đọc hoặc chọn thẻ..."
                    value={form.card_number}
                    onChange={(e) => setForm({ ...form, card_number: e.target.value })}
                  />
                  <datalist id="visitor-cards-datalist">
                    {customerCards.map((c) => (
                      <option key={c.CardNumber} value={c.CardNumber}>
                        {c.CardCode} ({c.Status})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={form.auto_unlock}
                      onChange={(e) => setForm({ ...form, auto_unlock: e.target.checked })}
                    />
                    <span>Mở cổng Làn VÀO ngay khi lưu</span>
                  </label>
                </div>
              </div>
            </div>

            {/* PHẦN DƯỚI: THÔNG TIN NHÂN SỰ ĐI CÙNG */}
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>Thông tin nhân sự đi cùng:</span>
                <button
                  type="button"
                  onClick={handleDeleteSelectedCompanions}
                  title="Xóa danh sách người đi cùng đã chọn"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>

              {showCompQrBox && (
                <div
                  style={{
                    background: 'var(--gold-soft)',
                    border: '1px solid var(--gold)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    marginBottom: 12,
                    display: 'flex',
                    gap: 10,
                  }}
                >
                  <input
                    ref={compQrInputRef}
                    type="text"
                    className="v-input"
                    value={compQrRaw}
                    onChange={(e) => parseQrForCompanion(e.target.value)}
                    placeholder="Bấm súng quét mã QR CCCD của nhân sự đi cùng..."
                  />
                  <button type="button" className="btn btn-sm" onClick={() => setShowCompQrBox(false)}>
                    Đóng
                  </button>
                </div>
              )}

              <div className="companion-bar">
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Họ tên
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={compForm.full_name}
                    onChange={(e) => setCompForm({ ...compForm, full_name: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Ngày tháng năm sinh
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="dd/MM/yyyy"
                    value={compForm.birth_date}
                    onChange={(e) => setCompForm({ ...compForm, birth_date: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>CCCD/ Passport
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={compForm.cccd_number}
                    onChange={(e) => setCompForm({ ...compForm, cccd_number: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Từ thời gian
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="dd/MM/yyyy HH:mm"
                    value={compForm.from_time}
                    onChange={(e) => setCompForm({ ...compForm, from_time: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Đến thời gian
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="dd/MM/yyyy HH:mm"
                    value={compForm.to_time}
                    onChange={(e) => setCompForm({ ...compForm, to_time: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Mã thẻ
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="Quẹt thẻ..."
                    value={compForm.card_number}
                    onChange={(e) => setCompForm({ ...compForm, card_number: e.target.value })}
                  />
                </div>

                <button
                  type="button"
                  className="btn-qr-navy"
                  style={{ height: 36 }}
                  onClick={() => {
                    setShowCompQrBox((v) => !v);
                    setTimeout(() => compQrInputRef.current?.focus(), 60);
                  }}
                >
                  Đọc thông tin từ QR căn cước
                </button>

                <button
                  type="button"
                  className="btn-qr-navy"
                  style={{ height: 36 }}
                  onClick={handleAddCompanion}
                >
                  Thêm
                </button>
              </div>

              {/* Bảng danh sách nhân sự đi cùng */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          checked={companions.length > 0 && selectedCompIdx.length === companions.length}
                          onChange={(e) =>
                            setSelectedCompIdx(e.target.checked ? companions.map((_, i) => i) : [])
                          }
                        />
                      </th>
                      <th style={{ width: 44 }}>#</th>
                      <th>HỌ TÊN</th>
                      <th>NĂM SINH</th>
                      <th>CCCD/ PASSPORT</th>
                      <th>THỜI GIAN VÀO</th>
                      <th>THỜI GIAN RA</th>
                      <th>MÃ THẺ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companions.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                          Không có dữ liệu
                        </td>
                      </tr>
                    ) : (
                      companions.map((c, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedCompIdx.includes(idx)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCompIdx((prev) => [...prev, idx]);
                                } else {
                                  setSelectedCompIdx((prev) => prev.filter((i) => i !== idx));
                                }
                              }}
                            />
                          </td>
                          <td>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{c.full_name}</td>
                          <td>{c.birth_date}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.cccd_number}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.from_time}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.to_time}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.card_number}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Nút Hủy bỏ & Đồng ý góc dưới phải */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    handleResetForm();
                    setIsFormOpen(false);
                  }}
                >
                  Hủy bỏ & Thu gọn
                </button>
                <button type="submit" className="btn-qr-navy" style={{ padding: '0 26px', height: 36 }}>
                  Đồng ý
                </button>
              </div>
            </div>
          </form>
        )}

        {/* DANH SÁCH KHÁCH (DỒN LÊN TRÊN KHI THU GỌN PHIẾU, CUỘN NỘI BỘ TRONG BẢNG) */}
        <div className="card card-table-fill">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-sm ${listTab === 'ACTIVE' ? 'btn-primary' : ''}`}
                onClick={() => setListTab('ACTIVE')}
              >
                Khách đang làm việc ({activeVisitors.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${listTab === 'HISTORY' ? 'btn-primary' : ''}`}
                onClick={() => setListTab('HISTORY')}
              >
                Lịch sử Khách đã đăng ký ({visitorHistory.length})
              </button>

              <div className="tino-search-bar" style={{ marginTop: 0, padding: '6px 12px', width: 280 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  placeholder="Tìm họ tên khách, CCCD, mã thẻ, công ty..."
                  value={visitorSearch}
                  onChange={(e) => setVisitorSearch(e.target.value)}
                />
              </div>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {isFormOpen
                ? 'Đang mở phiếu đăng ký · Bấm "Thu gọn phiếu" để mở rộng danh sách'
                : 'Bấm "+ Đăng ký khách" góc trên phải để mở phiếu đăng ký mới'}
            </span>
          </div>

          <div className="table-scroll">
            {listTab === 'ACTIVE' ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mã định danh (SharePoint ID)</th>
                    <th>Họ tên khách</th>
                    <th>CMND/CCCD</th>
                    <th>Công ty / Đơn vị</th>
                    <th>Mã thẻ NFC</th>
                    <th>Phòng ban / Người liên hệ</th>
                    <th>Giờ vào</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActiveVisitors.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Hiện không có khách nào đang giữ thẻ trong tòa nhà. Bấm &quot;+ Đăng ký khách&quot; ở góc trên để thêm mới.
                      </td>
                    </tr>
                  ) : (
                    filteredActiveVisitors.map((v, idx) => (
                      <tr key={v.id || idx}>
                        <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{v.id}</td>
                        <td style={{ fontWeight: 700 }}>{v.full_name}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{v.cccd_number || '—'}</td>
                        <td>{v.company || '—'}</td>
                        <td>
                          <span className="badge badge-gold">{v.card_number || 'Không thẻ'}</span>
                        </td>
                        <td>
                          {v.department} {v.host_person ? `· ${v.host_person}` : ''}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{v.checkin_time}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleFastCheckout(v.id)}
                          >
                            Thu hồi thẻ & Ra về
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mã Khách</th>
                    <th>Họ tên khách</th>
                    <th>CMND/CCCD</th>
                    <th>Công ty</th>
                    <th>Mã thẻ NFC</th>
                    <th>Phòng ban / Người liên hệ</th>
                    <th>Giờ vào</th>
                    <th>Giờ ra</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistoryVisitors.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Chưa có lịch sử khách ra vào khớp tìm kiếm.
                      </td>
                    </tr>
                  ) : (
                    filteredHistoryVisitors.map((v, idx) => {
                      const status = v.Status || v.status || 'CHECKED_OUT';
                      return (
                        <tr key={v.VisitorCode || v.id || idx}>
                          <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {v.VisitorCode || v.id}
                          </td>
                          <td style={{ fontWeight: 700 }}>{v.FullName || v.full_name}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {v.CCCDNumber || v.cccd_number || '—'}
                          </td>
                          <td>{v.Company || v.company || '—'}</td>
                          <td>
                            <span className="badge badge-dark">
                              {v.CardNumber || v.card_number || 'Không thẻ'}
                            </span>
                          </td>
                          <td>
                            {v.HostDepartment || v.department || '—'}{' '}
                            {v.HostPerson || v.host_person ? `· ${v.HostPerson || v.host_person}` : ''}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {String(v.CheckInTime || v.checkin_time || '').slice(0, 19)}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {String(v.CheckOutTime || v.checkout_time || '—').slice(0, 19)}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                status === 'ACTIVE' ? 'badge-gold' : 'badge-green'
                              }`}
                            >
                              {status === 'ACTIVE' ? 'Đang ở trong' : 'Đã trả thẻ'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
