import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../services/apiClient';

function foldVn(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function formatDobSmart(val, prevVal = '') {
  const s = String(val || '');
  if (s.length < String(prevVal || '').length) return s;
  const digits = s.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeStoredDob(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  return s;
}

export default function AppointmentsPage({
  user,
  departments = [],
  employees = [],
  appointments = [],
  onRefreshData,
  notify,
}) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nowTimeStr = now.toTimeString().slice(0, 5);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [frequentVisitors, setFrequentVisitors] = useState([]);
  const [focusedField, setFocusedField] = useState(null);
  const [showMainQrBox, setShowMainQrBox] = useState(false);
  const [mainQrRaw, setMainQrRaw] = useState('');
  const mainQrInputRef = useRef(null);

  const [form, setForm] = useState({
    full_name: '',
    birth_date: '',
    from_date: todayStr,
    from_time: nowTimeStr,
    to_date: todayStr,
    to_time: '16:45',
    purpose: '',
    cccd_number: '',
    phone: '',
    company: '',
    access_area: 'Sảnh Chính (Cổng Làn Vào & Làn Ra)',
    notes: '',
    use_phone: false,
    department: departments[0]?.name || 'BGĐ SeaZen',
    host_person: '',
    host_phone: '',
  });

  const [compForm, setCompForm] = useState({
    full_name: '',
    birth_date: '',
    cccd_number: '',
    from_time: `${todayStr} ${nowTimeStr}`,
    to_time: `${todayStr} 16:45`,
  });
  const [companions, setCompanions] = useState([]);
  const [assignCardMap, setAssignCardMap] = useState({});
  const [assigningId, setAssigningId] = useState(null);

  useEffect(() => {
    setCompForm((prev) => {
      if (prev.full_name || prev.cccd_number) return prev;
      return {
        ...prev,
        from_time: `${form.from_date} ${form.from_time}`,
        to_time: `${form.to_date} ${form.to_time}`,
      };
    });
  }, [form.from_date, form.from_time, form.to_date, form.to_time]);

  const loadFrequentVisitors = useCallback(async () => {
    const { ok, data } = await apiFetch('/api/visitors/frequent');
    if (ok && data?.visitors) setFrequentVisitors(data.visitors);
  }, []);

  useEffect(() => {
    loadFrequentVisitors();
  }, [loadFrequentVisitors]);

  const deptEmployees = useMemo(() => {
    const targetDept = String(form.department || '').trim().toLowerCase();
    return (employees || []).filter((e) => {
      const dName = String(e.department || e.DepartmentName || '').trim().toLowerCase();
      return !targetDept || dName === targetDept;
    });
  }, [employees, form.department]);

  const filteredHostEmployees = useMemo(() => {
    const qRaw = String(form.host_person || '').trim().toLowerCase();
    const qFold = foldVn(qRaw);
    if (!qRaw) return deptEmployees.slice(0, 60);
    return deptEmployees
      .filter((emp) => {
        const name = String(emp.fullname || emp.FullName || '');
        const atid = String(emp.atid || emp.EmployeeATID || '');
        return `${name} ${atid}`.toLowerCase().includes(qRaw) || foldVn(name).includes(qFold);
      })
      .slice(0, 60);
  }, [deptEmployees, form.host_person]);

  const getGuestSuggestions = useCallback(
    (query) => {
      const q = String(query || '').trim().toLowerCase();
      const qFold = foldVn(q);
      if (!q) return frequentVisitors.slice(0, 6);
      return frequentVisitors
        .filter((g) => {
          const name = String(g.full_name || '').toLowerCase();
          const cccd = String(g.cccd_number || '').toLowerCase();
          return name.includes(q) || foldVn(name).includes(qFold) || cccd.includes(q);
        })
        .slice(0, 6);
    },
    [frequentVisitors]
  );

  const mainNameSuggestions = useMemo(
    () => (focusedField === 'main_name' ? getGuestSuggestions(form.full_name) : []),
    [focusedField, form.full_name, getGuestSuggestions]
  );

  const parseQrForMain = async (raw) => {
    setMainQrRaw(raw);
    if (!raw.includes('|')) return;
    const { ok, data } = await apiFetch('/api/visitor/parse_cccd', {
      method: 'POST',
      body: JSON.stringify({ qr_string: raw }),
    });
    if (ok && data?.success && data?.data) {
      const p = data.data;
      setForm((prev) => ({
        ...prev,
        full_name: p.full_name || prev.full_name,
        cccd_number: p.cccd_number || prev.cccd_number,
        birth_date: normalizeStoredDob(p.birth_date) || prev.birth_date,
      }));
      setShowMainQrBox(false);
      setMainQrRaw('');
      notify(`Đã đọc QR căn cước: ${p.full_name} (${p.cccd_number})`, 'success');
    }
  };

  const handleAddCompanion = () => {
    const missing = [];
    if (!compForm.full_name.trim()) missing.push('Họ tên');
    if (!compForm.birth_date.trim()) missing.push('Ngày sinh');
    if (!compForm.cccd_number.trim()) missing.push('CCCD/Passport');
    if (missing.length > 0) {
      notify(`Nhân sự đi cùng còn thiếu: ${missing.join(', ')}.`, 'error');
      return;
    }
    setCompanions((prev) => [...prev, { ...compForm }]);
    setCompForm({
      full_name: '',
      birth_date: '',
      cccd_number: '',
      from_time: `${form.from_date} ${form.from_time}`,
      to_time: `${form.to_date} ${form.to_time}`,
    });
  };

  const handleResetForm = () => {
    setForm((prev) => ({
      ...prev,
      full_name: '',
      birth_date: '',
      from_date: todayStr,
      from_time: nowTimeStr,
      to_date: todayStr,
      to_time: '16:45',
      purpose: '',
      cccd_number: '',
      phone: '',
      company: '',
      notes: '',
      host_person: '',
      host_phone: '',
    }));
    setCompanions([]);
    setFocusedField(null);
  };

  const handleSubmitAppointment = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const req = [
      ['full_name', 'Họ tên khách'],
      ['birth_date', 'Ngày tháng năm sinh'],
      ['from_date', 'Ngày bắt đầu'],
      ['from_time', 'Giờ bắt đầu'],
      ['to_date', 'Ngày kết thúc'],
      ['to_time', 'Giờ kết thúc'],
      ['purpose', 'Nội dung làm việc'],
      ['cccd_number', 'CMND/CCCD/Passport'],
      ['company', 'Tên công ty'],
      ['access_area', 'Khu vực được phép truy cập'],
      ['department', 'Phòng ban liên hệ'],
      ['host_person', 'Người liên hệ'],
      ['host_phone', 'Số điện thoại người liên hệ'],
    ];
    const missing = req.filter(([k]) => !String(form[k] || '').trim()).map(([, lbl]) => lbl);
    if (missing.length > 0) {
      notify(`Vui lòng nhập đầy đủ các trường bắt buộc: ${missing.join(', ')}.`, 'error');
      return;
    }
    if (`${form.to_date} ${form.to_time}` < `${form.from_date} ${form.from_time}`) {
      notify('Thời gian kết thúc không được nhỏ hơn thời gian bắt đầu.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { ok, data } = await apiFetch('/api/visitor/appointment', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          expected_checkout_time: `${form.to_date} ${form.to_time}:00`,
          companions,
        }),
      });
      if (ok && data?.success) {
        notify(data.message || 'Đã lưu lịch hẹn khách thành công!', 'success');
        handleResetForm();
        setIsFormOpen(false);
        if (onRefreshData) onRefreshData();
      } else {
        notify(data?.error || 'Không thể lưu lịch hẹn khách.', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelAppointment = async (apt) => {
    if (!window.confirm(`Hủy lịch hẹn của khách "${apt.full_name}"?`)) return;
    const { ok, data } = await apiFetch(`/api/visitor/appointment/${encodeURIComponent(apt.id)}`, {
      method: 'DELETE',
    });
    if (ok && data?.success) {
      notify('Đã hủy lịch hẹn khách.', 'success');
      if (onRefreshData) onRefreshData();
    } else {
      notify(data?.error || 'Không thể hủy lịch hẹn.', 'error');
    }
  };

  const handleAssignCardNow = async (apt) => {
    const cardNo = String(assignCardMap[apt.id] || '').trim();
    if (!cardNo) {
      notify('Vui lòng đặt con trỏ và quẹt thẻ NFC để cấp cho khách.', 'error');
      return;
    }
    setAssigningId(apt.id);
    try {
      const { ok, data } = await apiFetch('/api/visitor/assign_card', {
        method: 'POST',
        body: JSON.stringify({ visitor_id: apt.id, card_number: cardNo }),
      });
      if (ok && data?.success) {
        notify(data.message || 'Đã cấp thẻ thành công!', 'success');
        setAssignCardMap((prev) => {
          const next = { ...prev };
          delete next[apt.id];
          return next;
        });
        if (onRefreshData) onRefreshData();
      } else {
        notify(data?.error || 'Không thể cấp thẻ.', 'error');
      }
    } finally {
      setAssigningId(null);
    }
  };

  const canAssignCard = user?.role !== 'guest_inviter';

  const filteredAppointments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qFold = foldVn(q);
    if (!q) return appointments || [];
    return (appointments || []).filter((a) => {
      const hay = `${a.full_name || ''} ${a.cccd_number || ''} ${a.company || ''} ${a.department || ''} ${a.host_person || ''}`.toLowerCase();
      return hay.includes(q) || foldVn(hay).includes(qFold);
    });
  }, [appointments, searchQuery]);

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 12,
            flexWrap: 'wrap',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
              Đặt lịch hẹn khách mời trước · Lễ tân chỉ cần quẹt thẻ khi khách đến (Pending → Active)
            </div>
            <h1 style={{ fontSize: 21, fontWeight: 800, color: 'var(--jet)', margin: '2px 0 0' }}>
              Khách mời &amp; Lịch hẹn ({appointments.length} đang chờ cấp thẻ)
            </h1>
          </div>

          <button
            type="button"
            className={isFormOpen ? 'btn btn-primary' : 'btn btn-gold'}
            style={{ height: 38, padding: '0 18px', fontWeight: 700 }}
            onClick={() => setIsFormOpen((v) => !v)}
          >
            {isFormOpen ? 'Thu gọn phiếu hẹn' : '+ Đặt lịch hẹn khách'}
          </button>
        </div>

        {/* APPOINTMENT FORM (NO CARD NUMBER FIELD) */}
        {isFormOpen && (
          <form
            onSubmit={handleSubmitAppointment}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target?.tagName === 'INPUT') e.preventDefault();
            }}
            noValidate
            className="visitor-sheet"
            style={{ flex: 1, overflowY: 'auto', marginBottom: 0 }}
          >
            <div className="visitor-sheet-header">
              <div className="visitor-sheet-title">Phiếu đăng ký Khách mời &amp; Lịch hẹn (Chưa cần mã thẻ)</div>
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
                  type="submit"
                  className="btn btn-gold"
                  style={{ height: 34, padding: '0 18px', fontWeight: 700 }}
                  disabled={submitting}
                >
                  {submitting ? 'Đang lưu...' : 'Lưu Lịch hẹn'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setIsFormOpen(false)}>
                  Thu gọn
                </button>
              </div>
            </div>

            {showMainQrBox && (
              <div
                style={{
                  background: 'var(--gold-soft)',
                  border: '1px solid var(--gold)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>Quét QR CCCD:</span>
                <input
                  ref={mainQrInputRef}
                  type="text"
                  className="v-input"
                  placeholder="Đặt con trỏ chuột và quét mã QR trên CCCD..."
                  value={mainQrRaw}
                  onChange={(e) => parseQrForMain(e.target.value)}
                />
                <button type="button" className="btn btn-sm" onClick={() => setShowMainQrBox(false)}>
                  Đóng
                </button>
              </div>
            )}

            <div className="visitor-grid-3">
              {/* CỘT 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Họ tên khách
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    autoComplete="off"
                    placeholder="Gõ tên khách..."
                    value={form.full_name}
                    onFocus={() => setFocusedField('main_name')}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'main_name' ? null : f)), 140)}
                    onChange={(e) => {
                      setForm({ ...form, full_name: e.target.value });
                      setFocusedField('main_name');
                    }}
                  />
                  {mainNameSuggestions.length > 0 && (
                    <div className="guest-suggest-popover">
                      <div className="guest-suggest-header">
                        <span>KHÁCH QUEN ĐÃ TỪNG ĐẾN ({mainNameSuggestions.length})</span>
                      </div>
                      {mainNameSuggestions.map((g, i) => (
                        <div
                          key={i}
                          className="guest-suggest-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setForm((prev) => ({
                              ...prev,
                              full_name: g.full_name || prev.full_name,
                              cccd_number: g.cccd_number || prev.cccd_number,
                              birth_date: normalizeStoredDob(g.birth_date) || prev.birth_date,
                              phone: g.phone || prev.phone,
                              company: g.company || prev.company,
                            }));
                            setFocusedField(null);
                          }}
                        >
                          <div>
                            <div className="guest-suggest-name">{g.full_name}</div>
                            <div className="guest-suggest-meta">
                              {g.cccd_number} · {g.company || 'Khách'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Ngày tháng năm sinh
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    className="v-input"
                    placeholder="dd/MM/yyyy"
                    value={form.birth_date}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        birth_date: formatDobSmart(e.target.value, prev.birth_date),
                      }))
                    }
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
                  <label>
                    <span className="req">*</span>Nội dung làm việc
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="VD: Họp đối tác, phỏng vấn, bảo trì..."
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
                    <option value="Sảnh Chính (Cổng Làn Vào & Làn Ra)">Sảnh Chính (Cổng Làn Vào &amp; Làn Ra)</option>
                    <option value="Khu vực Văn phòng & Phòng họp">Khu vực Văn phòng &amp; Phòng họp</option>
                    <option value="Khu vực Kỹ thuật & Nhà máy">Khu vực Kỹ thuật &amp; Nhà máy</option>
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
                    onChange={(e) => setForm({ ...form, department: e.target.value, host_person: '', host_phone: '' })}
                  >
                    {departments.map((d) => (
                      <option key={d.id || d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="v-field" style={{ position: 'relative' }}>
                  <label>
                    <span className="req">*</span>Người liên hệ ({deptEmployees.length} thuộc {form.department})
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    className="v-input"
                    placeholder="Gõ không dấu hoặc chọn nhanh..."
                    value={form.host_person}
                    onFocus={() => setFocusedField('host_person')}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'host_person' ? null : f)), 160)}
                    onChange={(e) => {
                      setForm({ ...form, host_person: e.target.value });
                      setFocusedField('host_person');
                    }}
                  />
                  {focusedField === 'host_person' && (
                    <div className="guest-suggest-popover" style={{ maxHeight: 220, overflowY: 'auto' }}>
                      <div className="guest-suggest-header">
                        <span>NHÂN SỰ ({filteredHostEmployees.length})</span>
                      </div>
                      {filteredHostEmployees.map((emp, idx) => {
                        const empName = emp.fullname || emp.FullName || '';
                        const empPhone = emp.phone || emp.Phone || '';
                        return (
                          <div
                            key={emp.atid || idx}
                            className="guest-suggest-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setForm((prev) => ({
                                ...prev,
                                host_person: empName,
                                host_phone: empPhone || prev.host_phone,
                              }));
                              setFocusedField(null);
                            }}
                          >
                            <div>
                              <div className="guest-suggest-name">{empName}</div>
                              <div className="guest-suggest-meta">
                                {emp.department || emp.DepartmentName}
                                {empPhone ? ` · ${empPhone}` : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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

                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 12,
                    color: '#92400e',
                  }}
                >
                  <strong>Trạng thái khi lưu: Chờ cấp thẻ (PENDING)</strong>
                  <div style={{ marginTop: 3, fontSize: 11.5 }}>
                    Hồ sơ sẽ hiện sẵn ở quầy Lễ tân. Khi khách đến, Lễ tân chỉ cần quẹt thẻ NFC là kích hoạt cửa ngay.
                  </div>
                </div>
              </div>
            </div>

            {/* NHÂN SỰ ĐI CÙNG */}
            <div className="companion-section">
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                Thông tin nhân sự đi cùng ({companions.length})
              </div>
              <div className="companion-bar" style={{ gridTemplateColumns: '1.2fr 0.9fr 1fr 1fr 1fr auto' }}>
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
                    <span className="req">*</span>Ngày sinh
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    className="v-input"
                    placeholder="dd/MM/yyyy"
                    value={compForm.birth_date}
                    onChange={(e) =>
                      setCompForm((prev) => ({
                        ...prev,
                        birth_date: formatDobSmart(e.target.value, prev.birth_date),
                      }))
                    }
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
                  <label>Từ thời gian</label>
                  <input
                    type="text"
                    className="v-input"
                    value={compForm.from_time}
                    onChange={(e) => setCompForm({ ...compForm, from_time: e.target.value })}
                  />
                </div>
                <div className="v-field">
                  <label>Đến thời gian</label>
                  <input
                    type="text"
                    className="v-input"
                    value={compForm.to_time}
                    onChange={(e) => setCompForm({ ...compForm, to_time: e.target.value })}
                  />
                </div>
                <div style={{ paddingTop: 21 }}>
                  <button type="button" className="btn-qr-navy" style={{ height: 36 }} onClick={handleAddCompanion}>
                    + Thêm nhanh
                  </button>
                </div>
              </div>
              {companions.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#334155' }}>
                  {companions.map((c, idx) => (
                    <span
                      key={idx}
                      className="badge"
                      style={{ marginRight: 6, background: '#f1f5f9', padding: '4px 8px' }}
                    >
                      {c.full_name} ({c.cccd_number})
                      <button
                        type="button"
                        onClick={() => setCompanions((p) => p.filter((_, i) => i !== idx))}
                        style={{ border: 'none', background: 'none', marginLeft: 6, cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  handleResetForm();
                  setIsFormOpen(false);
                }}
              >
                Hủy bỏ &amp; Thu gọn
              </button>
              <button type="submit" className="btn btn-gold" style={{ padding: '0 24px', height: 36 }} disabled={submitting}>
                {submitting ? 'Đang lưu...' : 'Lưu Lịch hẹn'}
              </button>
            </div>
          </form>
        )}

        {/* PENDING APPOINTMENTS TABLE */}
        {!isFormOpen && (
          <div className="card card-table-fill">
            <div className="card-header" style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="card-title">Danh sách Khách mời &amp; Lịch hẹn ({filteredAppointments.length})</div>
                <div className="tino-search-bar" style={{ marginTop: 0, padding: '6px 12px', width: 260 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input
                    type="text"
                    placeholder="Tìm tên khách, CCCD, công ty..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              <span className="badge badge-gold">Trạng thái: PENDING (Chờ cấp thẻ)</span>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>#</th>
                    <th>Khách hàng &amp; Định danh</th>
                    <th>Công ty &amp; Nội dung</th>
                    <th>Phòng ban / Người liên hệ</th>
                    <th>Thời gian hẹn</th>
                    <th>Trạng thái</th>
                    {canAssignCard && <th>Quẹt thẻ cấp ngay</th>}
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.length === 0 ? (
                    <tr>
                      <td colSpan={canAssignCard ? 8 : 7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Chưa có lịch hẹn nào đang chờ cấp thẻ. Bấm &quot;+ Đặt lịch hẹn khách&quot; để tạo mới.
                      </td>
                    </tr>
                  ) : (
                    filteredAppointments.map((apt, idx) => (
                      <tr key={apt.id || idx}>
                        <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                        <td>
                          <div style={{ fontWeight: 700, color: '#111111' }}>{apt.full_name}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            CCCD: {apt.cccd_number || '—'}
                            {apt.phone ? ` · ${apt.phone}` : ''}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{apt.company || '—'}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{apt.purpose || '—'}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{apt.department || '—'}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Gặp: {apt.host_person || '—'} {apt.host_phone ? `(${apt.host_phone})` : ''}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                          <div>Từ: {String(apt.checkin_time || '').slice(0, 16)}</div>
                          <div>Đến: {String(apt.expected_checkout_time || '').slice(0, 16) || '—'}</div>
                        </td>
                        <td>
                          <span className="badge badge-gold">PENDING · Chờ cấp thẻ</span>
                        </td>
                        {canAssignCard && (
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="text"
                                className="v-input"
                                style={{ width: 145, height: 30, fontSize: 12 }}
                                placeholder="Quẹt thẻ..."
                                value={assignCardMap[apt.id] || ''}
                                onChange={(e) => setAssignCardMap((p) => ({ ...p, [apt.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAssignCardNow(apt);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={assigningId === apt.id}
                                onClick={() => handleAssignCardNow(apt)}
                              >
                                {assigningId === apt.id ? '...' : 'Cấp'}
                              </button>
                            </div>
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#dc2626' }}
                            onClick={() => handleCancelAppointment(apt)}
                          >
                            Hủy hẹn
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
