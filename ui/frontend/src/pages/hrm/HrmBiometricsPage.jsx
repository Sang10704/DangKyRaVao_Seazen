import React, { useState } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function HrmBiometricsPage({
  onCollapseSidebar,
  departments,
  employees,
  empTotal,
  empSearch,
  setEmpSearch,
  empDeptFilter,
  setEmpDeptFilter,
  onRefreshData,
  notify,
}) {
  const [subTab, setSubTab] = useState('employees');

  const [empForm, setEmpForm] = useState({
    EmployeeATID: '',
    EmployeeCode: '',
    FullName: '',
    DepartmentName: 'HC QTNS',
    Position: 'Chuyên viên',
    CardNumber: '',
    Privilege: 0,
    Email: '',
    Phone: '',
    HasFace: true,
    HasFinger: false,
    FacePhotoBase64: '',
    sync_to_hardware: false,
  });

  const [deptForm, setDeptForm] = useState({
    DepartmentCode: '',
    DepartmentName: '',
    Level: 1,
    Location: 'Trụ sở SeaZen',
    Description: '',
  });

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEmpForm((prev) => ({
        ...prev,
        FacePhotoBase64: String(reader.result || ''),
        HasFace: true,
      }));
    };
    reader.readAsDataURL(file);
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
                <rect x="3" y="4" width="18" height="17" rx="2"></rect>
                <circle cx="9" cy="10" r="2"></circle>
                <path d="M5 17c0-2 1.5-3 4-3s4 1 4 3M15 9h4M15 13h4M15 17h4"></path>
              </svg>
            </div>
            <div>
              <h1 className="topbar-title">Quản lý Nhân sự, Phòng ban & Hồ sơ Sinh trắc học</h1>
              <div className="topbar-sub">
                Quản lý danh bạ nhân sự đang công tác, mã nhận diện khuôn mặt, số thẻ từ và cơ cấu phòng ban
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="subtab-bar">
        <button
          type="button"
          className={`subtab-btn ${subTab === 'employees' ? 'active' : ''}`}
          onClick={() => setSubTab('employees')}
        >
          <span>Nhân sự đang công tác & Khuôn mặt ({empTotal} hồ sơ)</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'departments' ? 'active' : ''}`}
          onClick={() => setSubTab('departments')}
        >
          <span>Danh mục Phòng ban ({departments.length})</span>
        </button>
      </div>

      <div className="content-wrap">
        {subTab === 'employees' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Biểu mẫu Cập nhật Nhân sự & Sinh trắc học</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/hrm/employee', {
                      method: 'POST',
                      body: JSON.stringify(empForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu hồ sơ nhân sự.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Mã định danh chấm công *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={empForm.EmployeeATID}
                        onChange={(e) => setEmpForm({ ...empForm, EmployeeATID: e.target.value })}
                        placeholder="Ví dụ: 10903"
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Mã số nhân viên</label>
                      <input
                        type="text"
                        className="form-control"
                        value={empForm.EmployeeCode}
                        onChange={(e) => setEmpForm({ ...empForm, EmployeeCode: e.target.value })}
                        placeholder="Ví dụ: SZ10903"
                      />
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Họ và tên nhân sự *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={empForm.FullName}
                      onChange={(e) => setEmpForm({ ...empForm, FullName: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Phòng ban công tác</label>
                      <select
                        className="form-control"
                        value={empForm.DepartmentName}
                        onChange={(e) => setEmpForm({ ...empForm, DepartmentName: e.target.value })}
                      >
                        {departments.map((d) => (
                          <option key={d.DepartmentID} value={d.DepartmentName}>
                            {d.DepartmentName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Chức vụ</label>
                      <input
                        type="text"
                        className="form-control"
                        value={empForm.Position}
                        onChange={(e) => setEmpForm({ ...empForm, Position: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Số thẻ từ</label>
                      <input
                        type="text"
                        className="form-control"
                        value={empForm.CardNumber}
                        onChange={(e) => setEmpForm({ ...empForm, CardNumber: e.target.value })}
                        placeholder="Quẹt thẻ lên đầu đọc..."
                      />
                    </div>
                    <div className="field-group">
                      <label>Vai trò trên thiết bị cổng</label>
                      <select
                        className="form-control"
                        value={empForm.Privilege}
                        onChange={(e) => setEmpForm({ ...empForm, Privilege: Number(e.target.value) })}
                      >
                        <option value={0}>Nhân sự tiêu chuẩn</option>
                        <option value={14}>Quản trị thiết bị</option>
                      </select>
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Ảnh chân dung nhận diện</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      style={{ fontSize: 12 }}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={empForm.sync_to_hardware}
                      onChange={(e) => setEmpForm({ ...empForm, sync_to_hardware: e.target.checked })}
                    />
                    <span style={{ fontWeight: 500 }}>
                      Nạp trực tiếp thông tin nhân sự xuống 4 thiết bị cổng ngay sau khi lưu
                    </span>
                  </label>

                  <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }}>
                    Lưu Hồ Sơ Nhân Sự & Sinh Trắc Học
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh sách Nhân sự đang công tác ({empTotal})</div>
                <div className="filter-bar">
                  <select
                    className="form-control"
                    value={empDeptFilter}
                    onChange={(e) => setEmpDeptFilter(e.target.value)}
                    style={{ width: 175 }}
                  >
                    <option value="">Tất cả phòng ban</option>
                    {departments.map((d) => (
                      <option key={d.DepartmentID} value={d.DepartmentName}>
                        {d.DepartmentName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="form-control"
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Tìm tên, mã chấm công, số thẻ..."
                    style={{ width: 220 }}
                  />
                </div>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã chấm công</th>
                      <th>Họ và tên</th>
                      <th>Phòng ban</th>
                      <th>Số thẻ từ</th>
                      <th>Trạng thái sinh trắc</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp, idx) => (
                      <tr
                        key={idx}
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          setEmpForm({
                            EmployeeATID: emp.atid || emp.EmployeeATID || '',
                            EmployeeCode: emp.code || emp.EmployeeCode || '',
                            FullName: emp.fullname || emp.FullName || '',
                            DepartmentName: emp.department || emp.DepartmentName || 'HC QTNS',
                            Position: emp.position || emp.Position || '',
                            CardNumber: emp.card_number || emp.CardNumber || '',
                            Privilege: 0,
                            Email: emp.email || '',
                            Phone: emp.phone || '',
                            HasFace: true,
                            HasFinger: false,
                            FacePhotoBase64: '',
                            sync_to_hardware: false,
                          })
                        }
                      >
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {emp.atid || emp.EmployeeATID}
                        </td>
                        <td style={{ fontWeight: 600 }}>{emp.fullname || emp.FullName}</td>
                        <td>{emp.department || emp.DepartmentName}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>
                          {emp.card_number || emp.CardNumber || '---'}
                        </td>
                        <td>
                          <span className="badge badge-green">Khuôn mặt</span>
                          {(emp.card_number || emp.CardNumber) && (
                            <span className="badge badge-blue" style={{ marginLeft: 4 }}>
                              Thẻ từ
                            </span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="btn btn-sm">
                            Chọn sửa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {subTab === 'departments' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Thêm / Cập nhật Phòng ban</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/hrm/department', {
                      method: 'POST',
                      body: JSON.stringify(deptForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      setDeptForm({
                        DepartmentCode: '',
                        DepartmentName: '',
                        Level: 1,
                        Location: 'Trụ sở SeaZen',
                        Description: '',
                      });
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu phòng ban.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="field-group">
                    <label>Mã phòng ban</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deptForm.DepartmentCode}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentCode: e.target.value })}
                      placeholder="Ví dụ: PB-HCNS"
                    />
                  </div>
                  <div className="field-group">
                    <label>Tên phòng ban *</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deptForm.DepartmentName}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field-group">
                    <label>Địa điểm làm việc</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deptForm.Location}
                      onChange={(e) => setDeptForm({ ...deptForm, Location: e.target.value })}
                    />
                  </div>
                  <div className="field-group">
                    <label>Ghi chú</label>
                    <input
                      type="text"
                      className="form-control"
                      value={deptForm.Description}
                      onChange={(e) => setDeptForm({ ...deptForm, Description: e.target.value })}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Lưu Phòng Ban
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh mục Phòng ban ({departments.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>STT</th>
                      <th>Mã phòng ban</th>
                      <th>Tên phòng ban</th>
                      <th>Cấp bậc</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d, idx) => (
                      <tr key={d.DepartmentID}>
                        <td>{idx + 1}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{d.DepartmentCode}</td>
                        <td style={{ fontWeight: 600 }}>{d.DepartmentName}</td>
                        <td>Cấp {d.Level}</td>
                        <td>
                          <span className="badge badge-green">Đang hoạt động</span>
                        </td>
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
