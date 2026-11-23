import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, AlertTriangle, CheckCircle2, UserX, Users, Building2, Clock } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';

const TABS = [
  { id: 'all', label: 'Tất cả nhân sự' },
  { id: 'working', label: 'Đang làm việc' },
  { id: 'resigned', label: 'Đã ngưng làm việc' },
  { id: 'mismatch', label: 'Cảnh báo lệch dữ liệu' },
  { id: 'absent', label: 'Vắng / Nghỉ phép hôm nay' },
];

function KpiCard({ title, value, subtext, tone = 'slate', icon: Icon }) {
  const toneStyles = {
    slate: 'bg-white border-slate-200 text-slate-900',
    emerald: 'bg-white border-emerald-200 text-emerald-700',
    amber: 'bg-white border-amber-200 text-amber-700',
    rose: 'bg-white border-rose-200 text-rose-700',
    indigo: 'bg-white border-indigo-200 text-indigo-700',
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneStyles[tone] || toneStyles.slate}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</span>
      </div>
      {subtext ? <div className="mt-1 text-xs text-slate-500">{subtext}</div> : null}
    </div>
  );
}

export default function OnsiteStaffPage({ onToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState('all');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const loadReconcile = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setSyncing(true);
    else setLoading(true);
    try {
      const qs = new URLSearchParams({ date: selectedDate });
      if (forceRefresh) qs.set('refresh', '1');
      const res = await apiFetch(`/api/staff/onsite-reconcile?${qs.toString()}`);
      if (res?.success) {
        setData(res);
        if (forceRefresh) {
          onToast?.('Đã đồng bộ dữ liệu Master_NhanVien từ SharePoint', 'success');
        }
      } else {
        onToast?.(res?.error || 'Không thể tải dữ liệu đối chiếu nhân viên', 'error');
      }
    } catch (err) {
      onToast?.(err?.message || 'Lỗi kết nối máy chủ', 'error');
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [selectedDate, onToast]);

  useEffect(() => {
    loadReconcile(false);
  }, [loadReconcile]);

  const summary = data?.summary || {};
  const cacheInfo = data?.cache_info || {};
  const departments = data?.departments || [];
  const employees = data?.employees || [];
  const unregisteredVp = data?.unregistered_van_phong || [];

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      if (selectedDept !== 'ALL' && emp.department !== selectedDept) return false;
      if (activeTab === 'working' && emp.master_status !== 'WORKING') return false;
      if (activeTab === 'resigned' && emp.master_status !== 'RESIGNED') return false;
      if (activeTab === 'mismatch' && !emp.mismatch_flag) return false;
      if (activeTab === 'absent' && emp.attendance_status !== 'ABSENT_OR_LEAVE') return false;
      if (q) {
        const hay = `${emp.fullname} ${emp.code} ${emp.atid} ${emp.department} ${emp.master_target}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, selectedDept, activeTab, searchQuery]);

  const renderAttendanceBadge = (status) => {
    if (status === 'PRESENT') {
      return <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Đang có mặt</span>;
    }
    if (status === 'LEFT') {
      return <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">Đã chấm công & ra về</span>;
    }
    if (status === 'ABSENT_OR_LEAVE') {
      return <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">Vắng / Nghỉ phép</span>;
    }
    return <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">Ngưng làm việc</span>;
  };

  const renderMasterBadge = (emp) => {
    if (emp.master_status === 'WORKING') {
      return <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Đang làm ({emp.match_method === 'MA_NV' ? 'Mã NV' : 'Họ tên'})</span>;
    }
    return <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">{emp.master_working_status || 'Đã ngưng làm việc'}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Đối chiếu Master_NhanVien (SharePoint) & Dữ liệu Phòng ban / Chấm công
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">
            Nhân viên tại chỗ & Thống kê nhân sự
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Đồng bộ SharePoint định kỳ mỗi {Math.round((cacheInfo.ttl_seconds || 1800) / 60)} phút
            </span>
            {cacheInfo.synced_at ? (
              <span>Lần đồng bộ gần nhất: <strong className="text-slate-700">{cacheInfo.synced_at}</strong></span>
            ) : null}
            {cacheInfo.stale ? (
              <span className="text-amber-600 font-medium">Đang dùng dữ liệu cache dự phòng</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-900 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => loadReconcile(true)}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Đang đồng bộ...' : 'Đồng bộ SharePoint ngay'}
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          title="Nhân sự trên hệ thống"
          value={summary.total_local ?? 0}
          subtext={`Master SharePoint: ${summary.master_total ?? 0} NV (${summary.master_van_phong ?? 0} Văn phòng)`}
          icon={Users}
        />
        <KpiCard
          title="Đang làm việc"
          value={`${summary.working ?? 0} (${summary.working_pct ?? 0}%)`}
          subtext="Khớp danh sách Master_NhanVien"
          tone="emerald"
          icon={CheckCircle2}
        />
        <KpiCard
          title="Đã ngưng làm việc"
          value={`${summary.resigned ?? 0} (${summary.resigned_pct ?? 0}%)`}
          subtext={`Lệch Active trên ZKTeco: ${summary.mismatch_count ?? 0}`}
          tone="rose"
          icon={UserX}
        />
        <KpiCard
          title="Có mặt / Đi làm hôm nay"
          value={`${summary.attended_today ?? 0} (${summary.attended_pct ?? 0}%)`}
          subtext={`Đang ở trong công ty: ${summary.present_now ?? 0} (${summary.present_pct ?? 0}%)`}
          tone="indigo"
          icon={Building2}
        />
        <KpiCard
          title="Vắng / Nghỉ phép hôm nay"
          value={`${summary.absent_or_leave ?? 0} (${summary.absent_pct ?? 0}%)`}
          subtext="Tính trên nhân sự đang làm việc"
          tone="amber"
          icon={AlertTriangle}
        />
      </div>

      {/* Department Summary Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Tổng hợp tỷ lệ theo Phòng ban</h2>
            <p className="text-xs text-slate-500">Nhấp vào một phòng ban để lọc danh sách nhân viên chi tiết bên dưới</p>
          </div>
          {selectedDept !== 'ALL' ? (
            <button
              type="button"
              onClick={() => setSelectedDept('ALL')}
              className="text-xs font-semibold text-slate-700 underline hover:text-slate-900"
            >
              Xem tất cả phòng ban
            </button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Phòng ban</th>
                <th className="px-3 py-2.5 text-right">Tổng NV</th>
                <th className="px-3 py-2.5 text-right">Đang làm</th>
                <th className="px-3 py-2.5 text-right">Đi làm hôm nay</th>
                <th className="px-3 py-2.5 text-right">Đang có mặt</th>
                <th className="px-3 py-2.5 text-right">Vắng / Nghỉ phép</th>
                <th className="px-3 py-2.5 text-right">Đã ngưng việc</th>
                <th className="px-3 py-2.5 text-right">Tỷ lệ đi làm</th>
                <th className="px-3 py-2.5 text-right">Tỷ lệ nghỉ việc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((d) => {
                const isSelected = selectedDept === d.department;
                return (
                  <tr
                    key={d.department}
                    onClick={() => setSelectedDept(isSelected ? 'ALL' : d.department)}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-slate-900">
                      {d.department}
                      {d.mismatch_count > 0 ? (
                        <span className="ml-2 inline-flex items-center rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                          {d.mismatch_count} lệch
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{d.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-emerald-700">{d.working}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-indigo-700">{d.attended_today}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{d.present_now}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{d.absent_or_leave}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-rose-700">{d.resigned}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{d.attended_pct}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{d.resigned_pct}%</td>
                  </tr>
                );
              })}
              {departments.length === 0 && !loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-500">
                    Chưa có dữ liệu phòng ban
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Employee Reconciliation Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 focus:outline-none"
            >
              <option value="ALL">Tất cả phòng ban ({departments.length})</option>
              {departments.map((d) => (
                <option key={d.department} value={d.department}>
                  {d.department} ({d.total})
                </option>
              ))}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên, mã NV, ATID..."
                className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="max-h-[480px] overflow-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Mã NV / ATID</th>
                <th className="px-3 py-2.5 text-left">Họ và tên</th>
                <th className="px-3 py-2.5 text-left">Phòng ban</th>
                <th className="px-3 py-2.5 text-left">Đối chiếu Master SharePoint</th>
                <th className="px-3 py-2.5 text-left">Trạng thái hôm nay</th>
                <th className="px-3 py-2.5 text-left">Giờ vào / ra</th>
                <th className="px-3 py-2.5 text-left">Ghi chú đối soát</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    Đang tải dữ liệu đối chiếu nhân viên...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    Không có nhân viên phù hợp với bộ lọc hiện tại
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.atid || emp.code} className={emp.mismatch_flag ? 'bg-rose-50/40' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">{emp.code || '—'}</div>
                      <div className="text-[11px] text-slate-400">{emp.atid}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-slate-900">{emp.fullname}</div>
                      {emp.position ? <div className="text-xs text-slate-500">{emp.position}</div> : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-700">
                      <div>{emp.department}</div>
                      {emp.master_target ? <div className="text-[11px] text-slate-400">{emp.master_target}</div> : null}
                    </td>
                    <td className="px-3 py-2.5">{renderMasterBadge(emp)}</td>
                    <td className="px-3 py-2.5">{renderAttendanceBadge(emp.attendance_status)}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">
                      {emp.check_in_time ? <div>Vào: {emp.check_in_time.slice(11, 19) || emp.check_in_time}</div> : '—'}
                      {emp.check_out_time ? <div>Ra: {emp.check_out_time.slice(11, 19) || emp.check_out_time}</div> : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {emp.mismatch_flag ? (
                        <span className="font-medium text-rose-700">{emp.mismatch_reason}</span>
                      ) : emp.resign_reason ? (
                        <span className="text-slate-600">{emp.resign_reason}</span>
                      ) : (
                        <span className="text-slate-400">Khớp dữ liệu</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unregistered Van Phong staff on Master_NhanVien */}
      {unregisteredVp.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">
            Nhân sự Văn phòng trên Master_NhanVien chưa có trên máy chấm công ({unregisteredVp.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Các nhân sự thuộc khu vực VAN PHONG đang làm việc trên SharePoint nhưng chưa xuất hiện trong tbl_Employees
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unregisteredVp.map((it) => (
              <div key={it.sp_id || it.emp_code} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="font-semibold text-slate-900">{it.fullname} ({it.emp_code || '—'})</div>
                <div className="text-slate-500">{it.target || it.team || 'VAN PHONG'} · {it.position || 'Nhân viên'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
