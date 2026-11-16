import React, { useState } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function VisitorManagementPage({
  onCollapseSidebar,
  departments,
  activeVisitors,
  visitorHistory,
  customerCards,
  preGuests,
  contractors,
  onRefreshData,
  notify,
}) {
  const [subTab, setSubTab] = useState('checkin');
  const [qrInput, setQrInput] = useState('');
  const [checkoutQuery, setCheckoutQuery] = useState('');

  const [visitorForm, setVisitorForm] = useState({
    full_name: '',
    cccd_number: '',
    phone: '',
    company: '',
    department: 'BGĐ SeaZen',
    host_person: '',
    purpose: 'Liên hệ công tác',
    card_number: '',
    auto_unlock: false,
  });

  const [preGuestForm, setPreGuestForm] = useState({
    BookingCode: '',
    GuestFullName: '',
    GuestCCCD: '',
    GuestPhone: '',
    GuestCompany: '',
    HostEmployeeName: '',
    HostDepartment: 'BGĐ SeaZen',
    VisitDate: new Date().toISOString().slice(0, 10),
    StartTime: '08:30',
    EndTime: '17:30',
    Purpose: '',
    ReservedCardNumber: '',
    Status: 'PENDING',
  });

  const [contractorForm, setContractorForm] = useState({
    ContractorCode: '',
    ContractorCompany: '',
    WorkerFullName: '',
    CCCDNumber: '',
    Phone: '',
    CardNumber: '',
    WorkArea: 'Khu vực Sảnh & Tầng Kỹ Thuật',
    SupervisorName: 'HC QTNS',
    ValidFrom: new Date().toISOString().slice(0, 10),
    ValidTo: new Date().toISOString().slice(0, 10),
    Status: 'ACTIVE',
  });

  const [cardForm, setCardForm] = useState({
    CardCode: '',
    CardNumber: '',
    CardType: 'VISITOR',
    Status: 'AVAILABLE',
    Notes: '',
  });

  const handleParseQr = async (raw) => {
    setQrInput(raw);
    if (!raw.includes('|')) return;
    const { ok, data } = await apiFetch('/api/visitor/parse_cccd', {
      method: 'POST',
      body: JSON.stringify({ qr_string: raw }),
    });
    if (ok && data.success && data.data) {
      const p = data.data;
      setVisitorForm((prev) => ({
        ...prev,
        cccd_number: p.cccd_number || prev.cccd_number,
        full_name: p.full_name || prev.full_name,
      }));
      notify(`Đã điền thông tin từ căn cước công dân: ${p.full_name}`, 'success');
    }
  };

  const handleRegisterVisitor = async (e) => {
    e.preventDefault();
    const { ok, data } = await apiFetch('/api/visitor/register', {
      method: 'POST',
      body: JSON.stringify(visitorForm),
    });
    if (ok && data.success) {
      notify(data.message || 'Đã đăng ký khách và cấp quyền thẻ thành công.', 'success');
      setVisitorForm({
        full_name: '',
        cccd_number: '',
        phone: '',
        company: '',
        department: 'BGĐ SeaZen',
        host_person: '',
        purpose: 'Liên hệ công tác',
        card_number: '',
        auto_unlock: false,
      });
      setQrInput('');
      onRefreshData();
    } else {
      notify(data.error || 'Không thể lưu hồ sơ khách.', 'error');
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
      notify(data.message || 'Đã hoàn tất trả thẻ cho khách.', 'success');
      setCheckoutQuery('');
      onRefreshData();
    } else {
      notify(data.error || 'Không tìm thấy khách đang có mặt.', 'error');
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onCollapseSidebar}
            title="Thu gọn thanh điều hướng"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

          <div className="topbar-title-wrap">
            <div className="topbar-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M19 8v6M22 11h-6"></path>
              </svg>
            </div>
            <div>
              <h1 className="topbar-title">Tiếp đón Khách, Lịch hẹn trước & Quản lý Nhà thầu</h1>
              <div className="topbar-sub">
                Quét mã căn cước công dân, cấp phát thẻ ra vào tạm thời và thu hồi quyền thẻ tự động khi khách ra về
              </div>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <a href="/api/export/visitors" className="btn btn-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Xuất báo cáo Excel</span>
          </a>
        </div>
      </header>

      <div className="subtab-bar">
        <button
          type="button"
          className={`subtab-btn ${subTab === 'checkin' ? 'active' : ''}`}
          onClick={() => setSubTab('checkin')}
        >
          <span>Tiếp đón & Cấp thẻ khách ({activeVisitors.length} đang có mặt)</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'prereg' ? 'active' : ''}`}
          onClick={() => setSubTab('prereg')}
        >
          <span>Danh sách Khách hẹn trước ({preGuests.length})</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'contractors' ? 'active' : ''}`}
          onClick={() => setSubTab('contractors')}
        >
          <span>Hồ sơ Nhà thầu Thi công ({contractors.length})</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'cards' ? 'active' : ''}`}
          onClick={() => setSubTab('cards')}
        >
          <span>Kho Thẻ Khách & Nhà thầu ({customerCards.length})</span>
        </button>
      </div>

      <div className="content-wrap">
        {subTab === 'checkin' && (
          <div className="split-layout">
            {/* Left Form */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Biểu mẫu Tiếp đón Khách & Cấp thẻ</div>
              </div>
              <div className="card-body">
                <form onSubmit={handleRegisterVisitor} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="field-group">
                    <label>Quét mã căn cước công dân gắn chip (Tự động tách thông tin)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={qrInput}
                      onChange={(e) => handleParseQr(e.target.value)}
                      placeholder="Đặt con trỏ tại đây và bấm máy quét mã..."
                      style={{ background: 'var(--primary-soft)', borderColor: 'var(--primary-border)' }}
                    />
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Họ và tên khách *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={visitorForm.full_name}
                        onChange={(e) => setVisitorForm({ ...visitorForm, full_name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Số căn cước công dân *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={visitorForm.cccd_number}
                        onChange={(e) => setVisitorForm({ ...visitorForm, cccd_number: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Số điện thoại</label>
                      <input
                        type="text"
                        className="form-control"
                        value={visitorForm.phone}
                        onChange={(e) => setVisitorForm({ ...visitorForm, phone: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Đơn vị / Công ty khách</label>
                      <input
                        type="text"
                        className="form-control"
                        value={visitorForm.company}
                        onChange={(e) => setVisitorForm({ ...visitorForm, company: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Phòng ban liên hệ</label>
                      <select
                        className="form-control"
                        value={visitorForm.department}
                        onChange={(e) => setVisitorForm({ ...visitorForm, department: e.target.value })}
                      >
                        {departments.map((d) => (
                          <option key={d.DepartmentID} value={d.DepartmentName}>
                            {d.DepartmentName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Cán bộ tiếp đón</label>
                      <input
                        type="text"
                        className="form-control"
                        value={visitorForm.host_person}
                        onChange={(e) => setVisitorForm({ ...visitorForm, host_person: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Số thẻ từ cấp tạm</label>
                      <input
                        type="text"
                        list="visitor-card-pool"
                        className="form-control"
                        value={visitorForm.card_number}
                        onChange={(e) => setVisitorForm({ ...visitorForm, card_number: e.target.value })}
                        placeholder="Quẹt thẻ hoặc chọn từ kho..."
                      />
                      <datalist id="visitor-card-pool">
                        {customerCards.map((c) => (
                          <option key={c.CardNumber} value={c.CardNumber}>
                            {c.CardCode}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div className="field-group">
                      <label>Nội dung làm việc</label>
                      <input
                        type="text"
                        className="form-control"
                        value={visitorForm.purpose}
                        onChange={(e) => setVisitorForm({ ...visitorForm, purpose: e.target.value })}
                      />
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={visitorForm.auto_unlock}
                      onChange={(e) => setVisitorForm({ ...visitorForm, auto_unlock: e.target.checked })}
                    />
                    <span style={{ fontWeight: 500 }}>Mở Cổng Làn VÀO ngay sau khi lưu đăng ký</span>
                  </label>

                  <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }}>
                    Lưu Hồ Sơ Khách & Cấp Quyền Qua Cổng
                  </button>
                </form>
              </div>
            </div>

            {/* Right Active Visitors & History */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Trả thẻ nhanh & Danh sách Khách đang làm việc</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      className="form-control"
                      value={checkoutQuery}
                      onChange={(e) => setCheckoutQuery(e.target.value)}
                      placeholder="Quẹt thẻ trả lại hoặc nhập số CCCD..."
                      style={{ width: 240 }}
                    />
                    <button type="button" className="btn btn-primary" onClick={() => handleFastCheckout()}>
                      Trả thẻ & Ra về
                    </button>
                  </div>
                </div>
                <div className="table-scroll" style={{ maxHeight: 220 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Họ và tên khách</th>
                        <th>Số căn cước</th>
                        <th>Mã thẻ</th>
                        <th>Phòng ban / Người tiếp</th>
                        <th>Giờ vào</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeVisitors.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                            Hiện không có khách nào đang giữ thẻ trong tòa nhà.
                          </td>
                        </tr>
                      ) : (
                        activeVisitors.map((v) => (
                          <tr key={v.id}>
                            <td style={{ fontWeight: 600 }}>{v.full_name}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{v.cccd_number}</td>
                            <td>
                              <span className="badge badge-blue">{v.card_number || 'Không thẻ'}</span>
                            </td>
                            <td>{v.department} · {v.host_person}</td>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{v.checkin_time}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => handleFastCheckout(v.id)}
                              >
                                Thu hồi thẻ
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div className="card-title">Sổ Nhật ký Khách Ra vào ({visitorHistory.length})</div>
                </div>
                <div className="table-scroll" style={{ maxHeight: 260 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Mã hồ sơ</th>
                        <th>Họ và tên khách</th>
                        <th>Số căn cước</th>
                        <th>Mã thẻ</th>
                        <th>Phòng ban liên hệ</th>
                        <th>Giờ vào</th>
                        <th>Giờ ra</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visitorHistory.map((h, idx) => (
                        <tr key={idx}>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{h.VisitorID}</td>
                          <td style={{ fontWeight: 600 }}>{h.FullName}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{h.CCCDNumber}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{h.CardNumber || '---'}</td>
                          <td>{h.Department}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{h.CheckinTime}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{h.CheckoutTime || '---'}</td>
                          <td>
                            <span className={`badge ${h.Status === 'ACTIVE' ? 'badge-green' : 'badge-blue'}`}>
                              {h.Status === 'ACTIVE' ? 'Đang có mặt' : 'Đã ra về'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {subTab === 'prereg' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Đăng ký Lịch hẹn Khách trước</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/visitor/pre_register', {
                      method: 'POST',
                      body: JSON.stringify(preGuestForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu lịch hẹn.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Họ và tên khách hẹn *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.GuestFullName}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestFullName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Số căn cước công dân</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.GuestCCCD}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestCCCD: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Số điện thoại</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.GuestPhone}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestPhone: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Đơn vị công tác</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.GuestCompany}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestCompany: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Cán bộ bảo lãnh *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.HostEmployeeName}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, HostEmployeeName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Phòng ban bảo lãnh</label>
                      <select
                        className="form-control"
                        value={preGuestForm.HostDepartment}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, HostDepartment: e.target.value })}
                      >
                        {departments.map((d) => (
                          <option key={d.DepartmentID} value={d.DepartmentName}>
                            {d.DepartmentName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-grid-3">
                    <div className="field-group">
                      <label>Ngày hẹn</label>
                      <input
                        type="date"
                        className="form-control"
                        value={preGuestForm.VisitDate}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, VisitDate: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Giờ bắt đầu</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.StartTime}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, StartTime: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Giờ kết thúc</label>
                      <input
                        type="text"
                        className="form-control"
                        value={preGuestForm.EndTime}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, EndTime: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Nội dung làm việc</label>
                    <input
                      type="text"
                      className="form-control"
                      value={preGuestForm.Purpose}
                      onChange={(e) => setPreGuestForm({ ...preGuestForm, Purpose: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary">
                    Lưu Lịch Hẹn Khách Trước
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh sách Khách đã đăng ký hẹn trước ({preGuests.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã lịch hẹn</th>
                      <th>Họ và tên khách</th>
                      <th>Đơn vị</th>
                      <th>Cán bộ bảo lãnh</th>
                      <th>Ngày / Khung giờ</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preGuests.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                          Chưa có lịch hẹn khách trước nào.
                        </td>
                      </tr>
                    ) : (
                      preGuests.map((g, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{g.BookingCode}</td>
                          <td style={{ fontWeight: 600 }}>{g.GuestFullName}</td>
                          <td>{g.GuestCompany || '---'}</td>
                          <td>{g.HostEmployeeName} ({g.HostDepartment})</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{g.VisitDate} · {g.StartTime}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setVisitorForm({
                                  full_name: g.GuestFullName || '',
                                  cccd_number: g.GuestCCCD || '',
                                  phone: g.GuestPhone || '',
                                  company: g.GuestCompany || '',
                                  department: g.HostDepartment || 'BGĐ SeaZen',
                                  host_person: g.HostEmployeeName || '',
                                  purpose: g.Purpose || 'Theo lịch hẹn trước',
                                  card_number: g.ReservedCardNumber || '',
                                  auto_unlock: false,
                                });
                                setSubTab('checkin');
                              }}
                            >
                              Tiếp nhận vào cổng
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {subTab === 'contractors' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Biểu mẫu Đăng ký Nhân sự Nhà thầu</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/visitor/contractor', {
                      method: 'POST',
                      body: JSON.stringify(contractorForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu hồ sơ nhà thầu.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="field-group">
                    <label>Tên đơn vị nhà thầu thi công *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={contractorForm.ContractorCompany}
                      onChange={(e) => setContractorForm({ ...contractorForm, ContractorCompany: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Họ và tên nhân sự thi công *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={contractorForm.WorkerFullName}
                        onChange={(e) => setContractorForm({ ...contractorForm, WorkerFullName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Số căn cước công dân</label>
                      <input
                        type="text"
                        className="form-control"
                        value={contractorForm.CCCDNumber}
                        onChange={(e) => setContractorForm({ ...contractorForm, CCCDNumber: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Mã thẻ cấp phát</label>
                      <input
                        type="text"
                        className="form-control"
                        value={contractorForm.CardNumber}
                        onChange={(e) => setContractorForm({ ...contractorForm, CardNumber: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Khu vực làm việc</label>
                      <input
                        type="text"
                        className="form-control"
                        value={contractorForm.WorkArea}
                        onChange={(e) => setContractorForm({ ...contractorForm, WorkArea: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Hiệu lực từ ngày</label>
                      <input
                        type="date"
                        className="form-control"
                        value={contractorForm.ValidFrom}
                        onChange={(e) => setContractorForm({ ...contractorForm, ValidFrom: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Hiệu lực đến ngày</label>
                      <input
                        type="date"
                        className="form-control"
                        value={contractorForm.ValidTo}
                        onChange={(e) => setContractorForm({ ...contractorForm, ValidTo: e.target.value })}
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Lưu Hồ Sơ Nhà Thầu
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh sách Nhân sự Nhà thầu ({contractors.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã hồ sơ</th>
                      <th>Đơn vị nhà thầu</th>
                      <th>Họ tên nhân sự</th>
                      <th>Số căn cước</th>
                      <th>Mã thẻ</th>
                      <th>Khu vực</th>
                      <th>Thời hạn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractors.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                          Chưa có hồ sơ nhà thầu thi công nào.
                        </td>
                      </tr>
                    ) : (
                      contractors.map((c, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.ContractorCode}</td>
                          <td>{c.ContractorCompany}</td>
                          <td style={{ fontWeight: 600 }}>{c.WorkerFullName}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.CCCDNumber}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.CardNumber}</td>
                          <td>{c.WorkArea}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.ValidFrom} → {c.ValidTo}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {subTab === 'cards' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Khai báo Thẻ mới vào Kho thẻ</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/visitor/card', {
                      method: 'POST',
                      body: JSON.stringify(cardForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      setCardForm({ CardCode: '', CardNumber: '', CardType: 'VISITOR', Status: 'AVAILABLE', Notes: '' });
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu thẻ.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Mã định danh thẻ</label>
                      <input
                        type="text"
                        className="form-control"
                        value={cardForm.CardCode}
                        onChange={(e) => setCardForm({ ...cardForm, CardCode: e.target.value })}
                        placeholder="Ví dụ: THE-KHACH-01"
                      />
                    </div>
                    <div className="field-group">
                      <label>Số thẻ từ *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={cardForm.CardNumber}
                        onChange={(e) => setCardForm({ ...cardForm, CardNumber: e.target.value })}
                        placeholder="Quẹt thẻ lên đầu đọc..."
                        required
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Nhóm thẻ</label>
                      <select
                        className="form-control"
                        value={cardForm.CardType}
                        onChange={(e) => setCardForm({ ...cardForm, CardType: e.target.value })}
                      >
                        <option value="VISITOR">Thẻ Khách liên hệ</option>
                        <option value="CONTRACTOR">Thẻ Nhà thầu</option>
                        <option value="VIP">Thẻ Khách ưu tiên</option>
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Trạng thái thẻ</label>
                      <select
                        className="form-control"
                        value={cardForm.Status}
                        onChange={(e) => setCardForm({ ...cardForm, Status: e.target.value })}
                      >
                        <option value="AVAILABLE">Sẵn sàng cấp phát</option>
                        <option value="ASSIGNED">Đang cấp cho khách</option>
                        <option value="LOCKED">Tạm khóa</option>
                      </select>
                    </div>
                  </div>
                  <div className="field-group">
                    <label>Ghi chú</label>
                    <input
                      type="text"
                      className="form-control"
                      value={cardForm.Notes}
                      onChange={(e) => setCardForm({ ...cardForm, Notes: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Lưu Vào Kho Thẻ
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh mục Thẻ Khách & Nhà thầu ({customerCards.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã định danh thẻ</th>
                      <th>Số thẻ từ</th>
                      <th>Nhóm thẻ</th>
                      <th>Trạng thái</th>
                      <th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerCards.map((c, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{c.CardCode}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--primary)' }}>
                          {c.CardNumber}
                        </td>
                        <td>{c.CardType === 'CONTRACTOR' ? 'Nhà thầu' : 'Khách liên hệ'}</td>
                        <td>
                          <span className={`badge ${c.Status === 'AVAILABLE' ? 'badge-green' : 'badge-amber'}`}>
                            {c.Status === 'AVAILABLE' ? 'Sẵn sàng' : 'Đang sử dụng'}
                          </span>
                        </td>
                        <td>{c.Notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
