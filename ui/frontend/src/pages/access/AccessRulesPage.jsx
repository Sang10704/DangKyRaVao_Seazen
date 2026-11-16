import React, { useState } from 'react';
import { apiFetch } from '../../services/apiClient';

export default function AccessRulesPage({
  onCollapseSidebar,
  timezones,
  accessGroups,
  deptAccessGroups,
  deviceCommands,
  onRefreshData,
  notify,
}) {
  const [subTab, setSubTab] = useState('timezones');

  const [tzForm, setTzForm] = useState({
    TimezoneCode: '',
    TimezoneName: '',
    MonTime: '06:00-21:00',
    TueTime: '06:00-21:00',
    WedTime: '06:00-21:00',
    ThuTime: '06:00-21:00',
    FriTime: '06:00-21:00',
    SatTime: '06:00-18:00',
    SunTime: '00:00-00:00',
    HolidayTime: '00:00-00:00',
    Description: '',
  });

  const [groupForm, setGroupForm] = useState({
    GroupCode: '',
    GroupName: '',
    TimezoneID: 1,
    AllowedDoors: '1,2',
    VerifyMode: 'Khuôn mặt / Thẻ từ / Vân tay',
    Description: '',
  });

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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </div>
            <div>
              <h1 className="topbar-title">Phân quyền Cổng, Khung giờ & Lịch sử Lệnh Thiết bị</h1>
              <div className="topbar-sub">
                Thiết lập khung giờ được phép đi qua cổng, nhóm quyền theo phòng ban và theo dõi trạng thái lệnh thiết bị
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="subtab-bar">
        <button
          type="button"
          className={`subtab-btn ${subTab === 'timezones' ? 'active' : ''}`}
          onClick={() => setSubTab('timezones')}
        >
          <span>Khung giờ Ra vào ({timezones.length})</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'groups' ? 'active' : ''}`}
          onClick={() => setSubTab('groups')}
        >
          <span>Nhóm Quyền & Phân quyền Phòng ban ({accessGroups.length})</span>
        </button>
        <button
          type="button"
          className={`subtab-btn ${subTab === 'commands' ? 'active' : ''}`}
          onClick={() => setSubTab('commands')}
        >
          <span>Lịch sử Lệnh Thiết bị ({deviceCommands.length})</span>
        </button>
      </div>

      <div className="content-wrap">
        {subTab === 'timezones' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Thiết lập Khung giờ Ra vào</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/access/timezone', {
                      method: 'POST',
                      body: JSON.stringify(tzForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu khung giờ.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Mã khung giờ *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={tzForm.TimezoneCode}
                        onChange={(e) => setTzForm({ ...tzForm, TimezoneCode: e.target.value })}
                        placeholder="Ví dụ: KG_HANH_CHINH"
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Tên khung giờ *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={tzForm.TimezoneName}
                        onChange={(e) => setTzForm({ ...tzForm, TimezoneName: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-grid-3">
                    <div className="field-group">
                      <label>Thứ Hai → Thứ Sáu</label>
                      <input
                        type="text"
                        className="form-control"
                        value={tzForm.MonTime}
                        onChange={(e) =>
                          setTzForm({
                            ...tzForm,
                            MonTime: e.target.value,
                            TueTime: e.target.value,
                            WedTime: e.target.value,
                            ThuTime: e.target.value,
                            FriTime: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="field-group">
                      <label>Thứ Bảy</label>
                      <input
                        type="text"
                        className="form-control"
                        value={tzForm.SatTime}
                        onChange={(e) => setTzForm({ ...tzForm, SatTime: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Chủ Nhật</label>
                      <input
                        type="text"
                        className="form-control"
                        value={tzForm.SunTime}
                        onChange={(e) => setTzForm({ ...tzForm, SunTime: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Mô tả chi tiết</label>
                    <input
                      type="text"
                      className="form-control"
                      value={tzForm.Description}
                      onChange={(e) => setTzForm({ ...tzForm, Description: e.target.value })}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary">
                    Lưu Khung Giờ Ra Vào
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Danh sách Khung giờ Ra vào ({timezones.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã khung giờ</th>
                      <th>Tên khung giờ</th>
                      <th>Thứ 2 → Thứ 6</th>
                      <th>Thứ 7</th>
                      <th>Chủ Nhật</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timezones.map((tz) => (
                      <tr key={tz.TimezoneID}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{tz.TimezoneCode}</td>
                        <td style={{ fontWeight: 600 }}>{tz.TimezoneName}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{tz.MonTime}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{tz.SatTime}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{tz.SunTime}</td>
                        <td>{tz.Description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {subTab === 'groups' && (
          <div className="split-layout">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Thiết lập Nhóm Quyền Ra vào</div>
              </div>
              <div className="card-body">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/access/group', {
                      method: 'POST',
                      body: JSON.stringify(groupForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      onRefreshData();
                    } else {
                      notify(data.error || 'Không thể lưu nhóm quyền.', 'error');
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Mã nhóm quyền *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={groupForm.GroupCode}
                        onChange={(e) => setGroupForm({ ...groupForm, GroupCode: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field-group">
                      <label>Tên nhóm quyền *</label>
                      <input
                        type="text"
                        className="form-control"
                        value={groupForm.GroupName}
                        onChange={(e) => setGroupForm({ ...groupForm, GroupName: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-grid-2">
                    <div className="field-group">
                      <label>Cổng được phép đi qua</label>
                      <input
                        type="text"
                        className="form-control"
                        value={groupForm.AllowedDoors}
                        onChange={(e) => setGroupForm({ ...groupForm, AllowedDoors: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Hình thức xác thực</label>
                      <input
                        type="text"
                        className="form-control"
                        value={groupForm.VerifyMode}
                        onChange={(e) => setGroupForm({ ...groupForm, VerifyMode: e.target.value })}
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Lưu Nhóm Quyền Ra Vào
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div className="card-title">Phân quyền theo Phòng ban ({deptAccessGroups.length})</div>
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Phòng ban</th>
                      <th>Nhóm quyền áp dụng</th>
                      <th>Người cập nhật</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptAccessGroups.map((m, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{m.DepartmentName}</td>
                        <td>
                          <span className="badge badge-blue">{m.GroupName}</span>
                        </td>
                        <td>{m.UpdatedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {subTab === 'commands' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Lịch sử Lệnh Thiết bị ({deviceCommands.length})</div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Nội dung lệnh</th>
                    <th>Thiết bị nhận lệnh</th>
                    <th>Trạng thái</th>
                    <th>Kết quả</th>
                    <th>Người thực hiện</th>
                    <th>Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceCommands.map((c, idx) => (
                    <tr key={c.CommandID}>
                      <td>{idx + 1}</td>
                      <td style={{ fontWeight: 600 }}>{c.CommandCode}</td>
                      <td>{c.TargetDeviceName}</td>
                      <td>
                        <span className="badge badge-green">Hoàn tất</span>
                      </td>
                      <td>{c.ResultMessage}</td>
                      <td>{c.RequestedBy}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{c.ExecutedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
