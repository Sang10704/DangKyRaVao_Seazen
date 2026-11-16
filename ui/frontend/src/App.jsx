import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, DoorOpen, Lock, Unlock, Users, UserPlus, Building2, Clock,
  Database, CloudUpload, RefreshCw, AlertTriangle, CheckCircle2,
  Search, FileSpreadsheet, KeyRound, Layers, Terminal, Calendar,
  CreditCard, HardHat, Activity, LogOut, Eye, ChevronRight, PlusCircle, Server
} from 'lucide-react';

const API_BASE = '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginForm, setLoginForm] = useState({ credential: 'admin', password: '' });
  const [loginError, setLoginError] = useState('');

  const [activeTab, setActiveTab] = useState('live');
  const [toast, setToast] = useState(null);

  // Global Hardware, Clock Audit & SQL Overview state
  const [systemStatus, setSystemStatus] = useState(null);
  const [clockAudit, setClockAudit] = useState(null);
  const [clockModalOpen, setClockModalOpen] = useState(false);
  const [clockConfirmStep1, setClockConfirmStep1] = useState(false);
  const [clockConfirmCode, setClockConfirmCode] = useState('');
  const [clockSyncing, setClockSyncing] = useState(false);

  // Workspace 1: Live Command Center
  const [scanDate, setScanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scanCategory, setScanCategory] = useState('ALL');
  const [scanDirection, setScanDirection] = useState('ALL');
  const [scanSearch, setScanSearch] = useState('');
  const [realtimeLogs, setRealtimeLogs] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [doorLoading, setDoorLoading] = useState({});

  // Workspace 2: Visitors, Pre-registration, Contractors, Cards
  const [visitorSubTab, setVisitorSubTab] = useState('checkin');
  const [qrInput, setQrInput] = useState('');
  const [visitorForm, setVisitorForm] = useState({
    full_name: '', cccd_number: '', phone: '', company: '',
    department: 'BGĐ SeaZen', host_person: '', purpose: 'Liên hệ công tác',
    card_number: '', auto_unlock: false
  });
  const [checkoutQuery, setCheckoutQuery] = useState('');
  const [activeVisitors, setActiveVisitors] = useState([]);
  const [visitorHistory, setVisitorHistory] = useState([]);
  const [customerCards, setCustomerCards] = useState([]);
  const [preGuests, setPreGuests] = useState([]);
  const [contractors, setContractors] = useState([]);

  const [preGuestForm, setPreGuestForm] = useState({
    BookingCode: '', GuestFullName: '', GuestCCCD: '', GuestPhone: '',
    GuestCompany: '', HostEmployeeName: '', HostDepartment: 'BGĐ SeaZen',
    VisitDate: new Date().toISOString().slice(0, 10), StartTime: '08:30', EndTime: '17:30',
    Purpose: '', ReservedCardNumber: '', Status: 'PENDING'
  });
  const [contractorForm, setContractorForm] = useState({
    ContractorCode: '', ContractorCompany: '', WorkerFullName: '',
    CCCDNumber: '', Phone: '', CardNumber: '', WorkArea: 'Sảnh & Khu Kỹ Thuật',
    SupervisorName: 'HC QTNS', ValidFrom: new Date().toISOString().slice(0, 10),
    ValidTo: new Date().toISOString().slice(0, 10), Status: 'ACTIVE'
  });
  const [cardForm, setCardForm] = useState({
    CardCode: '', CardNumber: '', CardType: 'VISITOR', Status: 'AVAILABLE', Notes: ''
  });

  // Workspace 3: HRM & Biometrics
  const [hrmSubTab, setHrmSubTab] = useState('employees');
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empSearch, setEmpSearch] = useState('');
  const [empDeptFilter, setEmpDeptFilter] = useState('');
  const [empPage, setEmpPage] = useState(1);
  const [empForm, setEmpForm] = useState({
    EmployeeATID: '', EmployeeCode: '', FullName: '', DepartmentName: 'HC QTNS',
    Position: 'Chuyên viên', CardNumber: '', Privilege: 0, Email: '', Phone: '',
    HasFace: true, HasFinger: false, FacePhotoBase64: '', sync_to_hardware: false
  });
  const [deptForm, setDeptForm] = useState({
    DepartmentCode: '', DepartmentName: '', Level: 1, Location: 'Trụ sở SeaZen', Description: ''
  });

  // Workspace 4: Access Control Rules & Commands
  const [accessSubTab, setAccessSubTab] = useState('timezones');
  const [timezones, setTimezones] = useState([]);
  const [accessGroups, setAccessGroups] = useState([]);
  const [deptAccessGroups, setDeptAccessGroups] = useState([]);
  const [deviceCommands, setDeviceCommands] = useState([]);
  const [doorAuditLogs, setDoorAuditLogs] = useState([]);
  const [tzForm, setTzForm] = useState({
    TimezoneCode: '', TimezoneName: '', MonTime: '06:00-21:00', TueTime: '06:00-21:00',
    WedTime: '06:00-21:00', ThuTime: '06:00-21:00', FriTime: '06:00-21:00',
    SatTime: '06:00-18:00', SunTime: '00:00-00:00', HolidayTime: '00:00-00:00', Description: ''
  });
  const [groupForm, setGroupForm] = useState({
    GroupCode: '', GroupName: '', TimezoneID: 1, AllowedDoors: '1,2',
    VerifyMode: 'Face / Card / Finger', Description: ''
  });

  // Workspace 5: Time & Attendance
  const [attSubTab, setAttSubTab] = useState('daily');
  const [dailyTimekeeping, setDailyTimekeeping] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [shiftForm, setShiftForm] = useState({
    ShiftCode: '', ShiftName: '', CheckInTime: '08:00', CheckOutTime: '17:30',
    BreakStartTime: '12:00', BreakEndTime: '13:30', GraceLateMinutes: 5,
    GraceEarlyMinutes: 5, WorkingHours: 8.0
  });

  // Workspace 6: SQL 18 Tables, Safe Sync & SharePoint VMS Lists
  const [sqlOverview, setSqlOverview] = useState({ tables: [], total_rows: 0, connection: {} });
  const [selectedSqlTable, setSelectedSqlTable] = useState('tbl_Employees');
  const [sqlTableRows, setSqlTableRows] = useState([]);
  const [spStatus, setSpStatus] = useState({ authenticated: false, schemas: [] });
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSyncReport, setLastSyncReport] = useState(null);

  const notify = useCallback((msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // 1. Check Auth & Clock Audit on Startup
  useEffect(() => {
    (async () => {
      const { ok, data } = await apiFetch('/api/auth/me');
      if (ok && data.authenticated) {
        setUser(data.user);
      }
      setAuthChecked(true);
    })();
  }, []);

  const fetchClockAudit = useCallback(async () => {
    const { ok, data } = await apiFetch('/api/clock/audit');
    if (ok && data.audit) {
      setClockAudit(data.audit);
    }
  }, []);

  const fetchLiveWorkspace = useCallback(async () => {
    if (!user) return;
    const [stRes, logRes, anaRes, visRes] = await Promise.all([
      apiFetch('/api/status'),
      apiFetch(`/api/door/realtime_logs?date=${scanDate}&category=${scanCategory}&direction=${scanDirection}&search=${encodeURIComponent(scanSearch)}&limit=300`),
      apiFetch(`/api/analytics/dashboard?date=${scanDate}`),
      apiFetch('/api/visitors/active'),
    ]);
    if (stRes.ok) setSystemStatus(stRes.data);
    if (logRes.ok && logRes.data.logs) setRealtimeLogs(logRes.data.logs);
    if (anaRes.ok && anaRes.data.analytics) setAnalytics(anaRes.data.analytics);
    if (visRes.ok && visRes.data.visitors) setActiveVisitors(visRes.data.visitors);
  }, [user, scanDate, scanCategory, scanDirection, scanSearch]);

  const fetchSqlTable = useCallback(async (tblName) => {
    const { ok, data } = await apiFetch(`/api/sql/table/${tblName}?limit=200`);
    if (ok && data.rows) {
      setSqlTableRows(data.rows);
    }
  }, []);

  const fetchAllEnterpriseData = useCallback(async () => {
    if (!user) return;
    const [
      deptRes, empRes, sqlRes, spRes,
      cardsRes, preRes, conRes, histRes,
      tzRes, grpRes, dgrpRes, cmdRes, audRes,
      dtkRes, shfRes
    ] = await Promise.all([
      apiFetch('/api/sql/table/tbl_Departments?limit=100'),
      apiFetch(`/api/employees?q=${encodeURIComponent(empSearch)}&department=${encodeURIComponent(empDeptFilter)}&page=${empPage}&limit=50`),
      apiFetch('/api/sql/overview'),
      apiFetch('/api/sharepoint/vms_status'),
      apiFetch('/api/sql/table/tbl_CustomerCards?limit=200'),
      apiFetch('/api/sql/table/tbl_PreRegisteredGuests?limit=200'),
      apiFetch('/api/sql/table/tbl_Contractors?limit=200'),
      apiFetch('/api/sql/table/tbl_Visitors?limit=200'),
      apiFetch('/api/sql/table/tbl_AccessTimezones?limit=100'),
      apiFetch('/api/sql/table/tbl_AccessGroups?limit=100'),
      apiFetch('/api/sql/table/tbl_DepartmentAccessGroups?limit=100'),
      apiFetch('/api/sql/table/tbl_DeviceCommands?limit=100'),
      apiFetch('/api/sql/table/tbl_DoorAuditLogs?limit=100'),
      apiFetch('/api/sql/table/tbl_DailyTimekeeping?limit=300'),
      apiFetch('/api/sql/table/tbl_Shifts?limit=50'),
    ]);

    if (deptRes.ok && deptRes.data.rows) setDepartments(deptRes.data.rows);
    if (empRes.ok && empRes.data.employees) {
      setEmployees(empRes.data.employees);
      setEmpTotal(empRes.data.total || empRes.data.employees.length);
    }
    if (sqlRes.ok) setSqlOverview(sqlRes.data);
    if (spRes.ok) setSpStatus(spRes.data);
    if (cardsRes.ok && cardsRes.data.rows) setCustomerCards(cardsRes.data.rows);
    if (preRes.ok && preRes.data.rows) setPreGuests(preRes.data.rows);
    if (conRes.ok && conRes.data.rows) setContractors(conRes.data.rows);
    if (histRes.ok && histRes.data.rows) setVisitorHistory(histRes.data.rows);
    if (tzRes.ok && tzRes.data.rows) setTimezones(tzRes.data.rows);
    if (grpRes.ok && grpRes.data.rows) setAccessGroups(grpRes.data.rows);
    if (dgrpRes.ok && dgrpRes.data.rows) setDeptAccessGroups(dgrpRes.data.rows);
    if (cmdRes.ok && cmdRes.data.rows) setDeviceCommands(cmdRes.data.rows);
    if (audRes.ok && audRes.data.rows) setDoorAuditLogs(audRes.data.rows);
    if (dtkRes.ok && dtkRes.data.rows) setDailyTimekeeping(dtkRes.data.rows);
    if (shfRes.ok && shfRes.data.rows) setShifts(shfRes.data.rows);
  }, [user, empSearch, empDeptFilter, empPage]);

  useEffect(() => {
    fetchClockAudit();
    const timer = setInterval(fetchClockAudit, 30000);
    return () => clearInterval(timer);
  }, [fetchClockAudit]);

  useEffect(() => {
    if (!user) return;
    fetchLiveWorkspace();
    const interval = setInterval(fetchLiveWorkspace, 4000);
    return () => clearInterval(interval);
  }, [user, fetchLiveWorkspace]);

  useEffect(() => {
    if (!user) return;
    fetchAllEnterpriseData();
  }, [user, fetchAllEnterpriseData]);

  useEffect(() => {
    if (user && selectedSqlTable) {
      fetchSqlTable(selectedSqlTable);
    }
  }, [user, selectedSqlTable, fetchSqlTable]);

  // Handlers
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const { ok, data } = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(loginForm),
    });
    if (ok && data.success) {
      setUser(data.user);
      notify(`Xin chào ${data.user.full_name}`, 'success');
    } else {
      setLoginError(data.error || 'Đăng nhập thất bại');
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const handleDoorControl = async (action, doorId, serial, channelName, seconds = 1) => {
    const key = `${serial || doorId}_${action}`;
    setDoorLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const endpoint = action === 'UNLOCK' ? '/api/door/unlock' : '/api/door/lock';
      const { ok, data } = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ door_id: doorId, serial, channel_name: channelName, seconds }),
      });
      if (ok && data.success) {
        notify(`${action === 'UNLOCK' ? 'Đã mở' : 'Đã khóa'} ${channelName} (${seconds}s)`, 'success');
        fetchLiveWorkspace();
      } else {
        notify(data.error || 'Lỗi điều khiển cửa', 'error');
      }
    } finally {
      setDoorLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleDoorAll = async (action, seconds = 2) => {
    const endpoint = action === 'UNLOCK_ALL' ? '/api/door/unlock_all' : '/api/door/lock_all';
    const { ok, data } = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ seconds }),
    });
    if (ok && data.success) {
      notify(action === 'UNLOCK_ALL' ? 'Đã kích mở khẩn cấp 4 máy cửa' : 'Đã khóa toàn bộ 4 máy cửa', 'success');
    } else {
      notify(data.error || 'Không thể thực hiện lệnh', 'error');
    }
  };

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
      notify(`Đã bóc tách CCCD: ${p.full_name} (${p.cccd_number})`, 'success');
    }
  };

  const handleRegisterVisitor = async (e) => {
    e.preventDefault();
    const { ok, data } = await apiFetch('/api/visitor/register', {
      method: 'POST',
      body: JSON.stringify(visitorForm),
    });
    if (ok && data.success) {
      notify(data.message || 'Đăng ký khách thành công', 'success');
      setVisitorForm({
        full_name: '', cccd_number: '', phone: '', company: '',
        department: 'BGĐ SeaZen', host_person: '', purpose: 'Liên hệ công tác',
        card_number: '', auto_unlock: false
      });
      setQrInput('');
      fetchLiveWorkspace();
      fetchAllEnterpriseData();
    } else {
      notify(data.error || 'Lỗi đăng ký khách', 'error');
    }
  };

  const handleFastCheckout = async (queryVal) => {
    const q = queryVal || checkoutQuery;
    if (!q) return;
    const { ok, data } = await apiFetch('/api/visitor/fast_checkout', {
      method: 'POST',
      body: JSON.stringify({ query: q }),
    });
    if (ok && data.success) {
      notify(data.message || 'Check-out thành công', 'success');
      setCheckoutQuery('');
      fetchLiveWorkspace();
      fetchAllEnterpriseData();
    } else {
      notify(data.error || 'Không tìm thấy khách đang có mặt', 'error');
    }
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEmpForm((prev) => ({ ...prev, FacePhotoBase64: String(reader.result || ''), HasFace: true }));
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmedClockSync = async () => {
    if (!clockConfirmStep1 || clockConfirmCode !== 'CONFIRM_VN_NTP_SYNC') {
      notify('Vui lòng hoàn tất đủ 2 bước xác nhận an toàn trước khi đồng bộ giờ.', 'error');
      return;
    }
    setClockSyncing(true);
    try {
      const { ok, data } = await apiFetch('/api/clock/sync_ntp', {
        method: 'POST',
        body: JSON.stringify({
          confirm_layer1: clockConfirmStep1,
          confirm_code: clockConfirmCode,
        }),
      });
      if (ok && data.success) {
        setClockAudit(data.audit);
        setClockModalOpen(false);
        setClockConfirmStep1(false);
        setClockConfirmCode('');
        notify('Đã đồng bộ chuẩn giờ Quốc gia Việt Nam (NTP UTC+7) xuống 4 máy ZKTeco an toàn.', 'success');
        fetchAllEnterpriseData();
      } else {
        notify(data.error || 'Đồng bộ giờ thất bại', 'error');
      }
    } finally {
      setClockSyncing(false);
    }
  };

  const handleRunSafeSyncTest = async () => {
    setSyncBusy(true);
    try {
      const { ok, data } = await apiFetch('/api/sync/safe_test', { method: 'POST' });
      if (ok && data.success) {
        setLastSyncReport(data);
        notify('Đã chạy kiểm thử API ngầm (ePAD ServiceId=1 + ZKTeco TCP 4370 Read-Only) thành công, bảo toàn 100% dữ liệu.', 'success');
        fetchAllEnterpriseData();
        fetchSqlTable(selectedSqlTable);
      } else {
        notify(data.error || 'Lỗi chạy đồng bộ kiểm thử', 'error');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const handleProvisionSharePointLists = async () => {
    setSyncBusy(true);
    try {
      const { ok, data } = await apiFetch('/api/sharepoint/provision_lists', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (ok && data.success) {
        notify(`Đã khởi tạo/xác thực 18 SharePoint Lists "VMS SEAZEN - ..." với cột Tiếng Việt thành công.`, 'success');
        fetchAllEnterpriseData();
      } else {
        notify(data.error || 'Lỗi khởi tạo SharePoint List', 'error');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const handleSyncSingleTableToSharePoint = async (sqlTable) => {
    setSyncBusy(true);
    try {
      const { ok, data } = await apiFetch('/api/sharepoint/sync_table', {
        method: 'POST',
        body: JSON.stringify({ sql_table: sqlTable, max_rows: 200 }),
      });
      if (ok && data.success) {
        notify(`Đã đẩy ${data.rows_processed} bản ghi từ ${sqlTable} lên "${data.list_title}" (Thêm mới: ${data.inserted}, Cập nhật: ${data.updated}).`, 'success');
        fetchAllEnterpriseData();
      } else {
        notify(data.error || 'Lỗi đồng bộ bảng lên SharePoint', 'error');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="text-sm font-mono tracking-widest uppercase text-slate-400">
          Đang khởi tạo hệ thống kiểm soát SeaZen VMS...
        </div>
      </div>
    );
  }

  // LOGIN SCREEN
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-6">
        {/* Top Clock Safety Bar on Login */}
        <div className="max-w-5xl w-full mx-auto border border-slate-800 bg-slate-900/90 px-4 py-3 rounded flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <Clock className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-400">GIỜ CHUẨN VIỆT NAM (NTP UTC+7):</span>
            <span className="font-semibold text-white">{clockAudit?.vietnam_ntp_time || 'Đang kiểm tra...'}</span>
          </div>
          <div className="flex items-center gap-4 font-mono">
            <span>
              GIỜ MÁY CỤC BỘ: <strong className="text-slate-200">{clockAudit?.local_pc_time || '--'}</strong>
              {' '}({clockAudit?.pc_drift_sec ?? 0}s)
            </span>
            <span className={`px-2 py-0.5 rounded font-semibold ${clockAudit?.pc_clock_valid !== false ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-red-950 text-red-300 border border-red-700'}`}>
              {clockAudit?.pc_clock_valid !== false ? 'ĐỒNG HỒ AN TOÀN' : 'LỆCH GIỜ CỤC BỘ - ĐÃ KHÓA GHI ĐÈ'}
            </span>
          </div>
        </div>

        <div className="max-w-md w-full mx-auto bg-slate-900 border border-slate-800 rounded-lg p-8 shadow-2xl">
          <div className="border-b border-slate-800 pb-5 mb-6">
            <div className="flex items-center gap-2.5 text-xs font-mono uppercase tracking-widest text-slate-400 mb-1">
              <Shield className="w-4 h-4 text-sky-400" />
              <span>SEAZEN SECURITY CORPORATION</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              Hệ Thống Kiểm Soát Ra Vào & Sinh Trắc Học
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Điều khiển trực tiếp 4 máy ZKTeco SenseFace 4A · CSDL SQL Server (18 Bảng) · Đồng bộ SharePoint VMS
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 rounded bg-red-950/80 border border-red-800 text-xs text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Tài khoản vận hành
              </label>
              <input
                type="text"
                value={loginForm.credential}
                onChange={(e) => setLoginForm({ ...loginForm, credential: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="admin hoặc letan"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Mật khẩu
              </label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Nhập mật khẩu..."
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm rounded transition"
            >
              Đăng Nhập Hệ Thống
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800">
            <div className="text-[11px] font-mono uppercase text-slate-400 mb-2">
              Chọn nhanh tài khoản kiểm thử (DevTest):
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLoginForm({ credential: 'admin', password: '123' })}
                className="px-3 py-1.5 text-xs font-mono border border-slate-700 hover:border-slate-500 rounded text-left text-slate-300"
              >
                Admin (admin / 123)
              </button>
              <button
                type="button"
                onClick={() => setLoginForm({ credential: 'letan', password: '123' })}
                className="px-3 py-1.5 text-xs font-mono border border-slate-700 hover:border-slate-500 rounded text-left text-slate-300"
              >
                Lễ tân (letan / 123)
              </button>
            </div>
          </div>
        </div>

        <div className="text-center text-xs font-mono text-slate-500">
          SEAZEN VMS v2.0 · Chế độ bảo toàn dữ liệu Zero-Data-Loss · Khóa an toàn giờ NTP Việt Nam 2 lớp
        </div>
      </div>
    );
  }

  const pcClockInvalid = clockAudit && clockAudit.pc_clock_valid === false;

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      {/* 1. CRITICAL ANTI-CLOCK-DRIFT WARNING BANNER IF LOCAL PC DRIFTS > 30S */}
      {pcClockInvalid && (
        <div className="bg-red-700 text-white px-6 py-2.5 flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              CẢNH BÁO AN TOÀN GIỜ HỆ THỐNG: Giờ máy tính mở App ({clockAudit.local_pc_time}) đang lệch {clockAudit.pc_drift_sec} giây so với Giờ chuẩn Việt Nam UTC+7 ({clockAudit.vietnam_ntp_time}). Hệ thống đã tự động khóa đồng bộ giờ từ máy tính này để bảo vệ 4 máy quét mặt ZKTeco. Vui lòng chỉnh lại giờ Windows!
            </span>
          </div>
          <button
            onClick={() => setClockModalOpen(true)}
            className="px-3 py-1 bg-white text-red-800 font-semibold rounded text-xs shrink-0"
          >
            Kiểm Tra & Đối Soát Giờ
          </button>
        </div>
      )}

      {/* 2. TOP ENTERPRISE HEADER */}
      <header className="bg-slate-950 text-white border-b border-slate-800 px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-sky-600 flex items-center justify-center font-mono font-bold text-sm tracking-tighter">
              SZ
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-base">SEAZEN VMS</span>
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-sky-400 border border-slate-700">
                  SQL Server 18 Bảng + ZKTeco SenseFace 4A
                </span>
              </div>
              <div className="text-xs text-slate-400">
                Hệ thống Kiểm soát Ra Vào, Sinh Trắc Học Khuôn Mặt & Đồng Bộ SharePoint Online
              </div>
            </div>
          </div>

          {/* Live 3-Way Clock Guard Status Pill */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-400">VN NTP:</span>
                <span className="text-white font-semibold">{clockAudit?.vietnam_ntp_time?.split(' ')[1] || '--:--:--'}</span>
              </div>
              <span className="text-slate-700">|</span>
              <div>
                <span className="text-slate-400">PC:</span>{' '}
                <span className={pcClockInvalid ? 'text-red-400 font-bold' : 'text-slate-200'}>
                  {clockAudit?.local_pc_time?.split(' ')[1] || '--:--:--'} ({clockAudit?.pc_drift_sec ?? 0}s)
                </span>
              </div>
              <button
                onClick={() => setClockModalOpen(true)}
                className="ml-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded text-[11px]"
              >
                Khóa Giờ 2 Lớp
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs border-l border-slate-800 pl-3">
              <span className="text-slate-400">{user.full_name}</span>
              <span className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono uppercase text-[10px]">
                {user.role}
              </span>
              <button
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                title="Đăng xuất"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 3. PRIMARY NAVIGATION BAR (6 WORKSPACES) */}
      <nav className="bg-white border-b border-slate-200 px-6 sticky top-0 z-20 shadow-sm">
        <div className="max-w-[1600px] mx-auto flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'live', label: '1. Điều Khiển 4 Cửa & Giám Sát Trực Tuyến', icon: DoorOpen },
            { id: 'visitors', label: '2. Tiếp Đón Khách, Hẹn Trước & Nhà Thầu', icon: UserPlus },
            { id: 'hrm', label: '3. Danh Bạ Nhân Sự & Sinh Trắc Học (1.225)', icon: Users },
            { id: 'access', label: '4. Phân Quyền Cửa, Khung Giờ & Lệnh Máy', icon: KeyRound },
            { id: 'attendance', label: '5. Chấm Công & Ca Làm Việc', icon: Calendar },
            { id: 'database', label: '6. CSDL SQL (18 Bảng) & SharePoint VMS', icon: Database },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition ${
                  active
                    ? 'border-slate-900 text-slate-950 bg-slate-50'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white border border-slate-700 px-4 py-3 rounded shadow-xl flex items-center gap-3 text-xs">
          {toast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-6 space-y-6">
        {/* ===================================================================
            WORKSPACE 1: ĐIỀU KHIỂN 4 CỬA & GIÁM SÁT TRỰC TUYẾN
           =================================================================== */}
        {activeTab === 'live' && (
          <div className="space-y-6">
            {/* Top Hardware Control Grid (4 SenseFace 4A Terminals) */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                    <Server className="w-4 h-4 text-slate-700" />
                    <span>Bảng Điều Khiển Phần Cứng Trực Tiếp — 4 Máy ZKTeco SenseFace 4A (TCP 4370)</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Kết nối Socket trực tiếp không qua trung gian · Không gây văng tài khoản lễ tân ePAD
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDoorAll('UNLOCK_ALL', 3)}
                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded flex items-center gap-1.5"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>Mở Khẩn Cấp 4 Làn (3s)</span>
                  </button>
                  <button
                    onClick={() => handleDoorAll('LOCK_ALL', 0)}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded flex items-center gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Khóa Toàn Bộ 4 Làn</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { sn: '1313244800040', name: 'Làn VÀO phải', ip: '172.16.56.139', doorId: 1, dir: 'LÀN VÀO' },
                  { sn: '1313244800129', name: 'Làn VÀO trái', ip: '172.16.56.138', doorId: 1, dir: 'LÀN VÀO' },
                  { sn: '1313244800122', name: 'Làn RA trái', ip: '172.16.56.137', doorId: 2, dir: 'LÀN RA' },
                  { sn: '1313244800130', name: 'Làn RA phải', ip: '172.16.56.136', doorId: 2, dir: 'LÀN RA' },
                ].map((dev) => {
                  const devClock = clockAudit?.devices?.[dev.name];
                  const isUnlocking = doorLoading[`${dev.sn}_UNLOCK`];
                  return (
                    <div key={dev.sn} className="border border-slate-200 rounded-md p-4 bg-slate-50/70 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-mono mb-1.5">
                          <span className={`px-2 py-0.5 rounded font-semibold ${dev.doorId === 1 ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900'}`}>
                            {dev.dir}
                          </span>
                          <span className="text-emerald-700 font-semibold">ONLINE · {dev.ip}</span>
                        </div>
                        <div className="text-base font-bold text-slate-900">{dev.name}</div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          SN: {dev.sn} · Port 4370
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-200/80 text-[11px] font-mono text-slate-600 flex items-center justify-between">
                          <span>Giờ máy: {devClock?.device_time?.split(' ')[1] || '--:--:--'}</span>
                          <span className={Math.abs(devClock?.drift_vs_vn_sec || 0) > 60 ? 'text-amber-700 font-bold' : 'text-slate-500'}>
                            Lệch NTP: {devClock?.drift_vs_vn_sec ?? 0}s
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 mt-4">
                        <button
                          onClick={() => handleDoorControl('UNLOCK', dev.doorId, dev.sn, dev.name, 1)}
                          disabled={isUnlocking}
                          className="py-2 px-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded"
                        >
                          Mở 1s
                        </button>
                        <button
                          onClick={() => handleDoorControl('UNLOCK', dev.doorId, dev.sn, dev.name, 5)}
                          disabled={isUnlocking}
                          className="py-2 px-2 bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold rounded"
                        >
                          Mở 5s
                        </button>
                        <button
                          onClick={() => handleDoorControl('LOCK', dev.doorId, dev.sn, dev.name, 0)}
                          className="py-2 px-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-semibold rounded"
                        >
                          Khóa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* KPI Summary Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Nhân Sự Đang Ở Văn Phòng</div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {analytics?.currently_inside_staff ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Tính theo lượt quét cuối tại Làn VÀO</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Khách Đang Làm Việc</div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {activeVisitors.length}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Đang giữ thẻ RFID chưa check-out</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Tổng Lượt Quét Trong Ngày</div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {realtimeLogs.length}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Ngày đang chọn: {scanDate}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Tổng Bản Ghi CSDL SQL</div>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {sqlOverview.total_rows?.toLocaleString() || '5,152'}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Trên 18 bảng SeaZen_AccessControl</div>
              </div>
            </div>

            {/* Realtime Attendance & Door Scan Stream */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                    Luồng Nhật Ký Quét Khuôn Mặt & Thẻ Từ Thời Gian Thực
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tự động thu thập 24/7 từ 4 máy SenseFace 4A và lưu đồng thời vào bảng tbl_AttendanceLogs
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={scanDate}
                    onChange={(e) => setScanDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded text-xs font-mono"
                  />
                  <select
                    value={scanDirection}
                    onChange={(e) => setScanDirection(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  >
                    <option value="ALL">Tất cả hướng (Vào + Ra)</option>
                    <option value="IN">Chỉ Lượt VÀO</option>
                    <option value="OUT">Chỉ Lượt RA</option>
                  </select>
                  <select
                    value={scanCategory}
                    onChange={(e) => setScanCategory(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                  >
                    <option value="ALL">Tất cả đối tượng</option>
                    <option value="STAFF">Nhân viên chính thức</option>
                    <option value="VISITOR">Khách / Thẻ tạm</option>
                  </select>
                  <input
                    type="text"
                    value={scanSearch}
                    onChange={(e) => setScanSearch(e.target.value)}
                    placeholder="Tìm tên, mã ATID, phòng ban..."
                    className="px-3 py-1.5 border border-slate-300 rounded text-xs w-56"
                  />
                </div>
              </div>

              <div className="overflow-x-auto max-h-[460px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-mono text-[11px] sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 border-b border-slate-200">Thời Gian</th>
                      <th className="py-2.5 px-3 border-b border-slate-200">Mã ATID</th>
                      <th className="py-2.5 px-3 border-b border-slate-200">Họ Và Tên</th>
                      <th className="py-2.5 px-3 border-b border-slate-200">Phòng Ban</th>
                      <th className="py-2.5 px-3 border-b border-slate-200">Làn Cửa / Thiết Bị</th>
                      <th className="py-2.5 px-3 border-b border-slate-200">Hướng</th>
                      <th className="py-2.5 px-3 border-b border-slate-200">Xác Thực</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {realtimeLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          Không có lượt quét nào khớp bộ lọc trong ngày {scanDate}.
                        </td>
                      </tr>
                    ) : (
                      realtimeLogs.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono text-slate-800">{row.CheckTime}</td>
                          <td className="py-2 px-3 font-mono font-semibold text-slate-900">{row.EmployeeATID}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{row.FullName}</td>
                          <td className="py-2 px-3 text-slate-600">{row.Department || '--'}</td>
                          <td className="py-2 px-3 text-slate-700">{row.DeviceName}</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-semibold ${row.direction === 'IN' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
                              {row.direction_label || row.direction}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600">{row.VerifyMode || 'Face'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            WORKSPACE 2: TIẾP ĐÓN KHÁCH, HẸN TRƯỚC, NHÀ THẦU & KHO THẺ
           =================================================================== */}
        {activeTab === 'visitors' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 bg-white p-2 rounded-lg border border-slate-200">
              {[
                { id: 'checkin', label: 'Đăng Ký Khách & Quét QR CCCD (tbl_Visitors)' },
                { id: 'prereg', label: `Đăng Ký Hẹn Khách Trước (${preGuests.length})` },
                { id: 'contractors', label: `Quản Lý Nhà Thầu Thi Công (${contractors.length})` },
                { id: 'cards', label: `Kho Thẻ Từ Khách RFID (${customerCards.length})` },
              ].map((st) => (
                <button
                  key={st.id}
                  onClick={() => setVisitorSubTab(st.id)}
                  className={`px-3.5 py-2 rounded text-xs font-semibold transition ${
                    visitorSubTab === st.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {visitorSubTab === 'checkin' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Input Form: Visitor Check-in */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="border-b border-slate-200 pb-3">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                      Form Tiếp Đón Khách & Cấp Thẻ Tạm
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Lưu vào tbl_Visitors và nạp quyền thẻ trực tiếp xuống 4 máy ZKTeco SenseFace 4A
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Ô Quét Máy QR CCCD Gắn Chip (Tự động điền 7 trường)
                    </label>
                    <input
                      type="text"
                      value={qrInput}
                      onChange={(e) => handleParseQr(e.target.value)}
                      placeholder="Đặt con trỏ tại đây và bấm súng quét mã QR trên CCCD..."
                      className="w-full px-3 py-2 border border-sky-400 bg-sky-50/40 rounded text-xs font-mono"
                    />
                  </div>

                  <form onSubmit={handleRegisterVisitor} className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Họ và tên khách *</label>
                        <input
                          type="text"
                          value={visitorForm.full_name}
                          onChange={(e) => setVisitorForm({ ...visitorForm, full_name: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                          required
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Số CCCD / CMND *</label>
                        <input
                          type="text"
                          value={visitorForm.cccd_number}
                          onChange={(e) => setVisitorForm({ ...visitorForm, cccd_number: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded font-mono"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Số điện thoại</label>
                        <input
                          type="text"
                          value={visitorForm.phone}
                          onChange={(e) => setVisitorForm({ ...visitorForm, phone: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Đơn vị / Công ty khách</label>
                        <input
                          type="text"
                          value={visitorForm.company}
                          onChange={(e) => setVisitorForm({ ...visitorForm, company: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Phòng ban liên hệ</label>
                        <select
                          value={visitorForm.department}
                          onChange={(e) => setVisitorForm({ ...visitorForm, department: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        >
                          {departments.map((d) => (
                            <option key={d.DepartmentID} value={d.DepartmentName}>{d.DepartmentName}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Người tiếp đón bảo lãnh</label>
                        <input
                          type="text"
                          value={visitorForm.host_person}
                          onChange={(e) => setVisitorForm({ ...visitorForm, host_person: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Mã thẻ RFID cấp tạm</label>
                        <input
                          type="text"
                          list="available-cards-list"
                          value={visitorForm.card_number}
                          onChange={(e) => setVisitorForm({ ...visitorForm, card_number: e.target.value })}
                          placeholder="Quẹt thẻ hoặc chọn từ kho..."
                          className="w-full px-3 py-2 border border-slate-300 rounded font-mono"
                        />
                        <datalist id="available-cards-list">
                          {customerCards.map((c) => (
                            <option key={c.CardNumber} value={c.CardNumber}>
                              {c.CardCode} ({c.Status})
                            </option>
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Mục đích làm việc</label>
                        <input
                          type="text"
                          value={visitorForm.purpose}
                          onChange={(e) => setVisitorForm({ ...visitorForm, purpose: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visitorForm.auto_unlock}
                        onChange={(e) => setVisitorForm({ ...visitorForm, auto_unlock: e.target.checked })}
                      />
                      <span className="text-slate-700 font-medium">
                        Tự động kích mở Cửa Làn VÀO (1 giây) ngay sau khi lưu
                      </span>
                    </label>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded transition"
                    >
                      Đăng Ký Khách & Đồng Bộ Thẻ Xuống 4 Máy Cửa
                    </button>
                  </form>
                </div>

                {/* Right Panel: Fast Check-out & Active / Historical Visitors */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-lg p-5">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                      Check-Out Nhanh & Thu Hồi Thẻ Trên 4 Máy Cửa
                    </h3>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={checkoutQuery}
                        onChange={(e) => setCheckoutQuery(e.target.value)}
                        placeholder="Quẹt thẻ RFID trả lại hoặc quét QR CCCD để check-out..."
                        className="flex-1 px-3 py-2 border border-slate-300 rounded text-xs font-mono"
                      />
                      <button
                        onClick={() => handleFastCheckout()}
                        className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold rounded"
                      >
                        Check-Out & Thu Hồi Thẻ
                      </button>
                    </div>

                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase text-slate-500 mb-2">
                        Khách Đang Có Mặt Trong Tòa Nhà ({activeVisitors.length})
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-slate-100 text-slate-700 font-mono text-[11px]">
                            <tr>
                              <th className="py-2 px-3">Họ Tên Khách</th>
                              <th className="py-2 px-3">Số CCCD</th>
                              <th className="py-2 px-3">Mã Thẻ</th>
                              <th className="py-2 px-3">Phòng Ban / Người Tiếp</th>
                              <th className="py-2 px-3">Giờ Vào</th>
                              <th className="py-2 px-3 text-right">Thao Tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {activeVisitors.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-4 text-center text-slate-500">
                                  Hiện không có khách nào đang giữ thẻ.
                                </td>
                              </tr>
                            ) : (
                              activeVisitors.map((v) => (
                                <tr key={v.id}>
                                  <td className="py-2 px-3 font-semibold">{v.full_name}</td>
                                  <td className="py-2 px-3 font-mono">{v.cccd_number}</td>
                                  <td className="py-2 px-3 font-mono text-sky-700 font-semibold">{v.card_number || '--'}</td>
                                  <td className="py-2 px-3">{v.department} · {v.host_person}</td>
                                  <td className="py-2 px-3 font-mono">{v.checkin_time}</td>
                                  <td className="py-2 px-3 text-right">
                                    <button
                                      onClick={() => handleFastCheckout(v.id)}
                                      className="px-2.5 py-1 bg-slate-900 text-white rounded text-[11px]"
                                    >
                                      Trả Thẻ / Ra Về
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

                  <div className="bg-white border border-slate-200 rounded-lg p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                        Lịch Sử Khách Ra Vào Trong SQL Server ({visitorHistory.length})
                      </h3>
                      <a
                        href="/api/export/visitors"
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-semibold flex items-center gap-1.5"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Xuất Báo Cáo Excel</span>
                      </a>
                    </div>
                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-mono text-[11px] sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Mã Hồ Sơ</th>
                            <th className="py-2 px-3">Họ Tên Khách</th>
                            <th className="py-2 px-3">CCCD</th>
                            <th className="py-2 px-3">Thẻ RFID</th>
                            <th className="py-2 px-3">Giờ Vào</th>
                            <th className="py-2 px-3">Giờ Ra</th>
                            <th className="py-2 px-3">Trạng Thái</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {visitorHistory.map((h, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="py-2 px-3 font-mono">{h.VisitorID}</td>
                              <td className="py-2 px-3 font-medium">{h.FullName}</td>
                              <td className="py-2 px-3 font-mono">{h.CCCDNumber}</td>
                              <td className="py-2 px-3 font-mono">{h.CardNumber}</td>
                              <td className="py-2 px-3 font-mono">{h.CheckinTime}</td>
                              <td className="py-2 px-3 font-mono">{h.CheckoutTime || '--'}</td>
                              <td className="py-2 px-3 font-mono text-[11px]">{h.Status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SUB-TAB 2.2: PRE-REGISTERED GUESTS */}
            {visitorSubTab === 'prereg' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/visitor/pre_register', {
                      method: 'POST',
                      body: JSON.stringify(preGuestForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu lịch hẹn', 'error');
                    }
                  }}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Đăng Ký Hẹn Khách Trước (tbl_PreRegisteredGuests)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Họ tên khách hẹn *</label>
                      <input
                        type="text"
                        value={preGuestForm.GuestFullName}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestFullName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Số CCCD khách</label>
                      <input
                        type="text"
                        value={preGuestForm.GuestCCCD}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestCCCD: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Số điện thoại</label>
                      <input
                        type="text"
                        value={preGuestForm.GuestPhone}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestPhone: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Đơn vị / Công ty khách</label>
                      <input
                        type="text"
                        value={preGuestForm.GuestCompany}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, GuestCompany: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Cán bộ bảo lãnh *</label>
                      <input
                        type="text"
                        value={preGuestForm.HostEmployeeName}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, HostEmployeeName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Phòng ban bảo lãnh</label>
                      <input
                        type="text"
                        value={preGuestForm.HostDepartment}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, HostDepartment: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block font-semibold mb-1">Ngày hẹn</label>
                      <input
                        type="date"
                        value={preGuestForm.VisitDate}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, VisitDate: e.target.value })}
                        className="w-full px-2 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Từ giờ</label>
                      <input
                        type="text"
                        value={preGuestForm.StartTime}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, StartTime: e.target.value })}
                        className="w-full px-2 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Đến giờ</label>
                      <input
                        type="text"
                        value={preGuestForm.EndTime}
                        onChange={(e) => setPreGuestForm({ ...preGuestForm, EndTime: e.target.value })}
                        className="w-full px-2 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Nội dung làm việc</label>
                    <input
                      type="text"
                      value={preGuestForm.Purpose}
                      onChange={(e) => setPreGuestForm({ ...preGuestForm, Purpose: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Lịch Hẹn Khách Trước
                  </button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                    Danh Sách Lịch Hẹn Khách Trước ({preGuests.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Mã Hẹn</th>
                        <th className="py-2 px-3">Họ Tên Khách</th>
                        <th className="py-2 px-3">Đơn Vị</th>
                        <th className="py-2 px-3">Người Bảo Lãnh</th>
                        <th className="py-2 px-3">Ngày / Giờ</th>
                        <th className="py-2 px-3 text-right">Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {preGuests.map((g, i) => (
                        <tr key={i}>
                          <td className="py-2 px-3 font-mono">{g.BookingCode}</td>
                          <td className="py-2 px-3 font-semibold">{g.GuestFullName}</td>
                          <td className="py-2 px-3">{g.GuestCompany}</td>
                          <td className="py-2 px-3">{g.HostEmployeeName} ({g.HostDepartment})</td>
                          <td className="py-2 px-3 font-mono">{g.VisitDate} · {g.StartTime}</td>
                          <td className="py-2 px-3 text-right">
                            <button
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
                                  auto_unlock: false
                                });
                                setVisitorSubTab('checkin');
                              }}
                              className="px-2.5 py-1 bg-sky-700 text-white rounded text-[11px]"
                            >
                              Chuyển Vào Check-In
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUB-TAB 2.3: CONTRACTORS */}
            {visitorSubTab === 'contractors' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/visitor/contractor', {
                      method: 'POST',
                      body: JSON.stringify(contractorForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu nhà thầu', 'error');
                    }
                  }}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Đăng Ký Nhân Sự Nhà Thầu (tbl_Contractors)
                  </h3>
                  <div>
                    <label className="block font-semibold mb-1">Tên công ty nhà thầu *</label>
                    <input
                      type="text"
                      value={contractorForm.ContractorCompany}
                      onChange={(e) => setContractorForm({ ...contractorForm, ContractorCompany: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Họ tên nhân sự thi công *</label>
                      <input
                        type="text"
                        value={contractorForm.WorkerFullName}
                        onChange={(e) => setContractorForm({ ...contractorForm, WorkerFullName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Số CCCD</label>
                      <input
                        type="text"
                        value={contractorForm.CCCDNumber}
                        onChange={(e) => setContractorForm({ ...contractorForm, CCCDNumber: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã thẻ RFID cấp phát</label>
                      <input
                        type="text"
                        value={contractorForm.CardNumber}
                        onChange={(e) => setContractorForm({ ...contractorForm, CardNumber: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Khu vực thi công</label>
                      <input
                        type="text"
                        value={contractorForm.WorkArea}
                        onChange={(e) => setContractorForm({ ...contractorForm, WorkArea: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Hiệu lực từ ngày</label>
                      <input
                        type="date"
                        value={contractorForm.ValidFrom}
                        onChange={(e) => setContractorForm({ ...contractorForm, ValidFrom: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Đến ngày</label>
                      <input
                        type="date"
                        value={contractorForm.ValidTo}
                        onChange={(e) => setContractorForm({ ...contractorForm, ValidTo: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Hồ Sơ Nhà Thầu
                  </button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                    Danh Sách Nhà Thầu Thi Công ({contractors.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Mã NT</th>
                        <th className="py-2 px-3">Đơn Vị Nhà Thầu</th>
                        <th className="py-2 px-3">Nhân Sự</th>
                        <th className="py-2 px-3">Thẻ RFID</th>
                        <th className="py-2 px-3">Khu Vực</th>
                        <th className="py-2 px-3">Thời Hạn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {contractors.map((c, i) => (
                        <tr key={i}>
                          <td className="py-2 px-3 font-mono">{c.ContractorCode}</td>
                          <td className="py-2 px-3 font-medium">{c.ContractorCompany}</td>
                          <td className="py-2 px-3 font-semibold">{c.WorkerFullName}</td>
                          <td className="py-2 px-3 font-mono">{c.CardNumber}</td>
                          <td className="py-2 px-3">{c.WorkArea}</td>
                          <td className="py-2 px-3 font-mono">{c.ValidFrom} → {c.ValidTo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUB-TAB 2.4: CUSTOMER CARDS POOL */}
            {visitorSubTab === 'cards' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
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
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu thẻ', 'error');
                    }
                  }}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Khai Báo Thẻ Vào Kho Thẻ (tbl_CustomerCards)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã định danh thẻ</label>
                      <input
                        type="text"
                        value={cardForm.CardCode}
                        onChange={(e) => setCardForm({ ...cardForm, CardCode: e.target.value })}
                        placeholder="VD: CARD-001"
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Số thẻ RFID *</label>
                      <input
                        type="text"
                        value={cardForm.CardNumber}
                        onChange={(e) => setCardForm({ ...cardForm, CardNumber: e.target.value })}
                        placeholder="Quẹt thẻ lên đầu đọc..."
                        className="w-full px-3 py-2 border rounded font-mono"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Phân loại thẻ</label>
                      <select
                        value={cardForm.CardType}
                        onChange={(e) => setCardForm({ ...cardForm, CardType: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      >
                        <option value="VISITOR">VISITOR (Thẻ Khách)</option>
                        <option value="CONTRACTOR">CONTRACTOR (Thẻ Nhà thầu)</option>
                        <option value="VIP">VIP (Khách Đoàn / VIP)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Trạng thái</label>
                      <select
                        value={cardForm.Status}
                        onChange={(e) => setCardForm({ ...cardForm, Status: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      >
                        <option value="AVAILABLE">AVAILABLE (Sẵn sàng cấp)</option>
                        <option value="ASSIGNED">ASSIGNED (Đang cấp cho khách)</option>
                        <option value="LOCKED">LOCKED (Khóa / Thu hồi)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Ghi chú</label>
                    <input
                      type="text"
                      value={cardForm.Notes}
                      onChange={(e) => setCardForm({ ...cardForm, Notes: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Vào Kho Thẻ
                  </button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                    Danh Sách Kho Thẻ RFID ({customerCards.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Mã Thẻ</th>
                        <th className="py-2 px-3">Số Thẻ RFID</th>
                        <th className="py-2 px-3">Loại Thẻ</th>
                        <th className="py-2 px-3">Trạng Thái</th>
                        <th className="py-2 px-3">Ghi Chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {customerCards.map((c, i) => (
                        <tr key={i}>
                          <td className="py-2 px-3 font-mono font-semibold">{c.CardCode}</td>
                          <td className="py-2 px-3 font-mono text-sky-700 font-semibold">{c.CardNumber}</td>
                          <td className="py-2 px-3 font-mono">{c.CardType}</td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded font-mono text-[11px] ${c.Status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {c.Status}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-600">{c.Notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            WORKSPACE 3: DANH BẠ NHÂN SỰ, PHÒNG BAN & SINH TRẮC HỌC
           =================================================================== */}
        {activeTab === 'hrm' && (
          <div className="space-y-6">
            <div className="flex gap-2 bg-white p-2 rounded-lg border border-slate-200">
              <button
                onClick={() => setHrmSubTab('employees')}
                className={`px-3.5 py-2 rounded text-xs font-semibold ${hrmSubTab === 'employees' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                Hồ Sơ Nhân Sự & Sinh Trắc Học Khuôn Mặt (tbl_Employees & tbl_EmployeeBiometrics)
              </button>
              <button
                onClick={() => setHrmSubTab('departments')}
                className={`px-3.5 py-2 rounded text-xs font-semibold ${hrmSubTab === 'departments' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                Cơ Cấu Phòng Ban Đa Cấp ({departments.length})
              </button>
            </div>

            {hrmSubTab === 'employees' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Employee & Biometrics Input Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/hrm/employee', {
                      method: 'POST',
                      body: JSON.stringify(empForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu nhân sự', 'error');
                    }
                  }}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <div className="border-b border-slate-200 pb-2">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                      Form Thêm / Cập Nhật Nhân Sự & Sinh Trắc Học
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Cập nhật đồng thời tbl_Employees, tbl_EmployeeBiometrics và nạp xuống 4 máy ZKTeco
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã ATID (Trên máy ZK) *</label>
                      <input
                        type="text"
                        value={empForm.EmployeeATID}
                        onChange={(e) => setEmpForm({ ...empForm, EmployeeATID: e.target.value })}
                        placeholder="VD: 10903"
                        className="w-full px-3 py-2 border rounded font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Mã Nhân Viên HR</label>
                      <input
                        type="text"
                        value={empForm.EmployeeCode}
                        onChange={(e) => setEmpForm({ ...empForm, EmployeeCode: e.target.value })}
                        placeholder="VD: SZ10903"
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Họ và tên nhân sự *</label>
                    <input
                      type="text"
                      value={empForm.FullName}
                      onChange={(e) => setEmpForm({ ...empForm, FullName: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Phòng ban</label>
                      <select
                        value={empForm.DepartmentName}
                        onChange={(e) => setEmpForm({ ...empForm, DepartmentName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      >
                        {departments.map((d) => (
                          <option key={d.DepartmentID} value={d.DepartmentName}>{d.DepartmentName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Chức vụ</label>
                      <input
                        type="text"
                        value={empForm.Position}
                        onChange={(e) => setEmpForm({ ...empForm, Position: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã Thẻ Từ RFID</label>
                      <input
                        type="text"
                        value={empForm.CardNumber}
                        onChange={(e) => setEmpForm({ ...empForm, CardNumber: e.target.value })}
                        placeholder="Quẹt thẻ..."
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Quyền trên máy ZKTeco</label>
                      <select
                        value={empForm.Privilege}
                        onChange={(e) => setEmpForm({ ...empForm, Privilege: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded"
                      >
                        <option value={0}>0 — Nhân viên (User chuẩn)</option>
                        <option value={14}>14 — Quản trị máy (Super Admin)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Ảnh chân dung nhận diện (BIOPHOTO)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="w-full text-xs"
                    />
                  </div>

                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={empForm.sync_to_hardware}
                      onChange={(e) => setEmpForm({ ...empForm, sync_to_hardware: e.target.checked })}
                    />
                    <span className="font-medium text-slate-800">
                      Đồng bộ nạp trực tiếp xuống 4 máy ZKTeco SenseFace 4A (TCP 4370)
                    </span>
                  </label>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded"
                  >
                    Lưu Hồ Sơ Nhân Sự & Sinh Trắc Học
                  </button>
                </form>

                {/* Employee Directory Table */}
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                        Danh Bạ Nhân Sự & Trạng Thái Sinh Trắc Học ({empTotal} Nhân Sự)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Bấm vào bất kỳ dòng nhân sự nào để nạp thông tin sang Form chỉnh sửa bên trái
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={empDeptFilter}
                        onChange={(e) => { setEmpDeptFilter(e.target.value); setEmpPage(1); }}
                        className="px-2.5 py-1.5 border rounded text-xs"
                      >
                        <option value="">Tất cả phòng ban</option>
                        {departments.map((d) => (
                          <option key={d.DepartmentID} value={d.DepartmentName}>{d.DepartmentName}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={empSearch}
                        onChange={(e) => { setEmpSearch(e.target.value); setEmpPage(1); }}
                        placeholder="Tìm tên, mã ATID, số thẻ..."
                        className="px-3 py-1.5 border rounded text-xs w-52"
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-100 font-mono text-[11px] sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Mã ATID</th>
                          <th className="py-2 px-3">Họ Và Tên</th>
                          <th className="py-2 px-3">Phòng Ban</th>
                          <th className="py-2 px-3">Mã Thẻ RFID</th>
                          <th className="py-2 px-3">Sinh Trắc Học</th>
                          <th className="py-2 px-3 text-right">Chọn Sửa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {employees.map((emp, idx) => (
                          <tr
                            key={idx}
                            onClick={() => setEmpForm({
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
                              sync_to_hardware: false
                            })}
                            className="hover:bg-sky-50/60 cursor-pointer"
                          >
                            <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                              {emp.atid || emp.EmployeeATID}
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              {emp.fullname || emp.FullName}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {emp.department || emp.DepartmentName}
                            </td>
                            <td className="py-2 px-3 font-mono text-sky-700">
                              {emp.card_number || emp.CardNumber || '--'}
                            </td>
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[10px]">
                                Face V2
                              </span>
                              {(emp.card_number || emp.CardNumber) && (
                                <span className="ml-1 px-2 py-0.5 rounded bg-sky-100 text-sky-900 font-mono text-[10px]">
                                  RFID
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-sky-700">
                              Nạp Form →
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {hrmSubTab === 'departments' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
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
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu phòng ban', 'error');
                    }
                  }}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Thêm / Cập Nhật Phòng Ban (tbl_Departments)
                  </h3>
                  <div>
                    <label className="block font-semibold mb-1">Mã phòng ban</label>
                    <input
                      type="text"
                      value={deptForm.DepartmentCode}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentCode: e.target.value })}
                      placeholder="VD: DEPT-BGD"
                      className="w-full px-3 py-2 border rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Tên phòng ban *</label>
                    <input
                      type="text"
                      value={deptForm.DepartmentName}
                      onChange={(e) => setDeptForm({ ...deptForm, DepartmentName: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Địa điểm</label>
                    <input
                      type="text"
                      value={deptForm.Location}
                      onChange={(e) => setDeptForm({ ...deptForm, Location: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Mô tả</label>
                    <input
                      type="text"
                      value={deptForm.Description}
                      onChange={(e) => setDeptForm({ ...deptForm, Description: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Phòng Ban
                  </button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                    Danh Sách Phòng Ban Trong SQL Server ({departments.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">ID</th>
                        <th className="py-2 px-3">Mã Phòng Ban</th>
                        <th className="py-2 px-3">Tên Phòng Ban</th>
                        <th className="py-2 px-3">Cấp Bậc</th>
                        <th className="py-2 px-3">Trạng Thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {departments.map((d) => (
                        <tr key={d.DepartmentID}>
                          <td className="py-2 px-3 font-mono">{d.DepartmentID}</td>
                          <td className="py-2 px-3 font-mono">{d.DepartmentCode}</td>
                          <td className="py-2 px-3 font-semibold">{d.DepartmentName}</td>
                          <td className="py-2 px-3 font-mono">Cấp {d.Level}</td>
                          <td className="py-2 px-3">
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded font-mono text-[10px]">
                              Đang hoạt động
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            WORKSPACE 4: PHÂN QUYỀN CỬA, KHUNG GIỜ & LỆNH PHẦN CỨNG
           =================================================================== */}
        {activeTab === 'access' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2 bg-white p-2 rounded-lg border border-slate-200">
              {[
                { id: 'timezones', label: `Khung Giờ Mở Cửa (${timezones.length})` },
                { id: 'groups', label: `Nhóm Phân Quyền Cửa (${accessGroups.length})` },
                { id: 'commands', label: `Hàng Đợi Lệnh Phần Cứng & Nhật Ký Mở Cửa` },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAccessSubTab(t.id)}
                  className={`px-3.5 py-2 rounded text-xs font-semibold ${accessSubTab === t.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {accessSubTab === 'timezones' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/access/timezone', {
                      method: 'POST',
                      body: JSON.stringify(tzForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu khung giờ', 'error');
                    }
                  }}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Cấu Hình Khung Giờ Mở Cửa (tbl_AccessTimezones)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã khung giờ *</label>
                      <input
                        type="text"
                        value={tzForm.TimezoneCode}
                        onChange={(e) => setTzForm({ ...tzForm, TimezoneCode: e.target.value })}
                        placeholder="VD: TZ_CA_XOAY"
                        className="w-full px-3 py-2 border rounded font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Tên khung giờ *</label>
                      <input
                        type="text"
                        value={tzForm.TimezoneName}
                        onChange={(e) => setTzForm({ ...tzForm, TimezoneName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block font-semibold mb-1">Thứ 2 - Thứ 6</label>
                      <input
                        type="text"
                        value={tzForm.MonTime}
                        onChange={(e) => setTzForm({
                          ...tzForm,
                          MonTime: e.target.value, TueTime: e.target.value,
                          WedTime: e.target.value, ThuTime: e.target.value, FriTime: e.target.value
                        })}
                        className="w-full px-2 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Thứ Bảy</label>
                      <input
                        type="text"
                        value={tzForm.SatTime}
                        onChange={(e) => setTzForm({ ...tzForm, SatTime: e.target.value })}
                        className="w-full px-2 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Chủ Nhật</label>
                      <input
                        type="text"
                        value={tzForm.SunTime}
                        onChange={(e) => setTzForm({ ...tzForm, SunTime: e.target.value })}
                        className="w-full px-2 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Mô tả</label>
                    <input
                      type="text"
                      value={tzForm.Description}
                      onChange={(e) => setTzForm({ ...tzForm, Description: e.target.value })}
                      className="w-full px-3 py-2 border rounded"
                    />
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Khung Giờ Mở Cửa
                  </button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                    Danh Sách Khung Giờ Mở Cửa ({timezones.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Mã TZ</th>
                        <th className="py-2 px-3">Tên Khung Giờ</th>
                        <th className="py-2 px-3">Thứ 2 - Thứ 6</th>
                        <th className="py-2 px-3">Thứ 7</th>
                        <th className="py-2 px-3">Chủ Nhật</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {timezones.map((tz) => (
                        <tr key={tz.TimezoneID}>
                          <td className="py-2 px-3 font-mono font-semibold">{tz.TimezoneCode}</td>
                          <td className="py-2 px-3 font-semibold">{tz.TimezoneName}</td>
                          <td className="py-2 px-3 font-mono">{tz.MonTime}</td>
                          <td className="py-2 px-3 font-mono">{tz.SatTime}</td>
                          <td className="py-2 px-3 font-mono">{tz.SunTime}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {accessSubTab === 'groups' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/access/group', {
                      method: 'POST',
                      body: JSON.stringify(groupForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu nhóm quyền', 'error');
                    }
                  }}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Nhóm Phân Quyền Cửa (tbl_AccessGroups)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã nhóm quyền *</label>
                      <input
                        type="text"
                        value={groupForm.GroupCode}
                        onChange={(e) => setGroupForm({ ...groupForm, GroupCode: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Tên nhóm quyền *</label>
                      <input
                        type="text"
                        value={groupForm.GroupName}
                        onChange={(e) => setGroupForm({ ...groupForm, GroupName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Cửa cho phép đi qua</label>
                      <input
                        type="text"
                        value={groupForm.AllowedDoors}
                        onChange={(e) => setGroupForm({ ...groupForm, AllowedDoors: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Phương thức xác thực</label>
                      <input
                        type="text"
                        value={groupForm.VerifyMode}
                        onChange={(e) => setGroupForm({ ...groupForm, VerifyMode: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Nhóm Phân Quyền Cửa
                  </button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                    Ánh Xạ Phân Quyền Phòng Ban Vào Nhóm Cửa ({deptAccessGroups.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Phòng Ban</th>
                        <th className="py-2 px-3">Nhóm Quyền Cửa Áp Dụng</th>
                        <th className="py-2 px-3">Người Cập Nhật</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {deptAccessGroups.map((m, i) => (
                        <tr key={i}>
                          <td className="py-2 px-3 font-semibold">{m.DepartmentName}</td>
                          <td className="py-2 px-3 text-sky-800 font-medium">{m.GroupName}</td>
                          <td className="py-2 px-3 text-slate-500">{m.UpdatedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {accessSubTab === 'commands' && (
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                  Nhật Ký Hàng Đợi Lệnh Thiết Bị ZKTeco (tbl_DeviceCommands)
                </h3>
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 font-mono text-[11px]">
                    <tr>
                      <th className="py-2 px-3">ID</th>
                      <th className="py-2 px-3">Mã Lệnh</th>
                      <th className="py-2 px-3">Thiết Bị Đích</th>
                      <th className="py-2 px-3">Giao Thức</th>
                      <th className="py-2 px-3">Trạng Thái</th>
                      <th className="py-2 px-3">Kết Quả Thực Thi</th>
                      <th className="py-2 px-3">Thời Gian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {deviceCommands.map((c) => (
                      <tr key={c.CommandID}>
                        <td className="py-2 px-3 font-mono">{c.CommandID}</td>
                        <td className="py-2 px-3 font-mono font-semibold">{c.CommandCode}</td>
                        <td className="py-2 px-3">{c.TargetDeviceName}</td>
                        <td className="py-2 px-3 font-mono">{c.Protocol}</td>
                        <td className="py-2 px-3 font-mono text-emerald-700 font-semibold">{c.Status}</td>
                        <td className="py-2 px-3 text-slate-600 max-w-md truncate">{c.ResultMessage}</td>
                        <td className="py-2 px-3 font-mono">{c.ExecutedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            WORKSPACE 5: CHẤM CÔNG, CA LÀM VIỆC & TỔNG HỢP CÔNG
           =================================================================== */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            <div className="flex gap-2 bg-white p-2 rounded-lg border border-slate-200">
              <button
                onClick={() => setAttSubTab('daily')}
                className={`px-3.5 py-2 rounded text-xs font-semibold ${attSubTab === 'daily' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                Bảng Tổng Hợp Công Hàng Ngày ({dailyTimekeeping.length} Bản Ghi)
              </button>
              <button
                onClick={() => setAttSubTab('shifts')}
                className={`px-3.5 py-2 rounded text-xs font-semibold ${attSubTab === 'shifts' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                Cấu Hình Ca Làm Việc ({shifts.length})
              </button>
            </div>

            {attSubTab === 'daily' && (
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="pb-3 mb-3 border-b border-slate-200">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                    Bảng Tổng Hợp Chấm Công Đầu Giờ - Cuối Giờ (tbl_DailyTimekeeping)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tự động đối soát lần quét đầu tiên (First-In) và lần quét cuối cùng (Last-Out) theo ca làm việc chuẩn
                  </p>
                </div>
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px] sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Ngày Làm Việc</th>
                        <th className="py-2 px-3">Mã ATID</th>
                        <th className="py-2 px-3">Họ Và Tên</th>
                        <th className="py-2 px-3">Phòng Ban</th>
                        <th className="py-2 px-3">Giờ Vào Đầu</th>
                        <th className="py-2 px-3">Giờ Ra Cuối</th>
                        <th className="py-2 px-3">Số Lần Quét</th>
                        <th className="py-2 px-3">Đi Trễ (Phút)</th>
                        <th className="py-2 px-3">Tổng Giờ</th>
                        <th className="py-2 px-3">Trạng Thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {dailyTimekeeping.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono">{r.WorkDate}</td>
                          <td className="py-2 px-3 font-mono font-semibold">{r.EmployeeATID}</td>
                          <td className="py-2 px-3 font-semibold">{r.FullName}</td>
                          <td className="py-2 px-3">{r.DepartmentName}</td>
                          <td className="py-2 px-3 font-mono text-emerald-700">{r.FirstInTime?.split(' ')[1] || r.FirstInTime}</td>
                          <td className="py-2 px-3 font-mono text-sky-700">{r.LastOutTime?.split(' ')[1] || '--'}</td>
                          <td className="py-2 px-3 font-mono">{r.TotalScans}</td>
                          <td className="py-2 px-3 font-mono text-amber-700">{r.LateMinutes}</td>
                          <td className="py-2 px-3 font-mono font-semibold">{r.TotalHours}h</td>
                          <td className="py-2 px-3 font-mono text-[11px]">{r.AttendanceStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {attSubTab === 'shifts' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { ok, data } = await apiFetch('/api/attendance/shift', {
                      method: 'POST',
                      body: JSON.stringify(shiftForm),
                    });
                    if (ok && data.success) {
                      notify(data.message, 'success');
                      fetchAllEnterpriseData();
                    } else {
                      notify(data.error || 'Lỗi lưu ca làm việc', 'error');
                    }
                  }}
                  className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 border-b pb-2">
                    Form Thiết Lập Ca Làm Việc (tbl_Shifts)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Mã ca *</label>
                      <input
                        type="text"
                        value={shiftForm.ShiftCode}
                        onChange={(e) => setShiftForm({ ...shiftForm, ShiftCode: e.target.value })}
                        placeholder="VD: CA_HC_0800"
                        className="w-full px-3 py-2 border rounded font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Tên ca làm việc *</label>
                      <input
                        type="text"
                        value={shiftForm.ShiftName}
                        onChange={(e) => setShiftForm({ ...shiftForm, ShiftName: e.target.value })}
                        className="w-full px-3 py-2 border rounded"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Giờ vào ca</label>
                      <input
                        type="text"
                        value={shiftForm.CheckInTime}
                        onChange={(e) => setShiftForm({ ...shiftForm, CheckInTime: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Giờ tan ca</label>
                      <input
                        type="text"
                        value={shiftForm.CheckOutTime}
                        onChange={(e) => setShiftForm({ ...shiftForm, CheckOutTime: e.target.value })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Số phút cho phép đi trễ</label>
                      <input
                        type="number"
                        value={shiftForm.GraceLateMinutes}
                        onChange={(e) => setShiftForm({ ...shiftForm, GraceLateMinutes: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Tổng giờ công chuẩn</label>
                      <input
                        type="number"
                        step="0.5"
                        value={shiftForm.WorkingHours}
                        onChange={(e) => setShiftForm({ ...shiftForm, WorkingHours: Number(e.target.value) })}
                        className="w-full px-3 py-2 border rounded font-mono"
                      />
                    </div>
                  </div>
                  <button type="submit" className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded">
                    Lưu Ca Làm Việc
                  </button>
                </form>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-3">
                    Danh Mục Ca Làm Việc ({shifts.length})
                  </h3>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 font-mono text-[11px]">
                      <tr>
                        <th className="py-2 px-3">Mã Ca</th>
                        <th className="py-2 px-3">Tên Ca Làm Việc</th>
                        <th className="py-2 px-3">Giờ Vào - Tan Ca</th>
                        <th className="py-2 px-3">Nghỉ Trưa</th>
                        <th className="py-2 px-3">Giờ Chuẩn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {shifts.map((s) => (
                        <tr key={s.ShiftID}>
                          <td className="py-2 px-3 font-mono font-semibold">{s.ShiftCode}</td>
                          <td className="py-2 px-3 font-semibold">{s.ShiftName}</td>
                          <td className="py-2 px-3 font-mono">{s.CheckInTime} - {s.CheckOutTime}</td>
                          <td className="py-2 px-3 font-mono">{s.BreakStartTime} - {s.BreakEndTime}</td>
                          <td className="py-2 px-3 font-mono">{s.WorkingHours}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            WORKSPACE 6: CSDL SQL (18 BẢNG), ĐỒNG BỘ NGẦM & SHAREPOINT VMS
           =================================================================== */}
        {activeTab === 'database' && (
          <div className="space-y-6">
            {/* Top Action Bar: Safe Non-Destructive Sync Test & SharePoint Provision */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                  Trung Tâm Quản Trị 18 Bảng SQL Server (`SeaZen_AccessControl`) & Đồng Bộ SharePoint (`VMS SEAZEN - ...`)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Máy chủ SQL: {sqlOverview.connection?.server || 'Seazen-Admin'} · Tài khoản SharePoint OAuth2: {spStatus.account || 'Chưa kết nối'} (App ID: 0390280b-12b8-49c4-adbf-a9c2b8bccfb5)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleRunSafeSyncTest}
                  disabled={syncBusy}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncBusy ? 'animate-spin' : ''}`} />
                  <span>Test Đồng Bộ Ngầm An Toàn (ePAD ServiceId=1 + ZKTeco 4370)</span>
                </button>
                <button
                  onClick={handleProvisionSharePointLists}
                  disabled={syncBusy}
                  className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold rounded flex items-center gap-2"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  <span>Khởi Tạo 18 List "VMS SEAZEN - (Tên bảng)" Trên SharePoint</span>
                </button>
              </div>
            </div>

            {lastSyncReport && (
              <div className="bg-emerald-950 text-emerald-100 border border-emerald-800 rounded-lg p-4 text-xs font-mono">
                <div className="font-bold text-emerald-300 mb-1">
                  KẾT QUẢ KIỂM THỬ API NGẦM (BẢO TOÀN 100% DỮ LIỆU GỐC - KHÔNG VĂNG LỄ TÂN):
                </div>
                <div>
                  · ePAD Stateless ServiceId=1 Sync: OK={String(lastSyncReport.epad_stateless_sync?.ok)} |
                  ZKTeco Hardware Read-Only Users Synced: {lastSyncReport.zk_hardware_readonly_sync?.hardware_users_synced} |
                  VN NTP Time: {lastSyncReport.zk_hardware_readonly_sync?.clock_audit?.vietnam_ntp_time}
                </div>
              </div>
            )}

            {/* 18 SQL Tables & SharePoint Lists Mapping Matrix */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3">
                  Danh Sách 18 Bảng CSDL SQL & List SharePoint Tương Ứng
                </h3>
                <div className="divide-y divide-slate-200 max-h-[540px] overflow-y-auto">
                  {sqlOverview.tables?.map((t) => {
                    const spItem = spStatus.schemas?.find((s) => s.sql_table === t.table_name);
                    const isSelected = selectedSqlTable === t.table_name;
                    return (
                      <div
                        key={t.table_name}
                        onClick={() => setSelectedSqlTable(t.table_name)}
                        className={`p-3 cursor-pointer transition flex items-center justify-between gap-2 ${
                          isSelected ? 'bg-slate-900 text-white rounded' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold">{t.sharepoint_list_name}</div>
                          <div className={`text-[11px] font-mono ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                            SQL: {t.table_name} · {t.row_count} bản ghi
                            {spItem?.exists_on_sharepoint ? ` · SP: Đã tạo (${spItem.sp_item_count} mục)` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSyncSingleTableToSharePoint(t.table_name);
                          }}
                          disabled={syncBusy}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold shrink-0 ${
                            isSelected
                              ? 'bg-sky-500 text-white hover:bg-sky-400'
                              : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                          }`}
                        >
                          Đẩy Lên SP
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Live SQL Table Data Inspector & SharePoint Vietnamese Columns */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                {(() => {
                  const spMeta = spStatus.schemas?.find((s) => s.sql_table === selectedSqlTable);
                  return (
                    <div className="border-b border-slate-200 pb-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                          Dữ Liệu Bảng: {selectedSqlTable} ({sqlTableRows.length} dòng hiển thị)
                        </h3>
                        <span className="text-xs font-mono text-sky-700 font-semibold">
                          {spMeta?.list_title}
                        </span>
                      </div>
                      {spMeta?.vietnamese_columns && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="text-[11px] text-slate-500 font-semibold">Các cột Tiếng Việt trên SharePoint:</span>
                          {spMeta.vietnamese_columns.map((c, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[11px] text-slate-700">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="overflow-x-auto max-h-[460px]">
                  {sqlTableRows.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      Bảng {selectedSqlTable} hiện chưa có bản ghi nào.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-100 font-mono text-[11px] sticky top-0">
                        <tr>
                          {Object.keys(sqlTableRows[0]).slice(0, 8).map((col) => (
                            <th key={col} className="py-2 px-2.5 border-b border-slate-200">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sqlTableRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            {Object.keys(sqlTableRows[0]).slice(0, 8).map((col) => (
                              <td key={col} className="py-2 px-2.5 font-mono text-[11px] max-w-[180px] truncate">
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* =====================================================================
          MODAL XÁC NHẬN 2 LỚP ĐỒNG BỘ GIỜ CHUẨN VIỆT NAM (NTP UTC+7)
         ===================================================================== */}
      {clockModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-300 rounded-lg max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Khóa An Toàn Đồng Hồ 2 Lớp — Chuẩn Quốc Gia Việt Nam (NTP UTC+7)
                </h3>
                <p className="text-xs text-slate-500">
                  Ngăn chặn tuyệt đối việc máy tính sai giờ kéo lệch giờ của 4 máy chấm công ZKTeco
                </p>
              </div>
              <button
                onClick={() => setClockModalOpen(false)}
                className="text-xs font-mono text-slate-500 hover:text-slate-900"
              >
                [ĐÓNG]
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded p-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">1. Giờ Chuẩn Việt Nam (NTP UTC+7):</span>
                <strong className="text-emerald-700">{clockAudit?.vietnam_ntp_time || '--'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">2. Giờ Cục Bộ Trên Máy Tính Mở App:</span>
                <strong className={pcClockInvalid ? 'text-red-600' : 'text-slate-900'}>
                  {clockAudit?.local_pc_time || '--'} (Lệch: {clockAudit?.pc_drift_sec ?? 0}s)
                </strong>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <div className="text-slate-500 mb-1">3. Giờ Thực Tế Trên 4 Máy ZKTeco SenseFace 4A:</div>
                {Object.entries(clockAudit?.devices || {}).map(([name, info]) => (
                  <div key={name} className="flex justify-between py-0.5">
                    <span>· {name} ({info.ip}):</span>
                    <span>{info.device_time || info.status} (Lệch NTP: {info.drift_vs_vn_sec ?? 0}s)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 2-Layer Confirmation Controls */}
            <div className="space-y-3 text-xs bg-amber-50/70 border border-amber-200 rounded p-4">
              <div className="font-bold text-amber-950 uppercase">
                Quy trình xác nhận 2 lớp bắt buộc khi ghi giờ xuống 4 máy ZKTeco:
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clockConfirmStep1}
                  onChange={(e) => setClockConfirmStep1(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-slate-800">
                  <strong>Lớp 1:</strong> Tôi xác nhận chỉ lấy <strong>Giờ chuẩn NTP Việt Nam ({clockAudit?.vietnam_ntp_time})</strong> để đồng bộ xuống 4 máy ZKTeco, tuyệt đối không lấy giờ cục bộ của máy tính.
                </span>
              </label>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-800">
                    <strong>Lớp 2:</strong> Nhập mã xác nhận an toàn <code className="bg-white px-1.5 py-0.5 border rounded">CONFIRM_VN_NTP_SYNC</code>
                  </label>
                  <button
                    type="button"
                    onClick={() => setClockConfirmCode('CONFIRM_VN_NTP_SYNC')}
                    className="text-[11px] font-mono text-sky-700 underline"
                  >
                    Điền nhanh mã
                  </button>
                </div>
                <input
                  type="text"
                  value={clockConfirmCode}
                  onChange={(e) => setClockConfirmCode(e.target.value)}
                  placeholder="Nhập CONFIRM_VN_NTP_SYNC"
                  className="w-full px-3 py-2 border border-slate-300 rounded font-mono bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setClockModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded text-xs font-semibold text-slate-700"
              >
                Hủy Bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmedClockSync}
                disabled={clockSyncing || !clockConfirmStep1 || clockConfirmCode !== 'CONFIRM_VN_NTP_SYNC'}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded text-xs font-semibold"
              >
                {clockSyncing ? 'Đang Đồng Bộ...' : 'Xác Nhận Đồng Bộ Giờ Chuẩn NTP Việt Nam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
