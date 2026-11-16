import React, { useState, useEffect, useCallback } from 'react';
import { ROUTES } from './constants/routes';
import { apiFetch } from './services/apiClient';
import SidebarShell from './components/shell/SidebarShell';
import ClockSafetyModal from './components/common/ClockSafetyModal';
import LoginPage from './pages/auth/LoginPage';
import LiveCommandPage from './pages/live/LiveCommandPage';
import VisitorManagementPage from './pages/visitors/VisitorManagementPage';
import HrmBiometricsPage from './pages/hrm/HrmBiometricsPage';
import AccessRulesPage from './pages/access/AccessRulesPage';
import TimekeepingPage from './pages/attendance/TimekeepingPage';
import DataManagementPage from './pages/sync/DataManagementPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [gateReady, setGateReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentPath, setCurrentPath] = useState(() => {
    const p = window.location.pathname;
    return Object.values(ROUTES).includes(p) && p !== ROUTES.LOGIN ? p : ROUTES.LIVE;
  });

  const [toasts, setToasts] = useState([]);
  const [clockAudit, setClockAudit] = useState(null);
  const [clockModalOpen, setClockModalOpen] = useState(false);

  // Live Page State
  const [scanDate, setScanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [scanCategory, setScanCategory] = useState('ALL');
  const [scanDirection, setScanDirection] = useState('ALL');
  const [scanSearch, setScanSearch] = useState('');
  const [realtimeLogs, setRealtimeLogs] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [doorLoading, setDoorLoading] = useState({});

  // Enterprise Modules State
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empSearch, setEmpSearch] = useState('');
  const [empDeptFilter, setEmpDeptFilter] = useState('');

  const [activeVisitors, setActiveVisitors] = useState([]);
  const [visitorHistory, setVisitorHistory] = useState([]);
  const [customerCards, setCustomerCards] = useState([]);
  const [preGuests, setPreGuests] = useState([]);
  const [contractors, setContractors] = useState([]);

  const [timezones, setTimezones] = useState([]);
  const [accessGroups, setAccessGroups] = useState([]);
  const [deptAccessGroups, setDeptAccessGroups] = useState([]);
  const [deviceCommands, setDeviceCommands] = useState([]);

  const [dailyTimekeeping, setDailyTimekeeping] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [sqlOverview, setSqlOverview] = useState({ tables: [], total_rows: 0, connection: {} });
  const [selectedSqlTable, setSelectedSqlTable] = useState('tbl_Employees');
  const [sqlTableRows, setSqlTableRows] = useState([]);
  const [spStatus, setSpStatus] = useState({ authenticated: false, schemas: [] });
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSyncReport, setLastSyncReport] = useState(null);

  const notify = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const handleNavigate = useCallback((path) => {
    setCurrentPath(path);
    window.history.pushState({}, '', path);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname;
      if (Object.values(ROUTES).includes(p)) {
        setCurrentPath(p);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchClockAudit = useCallback(async () => {
    const { ok, data } = await apiFetch('/api/clock/audit');
    if (ok && data.audit) {
      setClockAudit(data.audit);
    }
  }, []);

  const fetchLiveStreams = useCallback(async () => {
    if (!user) return;
    const [logRes, anaRes, visRes] = await Promise.all([
      apiFetch(
        `/api/door/realtime_logs?date=${scanDate}&category=${scanCategory}&direction=${scanDirection}&search=${encodeURIComponent(
          scanSearch
        )}&limit=300`
      ),
      apiFetch(`/api/analytics/dashboard?date=${scanDate}`),
      apiFetch('/api/visitors/active'),
    ]);
    if (logRes.ok && logRes.data.logs) setRealtimeLogs(logRes.data.logs);
    if (anaRes.ok && anaRes.data.analytics) setAnalytics(anaRes.data.analytics);
    if (visRes.ok && visRes.data.visitors) setActiveVisitors(visRes.data.visitors);
  }, [user, scanDate, scanCategory, scanDirection, scanSearch]);

  const fetchAllEnterpriseData = useCallback(async () => {
    if (!user) return;
    const [
      deptRes,
      empRes,
      sqlRes,
      spRes,
      cardsRes,
      preRes,
      conRes,
      histRes,
      tzRes,
      grpRes,
      dgrpRes,
      cmdRes,
      dtkRes,
      shfRes,
    ] = await Promise.all([
      apiFetch('/api/sql/table/tbl_Departments?limit=100'),
      apiFetch(
        `/api/employees?q=${encodeURIComponent(empSearch)}&department=${encodeURIComponent(
          empDeptFilter
        )}&page=1&limit=80`
      ),
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
    if (dtkRes.ok && dtkRes.data.rows) setDailyTimekeeping(dtkRes.data.rows);
    if (shfRes.ok && shfRes.data.rows) setShifts(shfRes.data.rows);
  }, [user, empSearch, empDeptFilter]);

  useEffect(() => {
    (async () => {
      await fetchClockAudit();
      const { ok, data } = await apiFetch('/api/auth/me');
      if (ok && data.authenticated) {
        setUser(data.user);
      }
      setGateReady(true);
    })();
  }, [fetchClockAudit]);

  useEffect(() => {
    const t = setInterval(fetchClockAudit, 30000);
    return () => clearInterval(t);
  }, [fetchClockAudit]);

  useEffect(() => {
    if (!user) return;
    fetchLiveStreams();
    const t = setInterval(fetchLiveStreams, 4000);
    return () => clearInterval(t);
  }, [user, fetchLiveStreams]);

  useEffect(() => {
    if (!user) return;
    fetchAllEnterpriseData();
  }, [user, fetchAllEnterpriseData]);

  useEffect(() => {
    if (!user || !selectedSqlTable) return;
    (async () => {
      const { ok, data } = await apiFetch(`/api/sql/table/${selectedSqlTable}?limit=200`);
      if (ok && data.rows) {
        setSqlTableRows(data.rows);
      }
    })();
  }, [user, selectedSqlTable]);

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
        notify(`${action === 'UNLOCK' ? 'Đã mở' : 'Đã khóa'} ${channelName} (${seconds} giây)`, 'success');
        fetchLiveStreams();
      } else {
        notify(data.error || 'Không thể thực hiện thao tác cổng.', 'error');
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
      notify(
        action === 'UNLOCK_ALL'
          ? 'Đã mở khẩn cấp toàn bộ 4 làn cổng.'
          : 'Đã khóa toàn bộ 4 làn cổng.',
        'success'
      );
    } else {
      notify(data.error || 'Không thể thực hiện thao tác.', 'error');
    }
  };

  const handleRunSafeSyncTest = async () => {
    setSyncBusy(true);
    try {
      const { ok, data } = await apiFetch('/api/sync/safe_test', { method: 'POST' });
      if (ok && data.success) {
        setLastSyncReport(data);
        notify('Đã cập nhật dữ liệu từ thiết bị cổng an toàn.', 'success');
        fetchAllEnterpriseData();
      } else {
        notify(data.error || 'Không thể cập nhật dữ liệu.', 'error');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const handleProvisionCloudLists = async () => {
    setSyncBusy(true);
    try {
      const { ok, data } = await apiFetch('/api/sharepoint/provision_lists', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (ok && data.success) {
        notify('Đã đồng bộ cấu trúc 18 danh mục lưu trữ thành công.', 'success');
        fetchAllEnterpriseData();
      } else {
        notify(data.error || 'Không thể đồng bộ cấu trúc danh mục.', 'error');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const handleSyncSingleCategory = async (sqlTable) => {
    setSyncBusy(true);
    try {
      const { ok, data } = await apiFetch('/api/sharepoint/sync_table', {
        method: 'POST',
        body: JSON.stringify({ sql_table: sqlTable, max_rows: 200 }),
      });
      if (ok && data.success) {
        notify(
          `Đã đồng bộ ${data.rows_processed} bản ghi lên danh sách "${data.list_title}".`,
          'success'
        );
        fetchAllEnterpriseData();
      } else {
        notify(data.error || 'Không thể đồng bộ danh mục.', 'error');
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const pcClockInvalid = clockAudit && clockAudit.pc_clock_valid === false;

  return (
    <>
      {/* 1. Strict Loading Gate (#loadingGate) */}
      <div id="loadingGate" className={!gateReady ? 'active' : ''}>
        <div className="gate-box">
          <div className="gate-spinner"></div>
          <div className="gate-text">Đang kiểm tra tài khoản...</div>
        </div>
      </div>

      {/* 2. Toast Container (#toastContainer) */}
      <div id="toastContainer">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-msg ${t.type}`}>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      {/* 3. Login View or Main Workspace Shell */}
      {gateReady && !user && (
        <LoginPage
          clockAudit={clockAudit}
          onLoginSuccess={(loggedInUser) => {
            setUser(loggedInUser);
            notify(`Xin chào ${loggedInUser.full_name}`, 'success');
          }}
        />
      )}

      {gateReady && user && (
        <div
          id="appWorkspace"
          className={`ready ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
        >
          <SidebarShell
            currentPath={currentPath}
            onNavigate={handleNavigate}
            user={user}
            onLogout={handleLogout}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            activeVisitorsCount={activeVisitors.length}
          />

          <div className="main-area">
            {pcClockInvalid && (
              <div
                style={{
                  background: 'var(--red)',
                  color: '#ffffff',
                  padding: '8px 16px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  Cảnh báo: Đồng hồ trên máy tính này ({clockAudit.local_pc_time}) đang lệch{' '}
                  {clockAudit.pc_drift_sec} giây so với Giờ chuẩn Việt Nam ({clockAudit.vietnam_ntp_time}). Hệ thống đã khóa cập nhật giờ tự động để bảo vệ 4 thiết bị cổng. Vui lòng chỉnh lại giờ máy tính.
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setClockModalOpen(true)}
                >
                  Kiểm tra Giờ chuẩn
                </button>
              </div>
            )}

            {currentPath === ROUTES.LIVE && (
              <LiveCommandPage
                onCollapseSidebar={() => setSidebarCollapsed(true)}
                clockAudit={clockAudit}
                onOpenClockModal={() => setClockModalOpen(true)}
                analytics={analytics}
                activeVisitorsCount={activeVisitors.length}
                totalRecordsCount={sqlOverview.total_rows}
                realtimeLogs={realtimeLogs}
                scanDate={scanDate}
                setScanDate={setScanDate}
                scanDirection={scanDirection}
                setScanDirection={setScanDirection}
                scanCategory={scanCategory}
                setScanCategory={setScanCategory}
                scanSearch={scanSearch}
                setScanSearch={setScanSearch}
                onDoorControl={handleDoorControl}
                onDoorAll={handleDoorAll}
                doorLoading={doorLoading}
              />
            )}

            {currentPath === ROUTES.VISITORS && (
              <VisitorManagementPage
                onCollapseSidebar={() => setSidebarCollapsed(true)}
                departments={departments}
                activeVisitors={activeVisitors}
                visitorHistory={visitorHistory}
                customerCards={customerCards}
                preGuests={preGuests}
                contractors={contractors}
                onRefreshData={() => {
                  fetchLiveStreams();
                  fetchAllEnterpriseData();
                }}
                notify={notify}
              />
            )}

            {currentPath === ROUTES.HRM && (
              <HrmBiometricsPage
                onCollapseSidebar={() => setSidebarCollapsed(true)}
                departments={departments}
                employees={employees}
                empTotal={empTotal}
                empSearch={empSearch}
                setEmpSearch={setEmpSearch}
                empDeptFilter={empDeptFilter}
                setEmpDeptFilter={setEmpDeptFilter}
                onRefreshData={fetchAllEnterpriseData}
                notify={notify}
              />
            )}

            {currentPath === ROUTES.ACCESS_RULES && (
              <AccessRulesPage
                onCollapseSidebar={() => setSidebarCollapsed(true)}
                timezones={timezones}
                accessGroups={accessGroups}
                deptAccessGroups={deptAccessGroups}
                deviceCommands={deviceCommands}
                onRefreshData={fetchAllEnterpriseData}
                notify={notify}
              />
            )}

            {currentPath === ROUTES.TIMEKEEPING && (
              <TimekeepingPage
                onCollapseSidebar={() => setSidebarCollapsed(true)}
                dailyTimekeeping={dailyTimekeeping}
                shifts={shifts}
                onRefreshData={fetchAllEnterpriseData}
                notify={notify}
              />
            )}

            {currentPath === ROUTES.DATA_SYNC && (
              <DataManagementPage
                onCollapseSidebar={() => setSidebarCollapsed(true)}
                sqlOverview={sqlOverview}
                selectedSqlTable={selectedSqlTable}
                setSelectedSqlTable={setSelectedSqlTable}
                sqlTableRows={sqlTableRows}
                spStatus={spStatus}
                syncBusy={syncBusy}
                lastSyncReport={lastSyncReport}
                onRunSafeSyncTest={handleRunSafeSyncTest}
                onProvisionCloudLists={handleProvisionCloudLists}
                onSyncSingleCategory={handleSyncSingleCategory}
              />
            )}
          </div>

          <ClockSafetyModal
            open={clockModalOpen}
            onClose={() => setClockModalOpen(false)}
            clockAudit={clockAudit}
            onSynced={(newAudit) => setClockAudit(newAudit)}
            notify={notify}
          />
        </div>
      )}
    </>
  );
}
