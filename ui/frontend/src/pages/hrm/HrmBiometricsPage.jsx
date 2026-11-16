import React, { useState } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function HrmBiometricsPage({
  mode = 'hrm', // 'hrm' or 'biometrics'
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
    FaceTemplateBIODATA: '',
    sync_to_hardware: true,
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
    <div className="tino-body">
      <div className="tino-center">
        <div style={{ marginBottom: 14, flexShrink: 0 }}>
          <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
            {mode === 'biometrics' ? 'Quản lý Khuôn mặt, Vân tay & Thẻ NFC' : 'Quản lý Danh bạ Nội bộ'}
          </div>
          <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
            {mode === 'biometrics'
              ? `Dữ liệu Sinh trắc học (${empTotal} hồ sơ)`
              : `Nhân viên & Phòng ban (${empTotal} nhân sự · ${departments.length} phòng ban)`}
          </h1>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '370px 1fr',
            gap: 18,
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Left Column: Employee / Biometrics / Department Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', paddingRight: 4 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                {mode === 'biometrics'
                  ? 'Cập nhật Sinh trắc học & Nạp xuống 4 Máy Cửa'
                  : 'Thêm / Cập nhật Nhân viên'}
              </div>
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
                    notify(data.error || 'Không thể lưu thông tin nhân viên.', 'error');
                  }
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="v-field">
                    <label>
                      <span className="req">*</span>Mã chấm công (ATID)
                    </label>
                    <input
                      type="text"
                      className="v-input"
                      value={empForm.EmployeeATID}
                      onChange={(e) => setEmpForm({ ...empForm, EmployeeATID: e.target.value })}
                      placeholder="VD: 10903"
                      required
                    />
                  </div>
                  <div className="v-field">
                    <label>Mã nhân viên HR</label>
                    <input
                      type="text"
                      className="v-input"
                      value={empForm.EmployeeCode}
                      onChange={(e) => setEmpForm({ ...empForm, EmployeeCode: e.target.value })}
                    />
                  </div>
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Họ và tên nhân viên
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={empForm.FullName}
                    onChange={(e) => setEmpForm({ ...empForm, FullName: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="v-field">
                    <label>Phòng ban</label>
                    <select
                      className="v-input"
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
                  <div className="v-field">
                    <label>Mã thẻ từ NFC</label>
                    <input
                      type="text"
                      className="v-input"
                      value={empForm.CardNumber}
                      onChange={(e) => setEmpForm({ ...empForm, CardNumber: e.target.value })}
                      placeholder="Quẹt thẻ..."
                    />
                  </div>
                </div>

                <div className="v-field">
                  <label>Ảnh chân dung nhận diện (Đồng bộ đính kèm)</label>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ fontSize: 12 }} />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={empForm.sync_to_hardware}
                    onChange={(e) => setEmpForm({ ...empForm, sync_to_hardware: e.target.checked })}
                  />
                  <span>Đồng bộ trực tiếp xuống 4 máy quét mặt tại cổng</span>
                </label>

                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Lưu Hồ Sơ & Đồng Bộ
                </button>
              </form>
            </div>
          </div>

          {mode === 'hrm' && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Thêm Phòng ban mới ({departments.length})</div>
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
                      setDeptForm({ DepartmentCode: '', DepartmentName: '', Level: 1, Location: 'Trụ sở SeaZen', Description: '' });
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu phòng ban.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="v-field">
                    <label>
                      <span className="req">*</span>Tên phòng ban
                    </label>
                    <input
                      type="text"
                      className="v-input"
                      value={deptForm.DepartmentName}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentName: e.target.value })}
                      required
                    />
                  </div>
                  <button type="submit" className="btn btn-gold">
                    Thêm Phòng Ban
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Employee & Biometrics Table */}
        <div className="card card-table-fill">
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div className="card-title">
              Danh sách Nhân viên & Trạng thái Sinh trắc học ({empTotal})
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <select
                className="v-input"
                style={{ width: 170 }}
                value={empDeptFilter}
                onChange={(e) => setEmpDeptFilter(e.target.value)}
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
                className="v-input"
                style={{ width: 220 }}
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                placeholder="Tìm tên, mã ATID, mã thẻ..."
              />
            </div>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã ATID</th>
                  <th>Họ và tên</th>
                  <th>Phòng ban</th>
                  <th>Mã thẻ NFC</th>
                  <th>Dữ liệu Khuôn mặt</th>
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
                        FaceTemplateBIODATA: '',
                        sync_to_hardware: true,
                      })
                    }
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {emp.atid || emp.EmployeeATID}
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--jet)' }}>
                      {emp.fullname || emp.FullName}
                    </td>
                    <td>{emp.department || emp.DepartmentName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {emp.card_number || emp.CardNumber || '---'}
                    </td>
                    <td>
                      <span className="badge badge-green">Khuôn mặt đã đăng ký</span>
                      {(emp.card_number || emp.CardNumber) && (
                        <span className="badge badge-gold" style={{ marginLeft: 6 }}>
                          Thẻ NFC
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
      </div>
    </div>
  );
}
