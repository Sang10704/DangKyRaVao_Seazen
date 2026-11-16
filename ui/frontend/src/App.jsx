import React, { useState, useEffect, useCallback } from 'react';
import { ROUTES } from './constants/routes';
import { apiFetch } from './services/apiClient';
import SidebarShell from './components/shell/SidebarShell';
import ClockSafetyModal from './components/common/ClockSafetyModal';
import LoginPage from './pages/auth/LoginPage';
import LiveCommandPage from './pages/live/LiveCommandPage';
import VisitorManagementPage from './pages/visitors/VisitorManagementPage';
import HrmBiometricsPage from './pages/hrm/HrmBiometricsPage';
import TimekeepingPage from './pages/attendance/TimekeepingPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [gateReady, setGateReady] = useState(false);
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

  // Core Data State
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empSearch, setEmpSearch] = useState('');
  const [empDeptFilter, setEmpDeptFilter] = useState('');

  const [activeVisitors, setActiveVisitors] = useState([]);
  const [visitorHistory, setVisitorHistory] = useState([]);
  const [customerCards, setCustomerCards] = useState([]);

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

  const fetchCoreDirectory = useCallback(async () => {
    if (!user) return;
    const [deptRes, empRes, cardsRes, histRes] = await Promise.all([
      apiFetch('/api/sql/table/tbl_Departments?limit=100'),
      apiFetch(
        `/api/employees?q=${encodeURIComponent(empSearch)}&department=${encodeURIComponent(
          empDeptFilter
        )}&page=1&limit=120`
      ),
      apiFetch('/api/sql/table/tbl_CustomerCards?limit=200'),
      apiFetch('/api/sql/table/tbl_Visitors?limit=200'),
    ]);

    if (deptRes.ok && deptRes.data.rows) setDepartments(deptRes.data.rows);
    if (empRes.ok && empRes.data.employees) {
      setEmployees(empRes.data.employees);
      setEmpTotal(empRes.data.total || empRes.data.employees.length);
    }
    if (cardsRes.ok && cardsRes.data.rows) setCustomerCards(cardsRes.data.rows);
    if (histRes.ok && histRes.data.rows) setVisitorHistory(histRes.data.rows);
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
    const t = setInterval(fetchLiveStreams, 3000);
    return () => clearInterval(t);
  }, [user, fetchLiveStreams]);

  useEffect(() => {
    if (!user) return;
    fetchCoreDirectory();
  }, [user, fetchCoreDirectory]);

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

  const pcClockInvalid = clockAudit && clockAudit.pc_clock_valid === false;

  return (
    <>
      <div id="loadingGate" className={!gateReady ? 'active' : ''}>
        <div className="gate-box">
          <div className="gate-spinner"></div>
          <div style={{ fontWeight: 600 }}>Đang khởi tạo hệ thống...</div>
        </div>
      </div>

      <div id="toastContainer">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-msg ${t.type}`}>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

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
        <div id="appWorkspace">
          <SidebarShell
            currentPath={currentPath}
            onNavigate={handleNavigate}
            user={user}
            onLogout={handleLogout}
            activeVisitorsCount={activeVisitors.length}
          />

          <div className="main-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {pcClockInvalid && (
              <div
                style={{
                  background: 'var(--red)',
                  color: '#ffffff',
                  padding: '8px 20px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  Cảnh báo: Đồng hồ trên máy tính này ({clockAudit.local_pc_time}) đang lệch{' '}
                  {clockAudit.pc_drift_sec} giây so với Giờ chuẩn Việt Nam ({clockAudit.vietnam_ntp_time}). Hệ thống đã khóa cập nhật giờ tự động để bảo vệ 4 thiết bị cổng.
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
                user={user}
                clockAudit={clockAudit}
                onOpenClockModal={() => setClockModalOpen(true)}
                onNavigate={handleNavigate}
                analytics={analytics}
                activeVisitors={activeVisitors}
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
                departments={departments}
                employees={employees}
                activeVisitors={activeVisitors}
                visitorHistory={visitorHistory}
                customerCards={customerCards}
                onRefreshData={() => {
                  fetchLiveStreams();
                  fetchCoreDirectory();
                }}
                notify={notify}
              />
            )}

            {(currentPath === ROUTES.HRM || currentPath === ROUTES.BIOMETRICS) && (
              <HrmBiometricsPage
                mode={currentPath === ROUTES.BIOMETRICS ? 'biometrics' : 'hrm'}
                departments={departments}
                employees={employees}
                empTotal={empTotal}
                empSearch={empSearch}
                setEmpSearch={setEmpSearch}
                empDeptFilter={empDeptFilter}
                setEmpDeptFilter={setEmpDeptFilter}
                onRefreshData={fetchCoreDirectory}
                notify={notify}
              />
            )}

            {currentPath === ROUTES.TIMEKEEPING && (
              <TimekeepingPage departments={departments} />
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
