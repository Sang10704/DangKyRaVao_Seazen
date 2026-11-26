import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function HrmDirectoryPage({
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
  const [subTab, setSubTab] = useState('EMPLOYEES'); // 'EMPLOYEES' | 'DEPARTMENTS'
  const [includeInactive, setIncludeInactive] = useState(false);
  const [allEmployeesList, setAllEmployeesList] = useState(employees || []);
  const [loadingList, setLoadingList] = useState(false);
  const [syncingSp, setSyncingSp] = useState(false);

  const [empForm, setEmpForm] = useState({
    EmployeeATID: '',
    EmployeeCode: '',
    FullName: '',
    DepartmentName: 'HC QTNS',
    Position: '',
    Gender: 'Nam',
    Phone: '',
    Email: '',
    JoinedDate: '',
    IsActive: true,
    isEditing: false,
  });

  const [deptForm, setDeptForm] = useState({
    DepartmentID: null,
    DepartmentCode: '',
    DepartmentName: '',
    Level: 1,
    Location: 'Trụ sở SeaZen',
    Description: '',
  });

  const loadDirectoryList = useCallback(async () => {
    setLoadingList(true);
    try {
      const { ok, data } = await apiFetch(
        `/api/employees?q=${encodeURIComponent(empSearch)}&department=${encodeURIComponent(
          empDeptFilter
        )}&page=1&limit=2000&include_inactive=${includeInactive ? '1' : '0'}`
      );
      if (ok && data?.employees) {
        setAllEmployeesList(data.employees);
      }
    } finally {
      setLoadingList(false);
    }
  }, [empSearch, empDeptFilter, includeInactive]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadDirectoryList();
    }, 200);
    return () => clearTimeout(t);
  }, [loadDirectoryList]);

  const stats = useMemo(() => {
    const activeCount = allEmployeesList.filter((e) => e.is_active !== false).length;
    const inactiveCount = allEmployeesList.filter((e) => e.is_active === false).length;
    const contactCount = allEmployeesList.filter((e) => e.phone || e.email).length;
    const positionedCount = allEmployeesList.filter((e) => e.position).length;
    return {
      activeCount,
      inactiveCount,
      contactCount,
      positionedCount,
    };
  }, [allEmployeesList]);

  const resetEmpForm = () => {
    setEmpForm({
      EmployeeATID: '',
      EmployeeCode: '',
      FullName: '',
      DepartmentName: empDeptFilter || 'HC QTNS',
      Position: '',
      Gender: 'Nam',
      Phone: '',
      Email: '',
      JoinedDate: '',
      IsActive: true,
      isEditing: false,
    });
  };

  const resetDeptForm = () => {
    setDeptForm({
      DepartmentID: null,
      DepartmentCode: '',
      DepartmentName: '',
      Level: 1,
      Location: 'Trụ sở SeaZen',
      Description: '',
    });
  };

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    const { ok, data } = await apiFetch('/api/hrm/employee', {
      method: 'POST',
      body: JSON.stringify({
        ...empForm,
        update_scope: 'hrm',
        sync_to_hardware: false,
      }),
    });
    if (ok && data.success) {
      notify(data.message, 'success');
      resetEmpForm();
      await loadDirectoryList();
      onRefreshData();
    } else {
      notify(data.error || 'Không thể lưu hồ sơ nhân sự.', 'error');
    }
  };

  const handleToggleEmployeeStatus = async (emp) => {
    const atid = emp.atid || emp.EmployeeATID;
    const nextActive = emp.is_active === false;
    const { ok, data } = await apiFetch('/api/hrm/employee/status', {
      method: 'POST',
      body: JSON.stringify({ EmployeeATID: atid, IsActive: nextActive }),
    });
    if (ok && data.success) {
      notify(data.message, 'success');
      await loadDirectoryList();
      onRefreshData();
    } else {
      notify(data.error || 'Không thể thay đổi trạng thái nhân viên.', 'error');
    }
  };

  const handleSyncSharePointHrm = async () => {
    setSyncingSp(true);
    try {
      const targetTable = subTab === 'DEPARTMENTS' ? 'tbl_Departments' : 'tbl_Employees';
      const { ok, data } = await apiFetch('/api/sharepoint/sync_table', {
        method: 'POST',
        body: JSON.stringify({ sql_table: targetTable, max_rows: 300 }),
      });
      if (ok && data.ok !== false && data.success !== false) {
        notify(`Đã đồng bộ ${subTab === 'DEPARTMENTS' ? 'Phòng ban' : 'Danh bạ Nhân sự'} lên SharePoint VMS.`, 'success');
      } else {
        notify(data.error || 'Chưa kết nối tài khoản Microsoft SharePoint.', 'error');
      }
    } finally {
      setSyncingSp(false);
    }
  };

  const handleExportExcel = () => {
    const url = `/api/hrm/export_excel?department=${encodeURIComponent(
      empDeptFilter
    )}&q=${encodeURIComponent(empSearch)}&include_inactive=${includeInactive ? '1' : '0'}`;
    window.open(url, '_blank');
  };

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* TOP HEADER & ACTION BUTTONS */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              Quản trị Hành chính · Hồ sơ Nhân sự, Liên hệ &amp; Cơ cấu Tổ chức
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Nhân viên &amp; Phòng ban ({allEmployeesList.length || empTotal} nhân sự · {departments.length} phòng ban)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: 3, borderRadius: 10 }}>
              <button
                type="button"
                className={`btn btn-sm ${subTab === 'EMPLOYEES' ? 'btn-primary' : ''}`}
                style={{ border: 'none' }}
                onClick={() => setSubTab('EMPLOYEES')}
              >
                Danh bạ Nhân sự
              </button>
              <button
                type="button"
                className={`btn btn-sm ${subTab === 'DEPARTMENTS' ? 'btn-primary' : ''}`}
                style={{ border: 'none' }}
                onClick={() => setSubTab('DEPARTMENTS')}
              >
                Cơ cấu Phòng ban ({departments.length})
              </button>
            </div>

            <button
              type="button"
              className="btn btn-sm"
              disabled={syncingSp}
              onClick={handleSyncSharePointHrm}
            >
              {syncingSp ? 'Đang đồng bộ SP...' : 'Đồng bộ SharePoint'}
            </button>

            <button type="button" className="btn btn-gold btn-sm" onClick={handleExportExcel}>
              Xuất Excel Danh bạ
            </button>
          </div>
        </div>

        {/* 4 HR KPI CARDS */}
        <div className="kpi-grid-4">
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Nhân sự hoạt động</span>
            <span className="kpi-stat-value">{stats.activeCount}</span>
            <span className="kpi-stat-sub">Ca làm việc chuẩn: 07:45 – 16:45</span>
          </div>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Phòng ban / Đơn vị</span>
            <span className="kpi-stat-value">{departments.length}</span>
            <span className="kpi-stat-sub">Cập nhật sĩ số tự động theo thời gian thực</span>
          </div>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Có SĐT / Email đón khách</span>
            <span className="kpi-stat-value">{stats.contactCount}</span>
            <span className="kpi-stat-sub">Phục vụ tự động điền khi tiếp đón khách</span>
          </div>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đã gán Chức vụ / Vai trò</span>
            <span className="kpi-stat-value">{stats.positionedCount}</span>
            <span className="kpi-stat-sub">
              {stats.inactiveCount > 0 ? `${stats.inactiveCount} hồ sơ đang tạm khóa` : '100% hồ sơ đang hoạt động'}
            </span>
          </div>
        </div>

        {subTab === 'EMPLOYEES' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '360px 1fr',
              gap: 16,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            {/* LEFT FORM: HR ADMINISTRATIVE PROFILE ONLY */}
            <div className="card" style={{ overflowY: 'auto' }}>
              <div className="card-header">
                <div className="card-title">
                  {empForm.isEditing ? `Sửa hồ sơ: ${empForm.FullName}` : 'Thêm mới Hồ sơ Nhân sự'}
                </div>
                {empForm.isEditing && (
                  <button type="button" className="btn btn-sm" onClick={resetEmpForm}>
                    + Thêm mới
                  </button>
                )}
              </div>
              <div className="card-body">
                <form onSubmit={handleSaveEmployee} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="v-field">
                      <label>
                        <span className="req">*</span>Mã chấm công ATID
                      </label>
                      <input
                        type="text"
                        className="v-input"
                        value={empForm.EmployeeATID}
                        onChange={(e) => setEmpForm({ ...empForm, EmployeeATID: e.target.value })}
                        placeholder="VD: 00014865"
                        readOnly={empForm.isEditing}
                        style={empForm.isEditing ? { background: 'var(--bg-subtle)' } : {}}
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
                        placeholder="VD: 14865"
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 10 }}>
                    <div className="v-field">
                      <label>Phòng ban</label>
                      <select
                        className="v-input"
                        value={empForm.DepartmentName}
                        onChange={(e) => setEmpForm({ ...empForm, DepartmentName: e.target.value })}
                      >
                        {departments.map((d) => (
                          <option key={d.DepartmentID || d.id} value={d.DepartmentName || d.name}>
                            {d.DepartmentName || d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="v-field">
                      <label>Giới tính</label>
                      <select
                        className="v-input"
                        value={empForm.Gender}
                        onChange={(e) => setEmpForm({ ...empForm, Gender: e.target.value })}
                      >
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                      </select>
                    </div>
                  </div>

                  <div className="v-field">
                    <label>Chức vụ / Vị trí công tác</label>
                    <input
                      type="text"
                      className="v-input"
                      placeholder="VD: Chuyên viên, Chỉ huy trưởng, Kỹ sư IT..."
                      value={empForm.Position}
                      onChange={(e) => setEmpForm({ ...empForm, Position: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="v-field">
                      <label>Số điện thoại</label>
                      <input
                        type="text"
                        className="v-input"
                        placeholder="09xx..."
                        value={empForm.Phone}
                        onChange={(e) => setEmpForm({ ...empForm, Phone: e.target.value })}
                      />
                    </div>
                    <div className="v-field">
                      <label>Ngày vào làm</label>
                      <input
                        type="date"
                        className="v-input"
                        value={empForm.JoinedDate}
                        onChange={(e) => setEmpForm({ ...empForm, JoinedDate: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="v-field">
                    <label>Email công ty</label>
                    <input
                      type="email"
                      className="v-input"
                      placeholder="ten@seazen.com.vn"
                      value={empForm.Email}
                      onChange={(e) => setEmpForm({ ...empForm, Email: e.target.value })}
                    />
                  </div>

                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-subtle)',
                      padding: '8px 10px',
                      borderRadius: 8,
                    }}
                  >
                    Cập nhật hành chính bảo toàn toàn bộ dữ liệu Khuôn mặt &amp; Thẻ NFC tại phân hệ Sinh trắc học.
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                    {empForm.isEditing ? 'Lưu Thay Đổi Hành Chính' : 'Thêm Nhân Viên Mới'}
                  </button>
                </form>
              </div>
            </div>

            {/* RIGHT TABLE: HR DIRECTORY ROSTER */}
            <div className="card card-table-fill">
              <div className="card-header" style={{ flexShrink: 0 }}>
                <div className="card-title">
                  Danh bạ Nhân sự ({allEmployeesList.length})
                  {loadingList ? ' · Đang tải...' : ''}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeInactive}
                      onChange={(e) => setIncludeInactive(e.target.checked)}
                    />
                    <span>Hiện cả NV tạm khóa</span>
                  </label>
                  <select
                    className="v-input"
                    style={{ width: 165 }}
                    value={empDeptFilter}
                    onChange={(e) => setEmpDeptFilter(e.target.value)}
                  >
                    <option value="">Tất cả phòng ban</option>
                    {departments.map((d) => (
                      <option key={d.DepartmentID || d.id} value={d.DepartmentName || d.name}>
                        {d.DepartmentName || d.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="v-input"
                    style={{ width: 220 }}
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Tìm tên, mã NV, chức vụ, SĐT..."
                  />
                </div>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Mã ATID / HR</th>
                      <th>Họ và Tên</th>
                      <th>Phòng ban</th>
                      <th>Chức vụ</th>
                      <th>SĐT &amp; Email</th>
                      <th>Ca chuẩn</th>
                      <th>Trạng thái</th>
                      <th style={{ textAlign: 'right' }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEmployeesList.map((emp, idx) => {
                      const activeFlag = emp.is_active !== false;
                      return (
                        <tr
                          key={emp.atid || idx}
                          style={{ opacity: activeFlag ? 1 : 0.6 }}
                        >
                          <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--jet)' }}>
                              {emp.atid || emp.EmployeeATID}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              HR: {emp.code || '—'}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--jet)' }}>{emp.fullname}</div>
                            {emp.gender && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.gender}</div>
                            )}
                          </td>
                          <td>
                            <span className="badge" style={{ background: '#f1f5f9', color: '#1e293b' }}>
                              {emp.department}
                            </span>
                          </td>
                          <td>{emp.position || <span style={{ color: 'var(--text-muted)' }}>Chưa phân công</span>}</td>
                          <td>
                            {emp.phone || emp.email ? (
                              <div style={{ fontSize: 12 }}>
                                {emp.phone && <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{emp.phone}</div>}
                                {emp.email && <div style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>{emp.email}</div>}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Chưa cập nhật</span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>07:45 – 16:45</td>
                          <td>
                            <span className={`badge ${activeFlag ? 'badge-green' : 'badge-red'}`}>
                              {activeFlag ? 'Đang làm việc' : 'Tạm khóa'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() =>
                                  setEmpForm({
                                    EmployeeATID: emp.atid || '',
                                    EmployeeCode: emp.code || '',
                                    FullName: emp.fullname || '',
                                    DepartmentName: emp.department || 'HC QTNS',
                                    Position: emp.position || '',
                                    Gender: emp.gender || 'Nam',
                                    Phone: emp.phone || '',
                                    Email: emp.email || '',
                                    JoinedDate: emp.joined_date || '',
                                    IsActive: activeFlag,
                                    isEditing: true,
                                  })
                                }
                              >
                                Sửa
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={
                                  activeFlag
                                    ? { color: '#dc2626', borderColor: '#fecaca' }
                                    : { color: '#15803d', borderColor: '#bbf7d0' }
                                }
                                onClick={() => handleToggleEmployeeStatus(emp)}
                              >
                                {activeFlag ? 'Khóa' : 'Mở lại'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* TAB 2: ORGANIZATIONAL STRUCTURE & 13 DEPARTMENTS */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '340px 1fr',
              gap: 16,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div className="card" style={{ overflowY: 'auto' }}>
              <div className="card-header">
                <div className="card-title">
                  {deptForm.DepartmentID ? `Sửa: ${deptForm.DepartmentName}` : 'Thêm Phòng ban mới'}
                </div>
                {deptForm.DepartmentID && (
                  <button type="button" className="btn btn-sm" onClick={resetDeptForm}>
                    + Tạo mới
                  </button>
                )}
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
                      resetDeptForm();
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu phòng ban.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <div className="v-field">
                    <label>
                      <span className="req">*</span>Tên phòng ban / Đội
                    </label>
                    <input
                      type="text"
                      className="v-input"
                      value={deptForm.DepartmentName}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentName: e.target.value })}
                      required
                    />
                  </div>

                  <div className="v-field">
                    <label>Mã phòng ban</label>
                    <input
                      type="text"
                      className="v-input"
                      placeholder="VD: SEAZEN-TECH"
                      value={deptForm.DepartmentCode}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentCode: e.target.value })}
                    />
                  </div>

                  <div className="v-field">
                    <label>Vị trí / Tầng làm việc</label>
                    <input
                      type="text"
                      className="v-input"
                      value={deptForm.Location}
                      onChange={(e) => setDeptForm({ ...deptForm, Location: e.target.value })}
                    />
                  </div>

                  <div className="v-field">
                    <label>Mô tả chức năng / Ghi chú</label>
                    <textarea
                      className="v-input"
                      style={{ height: 74, paddingTop: 8, resize: 'vertical' }}
                      value={deptForm.Description}
                      onChange={(e) => setDeptForm({ ...deptForm, Description: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-gold" style={{ width: '100%' }}>
                    {deptForm.DepartmentID ? 'Lưu Cập Nhật Phòng Ban' : 'Thêm Phòng Ban Mới'}
                  </button>
                </form>
              </div>
            </div>

            <div className="card card-table-fill">
              <div className="card-header" style={{ flexShrink: 0 }}>
                <div className="card-title">Sơ đồ {departments.length} Phòng ban &amp; Sĩ số Thực tế</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Bấm vào phòng ban bất kỳ để lọc nhanh danh sách nhân sự
                </span>
              </div>
              <div className="table-scroll" style={{ padding: 16 }}>
                <div className="dept-grid">
                  {departments.map((d) => {
                    const name = d.DepartmentName || d.name;
                    const count = d.StaffCount ?? d.staff_count ?? 0;
                    const loc = d.Location || d.location || 'Trụ sở SeaZen';
                    const desc = d.Description || d.description || '';
                    return (
                      <div key={d.DepartmentID || d.id} className="dept-card">
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--jet)' }}>{name}</div>
                          <span className="badge badge-gold">{count} nhân sự</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{loc}</div>
                        {desc && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>{desc}</div>
                        )}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 8,
                            paddingTop: 8,
                            borderTop: '1px solid #f1f5f9',
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setEmpDeptFilter(name);
                              setSubTab('EMPLOYEES');
                            }}
                          >
                            Xem nhân sự ({count})
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              setDeptForm({
                                DepartmentID: d.DepartmentID || d.id,
                                DepartmentCode: d.DepartmentCode || d.code || '',
                                DepartmentName: name,
                                Level: d.Level || d.level || 1,
                                Location: loc,
                                Description: desc,
                              })
                            }
                          >
                            Sửa
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
