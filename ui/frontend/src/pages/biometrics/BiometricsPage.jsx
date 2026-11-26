import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../services/apiClient';

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'SZ';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function BiometricsPage({
  departments,
  empSearch,
  setEmpSearch,
  empDeptFilter,
  setEmpDeptFilter,
  onRefreshData,
  notify,
}) {
  const [matrixRows, setMatrixRows] = useState([]);
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState({
    total_staff: 0,
    face_ready: 0,
    card_ready: 0,
    finger_ready: 0,
    all_4_synced: 0,
  });
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [pushingAtid, setPushingAtid] = useState('');
  const [bioFilter, setBioFilter] = useState('ALL'); // ALL | MISSING_SYNC | HAS_CARD | NO_CARD | NO_FACE

  const [selectedBio, setSelectedBio] = useState({
    EmployeeATID: '',
    EmployeeCode: '',
    FullName: '',
    DepartmentName: 'HC QTNS',
    Position: '',
    Gender: '',
    Email: '',
    Phone: '',
    IsActive: true,
    CardNumber: '',
    Privilege: 0,
    HasFace: true,
    HasFinger: false,
    FacePhotoBase64: '',
    sync_to_hardware: true,
    doors: null,
    last_synced: '',
    last_scan_time: '',
  });

  const loadMatrix = useCallback(
    async (refreshHardware = false) => {
      if (refreshHardware) setAuditing(true);
      else setLoading(true);
      try {
        const { ok, data } = await apiFetch(
          `/api/biometrics/matrix?refresh=${refreshHardware ? '1' : '0'}&department=${encodeURIComponent(
            empDeptFilter
          )}&q=${encodeURIComponent(empSearch)}`
        );
        if (ok && data?.success) {
          setMatrixRows(data.rows || []);
          setDevices(data.devices || []);
          if (data.summary) setSummary(data.summary);
          if (refreshHardware) {
            notify('Đã hoàn tất quét đối soát người dùng & khuôn mặt trực tiếp trên 4 máy ZKTeco.', 'success');
          }
        }
      } finally {
        setLoading(false);
        setAuditing(false);
      }
    },
    [empDeptFilter, empSearch, notify]
  );

  useEffect(() => {
    loadMatrix(false);
  }, [loadMatrix]);

  const filteredRows = useMemo(() => {
    return matrixRows.filter((r) => {
      if (bioFilter === 'MISSING_SYNC') return r.total_doors > 0 && r.synced_doors_count < r.total_doors;
      if (bioFilter === 'HAS_CARD') return Boolean(r.has_card_effective);
      if (bioFilter === 'NO_CARD') return !r.has_card_effective;
      if (bioFilter === 'NO_FACE') return !r.has_face_effective;
      return true;
    });
  }, [matrixRows, bioFilter]);

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedBio((prev) => ({
        ...prev,
        FacePhotoBase64: String(reader.result || ''),
        HasFace: true,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAndPushBiometrics = async (e) => {
    e.preventDefault();
    if (!selectedBio.EmployeeATID.trim()) {
      notify('Vui lòng chọn một nhân viên từ bảng bên phải hoặc nhập Mã ATID.', 'error');
      return;
    }
    setPushingAtid(selectedBio.EmployeeATID);
    try {
      const { ok, data } = await apiFetch('/api/hrm/employee', {
        method: 'POST',
        body: JSON.stringify({
          ...selectedBio,
          update_scope: 'biometrics',
        }),
      });
      if (ok && data.success) {
        const hwMsg = data.hardware_sync?.message ? ` · ${data.hardware_sync.message}` : '';
        notify(`${data.message}${hwMsg}`, 'success');
        await loadMatrix(false);
        onRefreshData();
      } else {
        notify(data.error || 'Không thể lưu dữ liệu sinh trắc học.', 'error');
      }
    } finally {
      setPushingAtid('');
    }
  };

  const handleQuickPush4Doors = async (row, e) => {
    e.stopPropagation();
    const atid = row.atid || row.EmployeeATID;
    setPushingAtid(atid);
    try {
      const { ok, data } = await apiFetch('/api/biometrics/push_hardware', {
        method: 'POST',
        body: JSON.stringify({
          EmployeeATID: atid,
          FullName: row.fullname,
          CardNumber: row.card_number || '',
          Privilege: row.privilege || 0,
        }),
      });
      if (ok && data.success) {
        notify(data.message, 'success');
        await loadMatrix(false);
      } else {
        notify(data.error || 'Không thể nạp hồ sơ xuống 4 máy cổng.', 'error');
      }
    } finally {
      setPushingAtid('');
    }
  };

  const doorOrder = ['139', '138', '137', '136'];

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* TOP HEADER & HARDWARE AUDIT */}
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
              Quản trị Sinh trắc học (FaceID · Vân tay · Thẻ NFC) &amp; Đối soát 4 Máy SenseFace 4A
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Dữ liệu Sinh trắc học ({summary.total_staff} hồ sơ)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {devices.map((d) => (
              <div
                key={d.ip}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 999,
                  background: '#ffffff',
                  border: `1px solid ${d.online ? '#bbf7d0' : '#fecaca'}`,
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
                title={`${d.name} (${d.ip}) · ${d.face_count} Face / ${d.user_count} Users`}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: d.online ? '#16a34a' : '#dc2626',
                  }}
                />
                <span>.{d.short_ip}</span>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {d.user_count}u/{d.face_count}f
                </span>
              </div>
            ))}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={auditing}
              onClick={() => loadMatrix(true)}
            >
              {auditing ? 'Đang quét 4 máy ZKTeco...' : 'Quét đối soát 4 máy ZKTeco'}
            </button>
          </div>
        </div>

        {/* 4 BIOMETRIC & HARDWARE KPIS */}
        <div className="kpi-grid-4">
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Khuôn mặt / FaceID</span>
            <span className="kpi-stat-value">
              {summary.face_ready} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>/ {summary.total_staff}</span>
            </span>
            <span className="kpi-stat-sub">Nhận diện qua CSDL &amp; SenseFace 4A</span>
          </div>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Thẻ từ NFC Nhân viên</span>
            <span className="kpi-stat-value">{summary.card_ready}</span>
            <span className="kpi-stat-sub">Đối chiếu trực tiếp CSDL &amp; bộ nhớ thẻ trên cổng</span>
          </div>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Vân tay (Fingerprint)</span>
            <span className="kpi-stat-value">{summary.finger_ready}</span>
            <span className="kpi-stat-sub">Đã đăng ký hoặc có lịch sử quét vân tay</span>
          </div>
          <div className="kpi-stat-card">
            <span className="kpi-stat-label">Đồng bộ đủ 4/4 Máy cổng</span>
            <span className="kpi-stat-value">
              {summary.all_4_synced} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>/ {summary.total_staff}</span>
            </span>
            <span className="kpi-stat-sub">Chuẩn Access Control TZ1 = 1 (00:00–23:59)</span>
          </div>
        </div>

        {/* MAIN SPLIT: BIOMETRIC INSPECTOR (LEFT) + 4-TERMINAL VERIFICATION MATRIX (RIGHT) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '365px 1fr',
            gap: 16,
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* LEFT PANEL: BIOMETRIC & HARDWARE INSPECTOR */}
          <div className="card" style={{ overflowY: 'auto' }}>
            <div className="card-header">
              <div className="card-title">
                {selectedBio.EmployeeATID
                  ? `Hồ sơ Sinh trắc: ${selectedBio.FullName}`
                  : 'Chọn nhân viên để nạp Sinh trắc'}
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={handleSaveAndPushBiometrics} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Portrait Photo Preview Box */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {selectedBio.FacePhotoBase64 ? (
                    <img
                      src={selectedBio.FacePhotoBase64}
                      alt={selectedBio.FullName}
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 12,
                        objectFit: 'cover',
                        border: '2px solid var(--gold)',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 12,
                        background: 'var(--jet)',
                        color: 'var(--gold)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 20,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {selectedBio.FullName ? getInitials(selectedBio.FullName) : 'ID'}
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--jet)' }}>
                      {selectedBio.FullName || 'Chưa chọn nhân sự'}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {selectedBio.EmployeeATID ? `ATID: ${selectedBio.EmployeeATID} · ${selectedBio.DepartmentName}` : 'Bấm một dòng bên phải để kiểm tra hoặc cập nhật'}
                    </div>
                    {selectedBio.last_scan_time && (
                      <div style={{ fontSize: 11, color: '#15803d', fontWeight: 600, marginTop: 2 }}>
                        Quét gần nhất: {selectedBio.last_scan_time}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="v-field">
                    <label>
                      <span className="req">*</span>Mã chấm công ATID
                    </label>
                    <input
                      type="text"
                      className="v-input"
                      value={selectedBio.EmployeeATID}
                      onChange={(e) => setSelectedBio({ ...selectedBio, EmployeeATID: e.target.value })}
                      placeholder="VD: 00014865"
                      required
                    />
                  </div>
                  <div className="v-field">
                    <label>Tên hiển thị trên máy</label>
                    <input
                      type="text"
                      className="v-input"
                      value={selectedBio.FullName}
                      onChange={(e) => setSelectedBio({ ...selectedBio, FullName: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="v-field">
                    <label>Mã thẻ từ NFC</label>
                    <input
                      type="text"
                      className="v-input"
                      value={selectedBio.CardNumber}
                      onChange={(e) => setSelectedBio({ ...selectedBio, CardNumber: e.target.value })}
                      placeholder="Quẹt thẻ gán..."
                    />
                  </div>
                  <div className="v-field">
                    <label>Quyền trên máy ZKTeco</label>
                    <select
                      className="v-input"
                      value={selectedBio.Privilege}
                      onChange={(e) => setSelectedBio({ ...selectedBio, Privilege: Number(e.target.value) })}
                    >
                      <option value={0}>0 · Nhân viên (User)</option>
                      <option value={14}>14 · Quản trị máy (Admin)</option>
                    </select>
                  </div>
                </div>

                <div className="v-field">
                  <label>Tải ảnh chân dung nhận diện (Face Photo)</label>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ fontSize: 12 }} />
                </div>

                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedBio.HasFace}
                      onChange={(e) => setSelectedBio({ ...selectedBio, HasFace: e.target.checked })}
                    />
                    <span>Có Khuôn mặt</span>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedBio.HasFinger}
                      onChange={(e) => setSelectedBio({ ...selectedBio, HasFinger: e.target.checked })}
                    />
                    <span>Có Vân tay</span>
                  </label>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={selectedBio.sync_to_hardware}
                    onChange={(e) => setSelectedBio({ ...selectedBio, sync_to_hardware: e.target.checked })}
                  />
                  <span>Nạp thẳng xuống 4 máy SenseFace 4A (TCP 4370 · TZ1=1)</span>
                </label>

                {selectedBio.doors && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 6,
                      padding: 10,
                      borderRadius: 10,
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {doorOrder.map((shortIp) => {
                      const info = selectedBio.doors[shortIp];
                      const ok = Boolean(info?.present);
                      return (
                        <div key={shortIp} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>.{shortIp}</div>
                          <span className={`door-matrix-chip ${ok ? 'ok' : 'miss'}`} style={{ marginTop: 3 }}>
                            {ok ? 'OK' : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={pushingAtid === selectedBio.EmployeeATID}
                >
                  {pushingAtid === selectedBio.EmployeeATID
                    ? 'Đang lưu & nạp thiết bị...'
                    : 'Lưu Sinh Trắc & Nạp 4 Máy Cổng'}
                </button>
              </form>
            </div>
          </div>

          {/* RIGHT PANEL: 4-TERMINAL HARDWARE VERIFICATION MATRIX */}
          <div className="card card-table-fill">
            <div className="card-header" style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { id: 'ALL', label: `Tất cả (${matrixRows.length})` },
                  { id: 'MISSING_SYNC', label: 'Thiếu trên máy cổng' },
                  { id: 'HAS_CARD', label: 'Đã gán Thẻ NFC' },
                  { id: 'NO_CARD', label: 'Chưa gán Thẻ NFC' },
                  { id: 'NO_FACE', label: 'Chưa có Khuôn mặt' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`btn btn-sm ${bioFilter === f.id ? 'btn-primary' : ''}`}
                    onClick={() => setBioFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className="v-input"
                  style={{ width: 155 }}
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
                  style={{ width: 205 }}
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Tìm tên, ATID, mã thẻ..."
                />
              </div>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 42 }}>#</th>
                    <th>Nhân sự &amp; Ảnh mặt</th>
                    <th>Mã ATID</th>
                    <th>Sinh trắc &amp; Thẻ NFC</th>
                    <th style={{ textAlign: 'center' }}>.139 (Vào P)</th>
                    <th style={{ textAlign: 'center' }}>.138 (Vào T)</th>
                    <th style={{ textAlign: 'center' }}>.137 (Ra T)</th>
                    <th style={{ textAlign: 'center' }}>.136 (Ra P)</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Đang tổng hợp ma trận sinh trắc học từ CSDL &amp; 4 thiết bị ZKTeco...
                      </td>
                    </tr>
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Không có hồ sơ nào khớp bộ lọc sinh trắc học hiện tại.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r, idx) => {
                      const atid = r.atid || r.EmployeeATID;
                      const isSelected = selectedBio.EmployeeATID === atid;
                      const isPushing = pushingAtid === atid;

                      return (
                        <tr
                          key={atid || idx}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? '#fefce8' : undefined,
                          }}
                          onClick={() =>
                            setSelectedBio({
                              EmployeeATID: atid,
                              EmployeeCode: r.code || '',
                              FullName: r.fullname || '',
                              DepartmentName: r.department || 'HC QTNS',
                              Position: r.position || '',
                              Gender: r.gender || '',
                              Email: r.email || '',
                              Phone: r.phone || '',
                              IsActive: r.is_active !== false,
                              CardNumber: r.card_number || '',
                              Privilege: Number(r.privilege || 0),
                              HasFace: Boolean(r.has_face_effective),
                              HasFinger: Boolean(r.has_finger_effective),
                              FacePhotoBase64: r.face_photo || '',
                              sync_to_hardware: true,
                              doors: r.doors,
                              last_synced: r.last_synced || '',
                              last_scan_time: r.last_scan_time || '',
                            })
                          }
                        >
                          <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {r.face_photo ? (
                                <img src={r.face_photo} alt={r.fullname} className="bio-avatar-thumb" />
                              ) : (
                                <div className="bio-avatar-thumb">{getInitials(r.fullname)}</div>
                              )}
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 700, color: 'var(--jet)' }}>{r.fullname}</div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{r.department}</div>
                              </div>
                            </div>
                          </td>

                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{atid}</td>

                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span className={`badge ${r.has_face_effective ? 'badge-green' : 'badge-red'}`}>
                                {r.db_has_face || r.face_photo
                                  ? 'Khuôn mặt DB'
                                  : r.scan_verified_face
                                  ? 'Đã quét Mặt'
                                  : r.synced_doors_count > 0
                                  ? 'User trên máy'
                                  : 'Chưa có Mặt'}
                              </span>
                              {r.card_number ? (
                                <span className="badge badge-gold" style={{ fontFamily: 'var(--font-mono)' }}>
                                  Thẻ: {r.card_number}
                                </span>
                              ) : (
                                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Chưa gán thẻ</span>
                              )}
                              {r.has_finger_effective && <span className="badge badge-dark">Vân tay</span>}
                              {r.privilege >= 14 && (
                                <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9' }}>
                                  Admin máy
                                </span>
                              )}
                            </div>
                          </td>

                          {doorOrder.map((shortIp) => {
                            const dInfo = r.doors?.[shortIp];
                            const present = Boolean(dInfo?.present);
                            return (
                              <td key={shortIp} style={{ textAlign: 'center' }}>
                                <span
                                  className={`door-matrix-chip ${present ? 'ok' : 'miss'}`}
                                  title={
                                    present
                                      ? `Có mặt trên .${shortIp} (uid=${dInfo.uid}, thẻ=${dInfo.card || '0'})`
                                      : `Chưa có trên máy .${shortIp}`
                                  }
                                >
                                  {present ? 'OK' : '—'}
                                </span>
                              </td>
                            );
                          })}

                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={isPushing}
                                onClick={(e) => handleQuickPush4Doors(r, e)}
                                title="Nạp trực tiếp UserID & Thẻ xuống 4 máy cổng với chuẩn TZ1=1"
                              >
                                {isPushing ? 'Đang nạp...' : 'Nạp 4 máy'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
