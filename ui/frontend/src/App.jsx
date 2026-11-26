import React, { useState, useEffect, useCallback } from 'react';
import { ROUTES } from './constants/routes';
import { apiFetch } from './services/apiClient';
import SidebarShell from './components/shell/SidebarShell';
import ClockSafetyModal from './components/common/ClockSafetyModal';
import LoginPage from './pages/auth/LoginPage';
import OverviewDashboardPage from './pages/overview/OverviewDashboardPage';
import LiveCommandPage from './pages/live/LiveCommandPage';
import AccessHistoryPage from './pages/history/AccessHistoryPage';
import VisitorManagementPage from './pages/visitors/VisitorManagementPage';
import AppointmentsPage from './pages/appointments/AppointmentsPage';
import CardManagementPage from './pages/cards/CardManagementPage';
import HrmDirectoryPage from './pages/hrm/HrmDirectoryPage';
import OnsiteStaffPage from './pages/onsite/OnsiteStaffPage';
import BiometricsPage from './pages/biometrics/BiometricsPage';
import TimekeepingPage from './pages/attendance/TimekeepingPage';
import AccessLinksPage from './pages/access/AccessLinksPage';
import { getLocalDateStr } from './utils/dateUtils';

export default function App() {
  const [user, setUser] = useState(null);
  const [gateReady, setGateReady] = useState(false);
  const [currentPath, setCurrentPath] = useState(() => {
    const p = window.location.pathname;
    if (p === '/live') return ROUTES.DOORS;
    return Object.values(ROUTES).includes(p) && p !== ROUTES.LOGIN ? p : ROUTES.OVERVIEW;
  });

  const [toasts, setToasts] = useState([]);
  const [clockAudit, setClockAudit] = useState(null);
  const [clockModalOpen, setClockModalOpen] = useState(false);

  // Live Page State
  const [scanDate, setScanDate] = useState(() => getLocalDateStr());
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
  const [pendingAppointments, setPendingAppointments] = useState([]);
  const [visitorHistory, setVisitorHistory] = useState([]);
  const [customerCards, setCustomerCards] = useState([]);
  const [pendingCardPhotoCount, setPendingCardPhotoCount] = useState(0);

  const notify = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const handleNavigate = useCallback(
    (path) => {
      const target =
        user && user.role === 'guest_inviter'
          ? ROUTES.APPOINTMENTS
          : user && user.role !== 'admin'
          ? ROUTES.VISITORS
          : path;
      setCurrentPath(target);
      window.history.pushState({}, '', target);
    },
    [user]
  );

  useEffect(() => {
    const onPopState = () => {
      const p = window.location.pathname;
      if (user && user.role === 'guest_inviter') {
        setCurrentPath(ROUTES.APPOINTMENTS);
      } else if (user && user.role !== 'admin') {
        setCurrentPath(ROUTES.VISITORS);
      } else if (Object.values(ROUTES).includes(p)) {
        setCurrentPath(p);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [user]);

  const fetchClockAudit = useCallback(async () => {
    const { ok, data } = await apiFetch('/api/clock/audit');
    if (ok && data.audit) {
      setClockAudit(data.audit);
    }
  }, []);

  const fetchActiveVisitorsFast = useCallback(async () => {
    if (!user) return;
    if (user.role === 'guest_inviter') {
      const aptRes = await apiFetch('/api/visitor/appointments');
      if (aptRes.ok && aptRes.data.appointments) setPendingAppointments(aptRes.data.appointments);
      return;
    }
    const [visRes, cardsLiteRes, aptRes] = await Promise.all([
      apiFetch('/api/visitors/active'),
      apiFetch('/api/visitor/cards?include_photos=0'),
      apiFetch('/api/visitor/appointments'),
    ]);
    if (visRes.ok && visRes.data.visitors) setActiveVisitors(visRes.data.visitors);
    if (cardsLiteRes.ok && typeof cardsLiteRes.data.pending_photo_count === 'number') {
      setPendingCardPhotoCount(cardsLiteRes.data.pending_photo_count);
    }
    if (aptRes.ok && aptRes.data.appointments) setPendingAppointments(aptRes.data.appointments);
  }, [user]);

  const fetchLiveStreams = useCallback(async () => {
    if (!user) return;
    // Always keep active visitors & card alert count fresh in <30ms
    const activePromise = fetchActiveVisitorsFast();
    // Only poll heavy dashboard logs/charts when actually viewing Live Command page
    if (currentPath === ROUTES.OVERVIEW || currentPath === ROUTES.DOORS) {
      const catParam = currentPath === ROUTES.OVERVIEW ? 'ALL' : scanCategory;
      const dirParam = currentPath === ROUTES.OVERVIEW ? 'ALL' : scanDirection;
      const searchParam = currentPath === ROUTES.OVERVIEW ? '' : scanSearch;
      const [logRes, anaRes] = await Promise.all([
        apiFetch(
          `/api/door/realtime_logs?date=${scanDate}&category=${catParam}&direction=${dirParam}&search=${encodeURIComponent(
            searchParam
          )}&limit=300`
        ),
        apiFetch(`/api/analytics/dashboard?date=${scanDate}`),
        activePromise,
      ]);
      if (logRes.ok && logRes.data.logs) setRealtimeLogs(logRes.data.logs);
      if (anaRes.ok && anaRes.data.analytics) setAnalytics(anaRes.data.analytics);
    } else {
      await activePromise;
    }
  }, [user, currentPath, fetchActiveVisitorsFast, scanDate, scanCategory, scanDirection, scanSearch]);

  const fetchCoreDirectory = useCallback(async () => {
    if (!user) return;
    const isInviter = user.role === 'guest_inviter';
    const [deptRes, empRes, cardsRes, histRes] = await Promise.all([
      apiFetch('/api/departments'),
      apiFetch(
        `/api/employees?q=${encodeURIComponent(empSearch)}&department=${encodeURIComponent(
          empDeptFilter
        )}&page=1&limit=2000`
      ),
      isInviter ? Promise.resolve({ ok: false, data: {} }) : apiFetch('/api/visitor/cards?include_photos=1'),
      isInviter ? Promise.resolve({ ok: false, data: {} }) : apiFetch('/api/visitors/history?limit=250'),
    ]);

    if (deptRes.ok && deptRes.data.departments) setDepartments(deptRes.data.departments);
    if (empRes.ok && empRes.data.employees) {
      setEmployees(empRes.data.employees);
      setEmpTotal(empRes.data.total || empRes.data.employees.length);
    }
    if (cardsRes.ok && cardsRes.data.rows) {
      setCustomerCards(cardsRes.data.rows);
      if (typeof cardsRes.data.pending_photo_count === 'number') {
        setPendingCardPhotoCount(cardsRes.data.pending_photo_count);
      }
    }
    if (histRes.ok && histRes.data.history) setVisitorHistory(histRes.data.history);
  }, [user, empSearch, empDeptFilter]);

  useEffect(() => {
    (async () => {
      await fetchClockAudit();
      const { ok, data } = await apiFetch('/api/auth/me');
      if (ok && data.authenticated) {
        setUser(data.user);
        if (data.user.role === 'guest_inviter') {
          setCurrentPath(ROUTES.APPOINTMENTS);
          window.history.replaceState({}, '', ROUTES.APPOINTMENTS);
        } else if (data.user.role !== 'admin') {
          setCurrentPath(ROUTES.VISITORS);
          window.history.replaceState({}, '', ROUTES.VISITORS);
        }
      }
      setGateReady(true);
    })();
  }, [fetchClockAudit]);

  useEffect(() => {
    const onUnauth = () => {
      setUser((prev) => {
        if (prev) notify('Phiên đăng nhập đã hết hạn hoặc máy chủ vừa khởi động lại. Vui lòng đăng nhập lại.', 'warning');
        return null;
      });
    };
    window.addEventListener('seazen:unauthorized', onUnauth);
    return () => window.removeEventListener('seazen:unauthorized', onUnauth);
  }, [notify]);

  useEffect(() => {
    const t = setInterval(fetchClockAudit, 30000);
    return () => clearInterval(t);
  }, [fetchClockAudit]);

  useEffect(() => {
    if (!user) return;
    const t0 = setTimeout(fetchLiveStreams, scanSearch ? 220 : 0);
    const t = setInterval(fetchLiveStreams, 3000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [user, fetchLiveStreams, scanSearch]);

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(fetchCoreDirectory, empSearch ? 220 : 0);
    return () => clearTimeout(t);
  }, [user, fetchCoreDirectory, empSearch]);

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
    const label = action === 'UNLOCK_ALL' ? 'MỞ KHẨN CẤP toàn bộ 4 làn cổng' : 'KHÓA toàn bộ 4 làn cổng';
    if (!window.confirm(`Xác nhận ${label}?`)) return;
    setDoorLoading((prev) => ({ ...prev, ALL_DOORS: true }));
    try {
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
        fetchLiveStreams();
      } else {
        notify(data.error || 'Không thể thực hiện thao tác.', 'error');
      }
    } finally {
      setDoorLoading((prev) => ({ ...prev, ALL_DOORS: false }));
    }
  };

  const pcClockInvalid = clockAudit && clockAudit.pc_clock_valid === false;
  const effectivePath =
    user && user.role === 'guest_inviter'
      ? ROUTES.APPOINTMENTS
      : user && user.role !== 'admin'
      ? ROUTES.VISITORS
      : currentPath;

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
            const isValidAdminDeepLink = Object.values(ROUTES).includes(currentPath) && currentPath !== ROUTES.LOGIN;
            const initRoute =
              loggedInUser.role === 'guest_inviter'
                ? ROUTES.APPOINTMENTS
                : loggedInUser.role !== 'admin'
                ? ROUTES.VISITORS
                : isValidAdminDeepLink
                ? currentPath
                : ROUTES.OVERVIEW;
            setCurrentPath(initRoute);
            window.history.replaceState({}, '', initRoute);
            notify(`Xin chào ${loggedInUser.full_name}`, 'success');
          }}
        />
      )}

      {gateReady && user && (
        <div id="appWorkspace">
          <SidebarShell
            currentPath={effectivePath}
            onNavigate={handleNavigate}
            user={user}
            onLogout={handleLogout}
            activeVisitorsCount={activeVisitors.length}
            pendingAppointmentsCount={pendingAppointments.length}
            pendingCardPhotoCount={pendingCardPhotoCount}
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
                {user.role === 'admin' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setClockModalOpen(true)}
                  >
                    Kiểm tra Giờ chuẩn
                  </button>
                )}
              </div>
            )}

            {effectivePath === ROUTES.OVERVIEW && (
              <OverviewDashboardPage
                user={user}
                analytics={analytics}
                activeVisitors={activeVisitors}
                customerCards={customerCards}
                pendingCardPhotoCount={pendingCardPhotoCount}
                realtimeLogs={realtimeLogs}
                scanDate={scanDate}
                setScanDate={setScanDate}
                onNavigate={handleNavigate}
                clockAudit={clockAudit}
              />
            )}

            {effectivePath === ROUTES.DOORS && (
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

            {effectivePath === ROUTES.HISTORY && (
              <AccessHistoryPage notify={notify} />
            )}

            {effectivePath === ROUTES.VISITORS && (
              <VisitorManagementPage
                departments={departments}
                employees={employees}
                activeVisitors={activeVisitors}
                visitorHistory={visitorHistory}
                customerCards={customerCards}
                pendingAppointments={pendingAppointments}
                onRefreshData={() => {
                  fetchActiveVisitorsFast();
                  fetchCoreDirectory();
                }}
                notify={notify}
              />
            )}

            {effectivePath === ROUTES.APPOINTMENTS && (
              <AppointmentsPage
                user={user}
                departments={departments}
                employees={employees}
                appointments={pendingAppointments}
                onRefreshData={() => {
                  fetchActiveVisitorsFast();
                  fetchCoreDirectory();
                }}
                notify={notify}
              />
            )}

            {effectivePath === ROUTES.CARDS && (
              <CardManagementPage
                customerCards={customerCards}
                activeVisitors={activeVisitors}
                user={user}
                onRefreshData={() => {
                  fetchLiveStreams();
                  fetchCoreDirectory();
                }}
                notify={notify}
              />
            )}

            {effectivePath === ROUTES.HRM && (
              <HrmDirectoryPage
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

            {effectivePath === ROUTES.ONSITE && (
              <OnsiteStaffPage onToast={notify} />
            )}

            {effectivePath === ROUTES.BIOMETRICS && (
              <BiometricsPage
                departments={departments}
                empSearch={empSearch}
                setEmpSearch={setEmpSearch}
                empDeptFilter={empDeptFilter}
                setEmpDeptFilter={setEmpDeptFilter}
                onRefreshData={fetchCoreDirectory}
                notify={notify}
              />
            )}

            {effectivePath === ROUTES.TIMEKEEPING && (
              <TimekeepingPage departments={departments} notify={notify} />
            )}

            {effectivePath === ROUTES.ACCESS_LINKS && (
              <AccessLinksPage user={user} notify={notify} />
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
