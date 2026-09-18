/**
 * SeaZen Smart Access Control - Frontend Controller
 * - 100% Real-time & Historical Data from ePAD System
 * - Fast CCCD Chip QR Code Auto-fill Registration (0.05s)
 * - Office Access Monitoring & Real-time Auto-Classification:
 *     VerifyMode: FaceTemplate -> Nhân viên văn phòng
 *     VerifyMode: Card -> Khách đến
 * - Chart.js Hourly Traffic & Distribution Dashboard by Date
 * - Dynamic Department Hierarchy & Employee Filter
 */

// 🛡️ CHẶN TRIỆT ĐỂ PHÍM TẮT IN (Ctrl+P) TỪ SÚNG QUÉT HOẶC BÀN PHÍM
window.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.keyCode === 80)) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Security] Đã chặn lệnh in Ctrl+P từ bàn phím / súng quét.');
    return false;
  }
}, true);

// Global State
const state = {
  activeVisitors: [],
  visitorHistory: [],
  realtimeLogs: [],
  auditLogs: [],
  analytics: null,
  currentCategoryFilter: 'ALL',
  currentDirectionFilter: 'ALL',
  presentDetailsList: [],
  currentPresentType: 'staff',
  hourlyChart: null,
  donutChart: null
};

let allCompanyEmployees = [];
let companyDepartments = [];
let currentAnalyticsDate = '';

// Web Audio Sound Synthesizer (Chime & Alerts)
class SoundFx {
  constructor() {
    this.ctx = null;
  }

  _init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playSuccessChime() {
    try {
      this._init();
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);        // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
      osc.frequency.setValueAtTime(1046.50, now + 0.24);// C6

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch (e) {}
  }

  playAlertTone() {
    try {
      this._init();
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.setValueAtTime(200, now + 0.15);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {}
  }
}

const sfx = new SoundFx();

// Toast Notification Manager
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  toast.innerHTML = `<span><strong>${iconMap[type] || 'ℹ'}</strong></span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Real-time Clock Updater
function startClock() {
  const clockEl = document.getElementById('realtimeClock');
  function update() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
    const dateStr = now.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    if (clockEl) clockEl.innerText = `${dateStr}  |  ${timeStr}`;

    // Also auto-refresh form checkin & checkout date & time if form is untouched
    const dateInp = document.getElementById('inputCheckinDate');
    const timeInp = document.getElementById('inputCheckinTime');
    const outDateInp = document.getElementById('inputCheckoutDate');
    const outTimeInp = document.getElementById('inputCheckoutTime');

    if (dateInp && !dateInp.value) {
      dateInp.value = now.toISOString().split('T')[0];
    }
    if (timeInp && !timeInp.value) {
      timeInp.value = timeStr.substring(0, 5);
    }
    if (outDateInp && !outDateInp.value) {
      outDateInp.value = now.toISOString().split('T')[0];
    }
    if (outTimeInp && !outTimeInp.value) {
      outTimeInp.value = '16:45';
    }
  }
  update();
  setInterval(update, 1000);
}

// ---------------- CCCD QR Parser & Fast Auto-fill ----------------

/**
 * Smart CCCD QR Parser:
 * Supports standard full 7-field QR:
 *   SốCCCD|SốCMNDCũ|HọVàTên|NgàySinh(DDMMYYYY)|GiớiTính|ĐịaChỉ|NgàyCấp(DDMMYYYY)
 * And truncated / custom QR formats:
 *   049204013662||Nguyễn Huỳnh Văn Sang|10072004
 *   049204013662|Nguyễn Huỳnh Văn Sang|10072004
 */
function parseCccdQr(rawString) {
  if (!rawString || typeof rawString !== 'string') return null;
  const clean = rawString.trim();
  if (!clean.includes('|')) return null;

  const parts = clean.split('|').map(p => p.trim());
  if (parts.length < 3) return null;

  let cccd = parts[0] || '';
  let cmndOld = '';
  let fullName = '';
  let rawDob = '';
  let gender = '';
  let address = '';
  let issueDate = '';

  // Format 1: 049204013662||Nguyễn Huỳnh Văn Sang|10072004...
  if (parts.length >= 4 && parts[1] === '' && isNaN(parts[2])) {
    cmndOld = '';
    fullName = parts[2] || '';
    rawDob = parts[3] || '';
    if (parts.length > 4) gender = parts[4] || '';
    if (parts.length > 5) address = parts[5] || '';
    if (parts.length > 6) issueDate = parts[6] || '';
  }
  // Format 2: 079199001234|025123456|Nguyễn Văn An|15081995...
  else if (parts.length >= 4 && /^\d{9}$/.test(parts[1])) {
    cmndOld = parts[1];
    fullName = parts[2] || '';
    rawDob = parts[3] || '';
    if (parts.length > 4) gender = parts[4] || '';
    if (parts.length > 5) address = parts[5] || '';
    if (parts.length > 6) issueDate = parts[6] || '';
  }
  // Format 3: 049204013662|Nguyễn Huỳnh Văn Sang|10072004...
  else if (parts.length >= 3 && isNaN(parts[1])) {
    fullName = parts[1] || '';
    rawDob = parts[2] || '';
    if (parts.length > 3) gender = parts[3] || '';
    if (parts.length > 4) address = parts[4] || '';
    if (parts.length > 5) issueDate = parts[5] || '';
  }
  // Format 4: Fallback heuristic scan
  else {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (i === 0 && /^\d{9,12}$/.test(p)) {
        cccd = p;
      } else if (!fullName && /[a-zA-ZÀ-ỹ\s]{3,}/.test(p) && !['Nam', 'Nữ'].includes(p)) {
        fullName = p;
      } else if (!rawDob && /^\d{8}$/.test(p)) {
        rawDob = p;
      } else if (!gender && ['Nam', 'Nữ', 'nam', 'nữ'].includes(p)) {
        gender = p;
      } else if (!address && p.length > 10) {
        address = p;
      }
    }
  }

  // Format DOB DDMMYYYY -> DD/MM/YYYY and extract Birth Year
  let dobFormatted = rawDob;
  let birthYear = '';
  if (rawDob.length === 8 && /^\d+$/.test(rawDob)) {
    dobFormatted = `${rawDob.substring(0, 2)}/${rawDob.substring(2, 4)}/${rawDob.substring(4, 8)}`;
    birthYear = rawDob.substring(4, 8);
  } else if (rawDob.length === 4 && /^\d{4}$/.test(rawDob)) {
    birthYear = rawDob;
    dobFormatted = rawDob;
  }

  // Normalize gender
  let normalizedGender = 'Nam';
  if (gender) {
    const gLower = gender.toLowerCase();
    if (gLower.includes('nữ') || gLower.includes('nu') || gLower === 'female' || gLower === 'f') {
      normalizedGender = 'Nữ';
    } else {
      normalizedGender = 'Nam';
    }
  }

  return {
    cccd,
    cmndOld,
    fullName,
    birthDate: dobFormatted,
    birthYear,
    gender: normalizedGender,
    address,
    issueDate
  };
}

function applyCccdDataToForm(cccdData, showNotification = true) {
  if (!cccdData) return;

  const cccdInp = document.getElementById('inputCccdNumber');
  const nameInp = document.getElementById('inputFullName');
  const dobInp = document.getElementById('inputBirthDate');
  const yearInp = document.getElementById('inputBirthYear');
  const dateInp = document.getElementById('inputCheckinDate');
  const timeInp = document.getElementById('inputCheckinTime');
  const statusTag = document.getElementById('scannerStatus');

  if (cccdInp) cccdInp.value = cccdData.cccd || '';
  if (nameInp) nameInp.value = cccdData.fullName || '';
  if (dobInp) dobInp.value = cccdData.birthDate || '';
  if (yearInp) yearInp.value = cccdData.birthYear || '';

  // Auto fill checkin time
  const now = new Date();
  if (dateInp) dateInp.value = now.toISOString().split('T')[0];
  if (timeInp) timeInp.value = now.toLocaleTimeString('vi-VN', { hour12: false }).substring(0, 5);

  // Update status visual
  if (statusTag) {
    statusTag.innerText = '✓ Đã nhận diện CCCD';
    statusTag.style.background = '#bbf7d0';
    statusTag.style.color = '#15803d';
  }

  if (showNotification) {
    sfx.playSuccessChime();
    showToast(`✓ Đã điền thông tin: ${cccdData.fullName} (CCCD: ${cccdData.cccd})`, 'success');
  }
}

function handleCccdQrInput(event) {
  const qrInput = document.getElementById('inputCccdQr');
  if (!qrInput) return;

  const raw = qrInput.value.trim();
  if (raw.includes('|')) {
    const parsed = parseCccdQr(raw);
    if (parsed) {
      applyCccdDataToForm(parsed);
      qrInput.value = ''; // Reset QR box ready for next scan
    }
  }
}

// ---------------- API Calls & Data Fetching ----------------

async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const dot = document.getElementById('epadDot');
    const label = document.getElementById('epadStatusLabel');

    if (data.epad && data.epad.connected) {
      if (dot) dot.className = 'pulse-dot';
      if (label) label.innerText = 'Kết nối ePAD: Hoạt động';
    } else {
      if (dot) dot.className = 'pulse-dot error';
      if (label) label.innerText = 'Mất kết nối ePAD';
    }

    const badge = document.getElementById('activeCountBadge');
    if (badge) badge.innerText = data.active_visitors_count || 0;
  } catch (err) {
    const dot = document.getElementById('epadDot');
    const label = document.getElementById('epadStatusLabel');
    if (dot) dot.className = 'pulse-dot error';
    if (label) label.innerText = 'Máy chủ ngoại tuyến';
  }
}

// ---------------- Department & Personnel Integration (100% ePAD) ----------------

async function loadDepartmentsAndEmployees() {
  try {
    const [deptRes, empRes] = await Promise.all([
      fetch('/api/departments'),
      fetch('/api/employees')
    ]);
    const deptData = await deptRes.json();
    const empData = await empRes.json();

    if (deptData.success && deptData.departments) {
      companyDepartments = deptData.departments;
      populateDepartmentSelect(companyDepartments);
    }
    if (empData.success && empData.employees) {
      allCompanyEmployees = empData.employees;
      updateHostSuggestions();
    }
  } catch (err) {
    console.warn("Lỗi tải danh mục ePAD:", err);
  }
}

function populateDepartmentSelect(depts) {
  const deptSelect = document.getElementById('inputDepartment');
  if (!deptSelect) return;
  const currentVal = deptSelect.value;
  deptSelect.innerHTML = '<option value="">-- Chọn Phòng Ban (Dữ liệu ePAD) --</option>';
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.innerText = d.name.startsWith('Phòng') ? d.name : `Phòng ${d.name}`;
    deptSelect.appendChild(opt);
  });
  if (currentVal) deptSelect.value = currentVal;
}

function updateHostSuggestions(selectedDept = '') {
  const datalist = document.getElementById('hostSuggestions');
  const hostInput = document.getElementById('inputHostPerson');
  if (!datalist) return;

  datalist.innerHTML = '';
  let filtered = [];

  if (selectedDept) {
    const cleanDept = selectedDept.trim().toLowerCase().replace('phòng', '').trim();
    filtered = allCompanyEmployees.filter(e => {
      const empDept = (e.department || '').trim().toLowerCase();
      // BẮT BUỘC: Nhân sự phải có phòng ban thật sự gán trong ePAD, tuyệt đối không lấy nhân sự rỗng phòng ban
      if (!empDept) return false;
      const empDeptClean = empDept.replace('phòng', '').trim();
      return empDeptClean === cleanDept || empDeptClean.includes(cleanDept) || cleanDept.includes(empDeptClean);
    });

    // Sắp xếp thứ tự ABC theo họ tên nhân viên
    filtered.sort((a, b) => (a.fullname || '').localeCompare(b.fullname || '', 'vi'));

    if (hostInput) {
      hostInput.placeholder = filtered.length > 0 
        ? `Chọn hoặc gõ nhân viên phòng ${selectedDept} (${filtered.length} người)...` 
        : `Phòng ${selectedDept} chưa có danh sách nhân sự`;
    }
  } else {
    // Nếu chưa chọn phòng ban: chỉ gợi ý các nhân sự có phòng ban rõ ràng
    filtered = allCompanyEmployees.filter(e => (e.department || '').trim() !== '');
    filtered.sort((a, b) => (a.fullname || '').localeCompare(b.fullname || '', 'vi'));
    if (hostInput) {
      hostInput.placeholder = 'Chọn hoặc gõ tên nhân viên...';
    }
  }

  filtered.forEach(e => {
    const opt = document.createElement('option');
    const codePart = e.code || e.atid ? ` (${e.code || e.atid})` : '';
    opt.value = `${e.fullname}${codePart}`;
    datalist.appendChild(opt);
  });
}

// ---------------- Dashboard & Analytics by Date ----------------

async function fetchDashboardAnalytics(targetDate = '') {
  try {
    const query = targetDate ? `?date=${encodeURIComponent(targetDate)}` : (currentAnalyticsDate ? `?date=${encodeURIComponent(currentAnalyticsDate)}` : '');
    const res = await fetch(`/api/analytics/dashboard${query}`);
    const data = await res.json();
    if (data.success && data.analytics) {
      state.analytics = data.analytics;
      currentAnalyticsDate = data.analytics.date;
      updateKpis(data.analytics.kpi);
      updateCharts(data.analytics);
      renderTopDepartments(data.analytics.top_departments || []);
      updateAvailableDates(data.analytics.available_dates, currentAnalyticsDate, data.analytics.is_today);
    }
  } catch (e) {
    console.warn("Analytics fetch error:", e);
  }
}

function updateAvailableDates(dates, activeDate, isToday) {
  const select = document.getElementById('selectAnalyticsDate');
  const badge = document.getElementById('selectedDateBadge');
  const customInput = document.getElementById('inputCustomDate');

  if (select && dates && dates.length > 0) {
    const currentOptions = Array.from(select.options).map(o => o.value);
    const isSame = dates.length === currentOptions.length && dates.every((d, i) => d === currentOptions[i]);
    if (!isSame) {
      select.innerHTML = '';
      dates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        const parts = d.split('-');
        const vnDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
        opt.innerText = (d === dates[0]) ? `Hôm nay (${vnDate})` : `Ngày ${vnDate}`;
        select.appendChild(opt);
      });
    }
    if (activeDate) select.value = activeDate;
  }

  if (customInput && activeDate) {
    customInput.value = activeDate;
  }

  if (badge && activeDate) {
    const parts = activeDate.split('-');
    const vnDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : activeDate;
    badge.innerText = isToday ? `Hôm nay: ${vnDate}` : `Lịch sử: ${vnDate}`;
    badge.style.background = isToday ? '#eff6ff' : '#fef3c7';
    badge.style.color = isToday ? '#1d4ed8' : '#92400e';
    badge.style.borderColor = isToday ? '#bfdbfe' : '#fde68a';
  }
}

async function fetchActiveVisitors() {
  try {
    const res = await fetch('/api/visitors/active');
    const data = await res.json();
    state.activeVisitors = data.visitors || [];
    renderActiveVisitors();
    const count = state.activeVisitors.length;
    const badge = document.getElementById('activeCountBadge');
    if (badge) badge.innerText = count;
    const navBadge = document.getElementById('navActiveBadge');
    if (navBadge) navBadge.innerText = count;
  } catch (e) {}
}

async function fetchRealtimeLogs() {
  try {
    const targetDate = currentAnalyticsDate || '';
    const dateParam = targetDate ? `&date=${encodeURIComponent(targetDate)}` : '';
    const res = await fetch(`/api/door/realtime_logs?limit=2000${dateParam}`);
    const data = await res.json();
    state.realtimeLogs = data.logs || [];
    renderRealtimeLogs();
    renderDashboardQuickLogs();
  } catch (e) {}
}

async function fetchVisitorHistory() {
  try {
    const res = await fetch('/api/visitors/history?limit=100');
    const data = await res.json();
    state.visitorHistory = data.history || [];
    renderVisitorHistory();
  } catch (e) {}
}

// ---------------- Chart.js Visualizations ----------------

function initCharts() {
  // 1. Hourly Traffic Chart
  const hourlyCtx = document.getElementById('hourlyTrafficChart');
  if (hourlyCtx && !state.hourlyChart && typeof Chart !== 'undefined') {
    const defaultLabels = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    state.hourlyChart = new Chart(hourlyCtx, {
      type: 'bar',
      data: {
        labels: defaultLabels,
        datasets: [
          {
            label: 'Nhân Viên Văn Phòng (Quét Mặt)',
            data: new Array(defaultLabels.length).fill(0),
            backgroundColor: '#10b981',
            borderRadius: 6,
            barPercentage: 0.7
          },
          {
            label: 'Khách Đến (Thẻ / Đăng ký)',
            data: new Array(defaultLabels.length).fill(0),
            backgroundColor: '#f59e0b',
            borderRadius: 6,
            barPercentage: 0.7
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0b2341',
            titleFont: { size: 12, weight: 'bold' },
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: '#f1f5f9' }
          }
        }
      }
    });
  }

  // 2. Donut Distribution Chart
  const donutCtx = document.getElementById('distributionDonutChart');
  if (donutCtx && !state.donutChart && typeof Chart !== 'undefined') {
    state.donutChart = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Nhân Viên Văn Phòng', 'Khách Đến'],
        datasets: [{
          data: [1, 0],
          backgroundColor: ['#10b981', '#f59e0b'],
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 } }
          }
        }
      }
    });
  }
}

function updateKpis(kpi) {
  if (!kpi) return;
  const staffPresentEl = document.getElementById('kpiStaffPresent');
  const staffScansEl = document.getElementById('kpiStaffScans');
  const visitorsTodayEl = document.getElementById('kpiVisitorsToday');
  const activeVisitorsEl = document.getElementById('kpiActiveVisitors');
  const checkedOutEl = document.getElementById('kpiCheckedOutToday');
  const totalInEl = document.getElementById('kpiTotalIn');
  const totalInHintEl = document.getElementById('kpiTotalInHint');
  const totalOutEl = document.getElementById('kpiTotalOut');
  const totalOutHintEl = document.getElementById('kpiTotalOutHint');

  const staffCount = (kpi.staff_present !== undefined) ? kpi.staff_present : (kpi.staff_count || 0);
  const visitorsToday = (kpi.visitors_today !== undefined) ? kpi.visitors_today : (kpi.visitor_count || 0);
  const activeVisitors = (kpi.active_visitors_now !== undefined) ? kpi.active_visitors_now : (kpi.visitor_count || 0);
  const checkedOut = (kpi.checked_out_today !== undefined) ? kpi.checked_out_today : 0;

  if (staffPresentEl) staffPresentEl.innerText = staffCount;
  if (staffScansEl) staffScansEl.innerText = kpi.staff_scans_total || 0;
  if (visitorsTodayEl) visitorsTodayEl.innerText = visitorsToday;
  if (activeVisitorsEl) activeVisitorsEl.innerText = activeVisitors;
  if (checkedOutEl) checkedOutEl.innerText = checkedOut;

  if (totalInEl) totalInEl.innerText = kpi.total_in || 0;
  if (totalInHintEl) totalInHintEl.innerText = `NV Vào: ${kpi.staff_in_scans || 0} | Khách Vào: ${kpi.visitor_in_scans || 0}`;

  if (totalOutEl) totalOutEl.innerText = kpi.total_out || 0;
  if (totalOutHintEl) totalOutHintEl.innerText = `NV Ra: ${kpi.staff_out_scans || 0} | Khách Ra: ${kpi.visitor_out_scans || 0}`;
}

function updateCharts(analytics) {
  if (!analytics) return;

  // Update Hourly Traffic
  if (state.hourlyChart && analytics.hourly) {
    state.hourlyChart.data.labels = analytics.hourly.labels;
    state.hourlyChart.data.datasets[0].data = analytics.hourly.staff;
    state.hourlyChart.data.datasets[1].data = analytics.hourly.visitors;
    state.hourlyChart.update();
  }

  // Update Donut
  if (state.donutChart && analytics.distribution) {
    const sCount = analytics.distribution.staff_total || 0;
    const vCount = analytics.distribution.visitor_total || 0;
    state.donutChart.data.datasets[0].data = [sCount || (vCount === 0 ? 1 : 0), vCount];
    state.donutChart.update();
  }
}

function renderTopDepartments(depts) {
  const container = document.getElementById('topDepartmentsList');
  if (!container) return;

  if (depts.length === 0) {
    container.innerHTML = '<span class="dept-tag">Chưa có lượt khách nào hôm nay</span>';
    return;
  }

  container.innerHTML = depts.map(d => `
    <span class="dept-tag">${escapeHtml(d.name)} <strong>(${d.count})</strong></span>
  `).join('');
}

// ---------------- Visitor Registration & Check-out Handlers ----------------

async function handleRegisterVisitor(e) {
  e.preventDefault();

  const cccdInp = document.getElementById('inputCccdNumber');
  const cmndInp = document.getElementById('inputCmndOld');
  const nameInp = document.getElementById('inputFullName');
  const dobInp = document.getElementById('inputBirthDate');
  const yearInp = document.getElementById('inputBirthYear');
  const genderInp = document.getElementById('inputGender');
  const addrInp = document.getElementById('inputAddress');
  const phoneInp = document.getElementById('inputPhone');
  const companyInp = document.getElementById('inputCompany');
  const hostInp = document.getElementById('inputHostPerson');
  const deptInp = document.getElementById('inputDepartment');
  const purposeInp = document.getElementById('inputPurpose');
  const vehicleInp = document.getElementById('inputVehicle');
  const cardInp = document.getElementById('inputCardNumber');
  const autoUnlockCheck = document.getElementById('checkAutoUnlock');

  const fullName = (nameInp?.value || '').trim();
  const cccdNum = (cccdInp?.value || '').trim();

  if (!fullName) {
    showToast('Vui lòng nhập họ và tên khách!', 'error');
    nameInp?.focus();
    return;
  }

  const checkinDate = document.getElementById('inputCheckinDate')?.value || '';
  const checkinTime = document.getElementById('inputCheckinTime')?.value || '';
  const checkoutDate = document.getElementById('inputCheckoutDate')?.value || '';
  const checkoutTime = document.getElementById('inputCheckoutTime')?.value || '';

  // Extract department index if matched
  const selectedDeptName = (deptInp?.value || '').trim();
  let deptIndex = 0;
  if (selectedDeptName && companyDepartments) {
    const dMatch = companyDepartments.find(d => d.name === selectedDeptName);
    if (dMatch && dMatch.id) deptIndex = dMatch.id;
  }

  // Extract host ATID if matched
  const selectedHostStr = (hostInp?.value || '').trim();
  let hostAtid = '';
  if (selectedHostStr && allCompanyEmployees) {
    const eMatch = allCompanyEmployees.find(e => {
      const codePart = e.code || e.atid ? ` (${e.code || e.atid})` : '';
      return `${e.fullname}${codePart}`.toLowerCase() === selectedHostStr.toLowerCase() ||
             e.fullname.toLowerCase() === selectedHostStr.toLowerCase();
    });
    if (eMatch) hostAtid = eMatch.atid || eMatch.code || '';
  }

  const payload = {
    full_name: fullName,
    cccd_number: cccdNum,
    birth_date: (dobInp?.value || '').trim(),
    birth_year: (yearInp?.value || '').trim(),
    gender: (genderInp?.value || 'Nam').trim(),
    address: (addrInp?.value || '').trim(),
    phone: (phoneInp?.value || '').trim(),
    company: (companyInp?.value || '').trim(),
    host_person: selectedHostStr,
    host_atid: hostAtid,
    department: selectedDeptName,
    department_index: deptIndex,
    purpose: (purposeInp?.value || '').trim(),
    vehicle_number: (vehicleInp?.value || '').trim(),
    card_number: (cardInp?.value || '').trim(),
    checkin_date: checkinDate,
    checkin_time: checkinTime,
    expected_checkout_date: checkoutDate,
    expected_checkout_time: checkoutTime,
    auto_unlock: autoUnlockCheck?.checked || false
  };

  const submitBtn = document.getElementById('btnSubmitVisitor');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/visitor/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success) {
      sfx.playSuccessChime();
      showToast(`Đã đăng ký thành công cho khách: ${fullName}!`, 'success');

      // Console log prominently in DevTools confirming database save
      console.log("%c✓ [DATABASE UPDATE] ĐÃ CẬP NHẬT VÀO DATABASE & ĐỒNG BỘ CỬA THÀNH CÔNG!", "color: #10b981; font-weight: bold; font-size: 14px;");
      console.table({
        "Mã ID CSDL": result.visitor?.id,
        "Họ và Tên": result.visitor?.full_name,
        "Số CCCD": result.visitor?.cccd_number,
        "Mã Thẻ RFID": result.visitor?.card_number || '(Không có)',
        "Giờ Vào": result.visitor?.checkin_time,
        "Dự Kiến Ra": result.visitor?.expected_checkout_time,
        "Phòng Ban": result.visitor?.department,
        "Người Tiếp Đón": result.visitor?.host_person,
        "Hệ Thống Cửa ePAD": result.epad_sync || 'Đã đồng bộ',
        "Trạng Thái Database": "ĐÃ LƯU VÀO active_visitors.json"
      });

      // Keep last registered visitor in memory for 1-click printing
      state.lastVisitor = result.visitor || payload;

      // Reset form
      document.getElementById('visitorForm')?.reset();
      const statusTag = document.getElementById('scannerStatus');
      if (statusTag) {
        statusTag.innerText = 'Sẵn sàng quét';
        statusTag.style.background = '#dcfce7';
        statusTag.style.color = '#166534';
      }

      // Re-fill date & time for next visitor (Checkin: now, Checkout: 16h45)
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const nowTimeStr = now.toLocaleTimeString('vi-VN', { hour12: false }).substring(0, 5);

      const dInp = document.getElementById('inputCheckinDate');
      const tInp = document.getElementById('inputCheckinTime');
      const oDInp = document.getElementById('inputCheckoutDate');
      const oTInp = document.getElementById('inputCheckoutTime');

      if (dInp) dInp.value = todayStr;
      if (tInp) tInp.value = nowTimeStr;
      if (oDInp) oDInp.value = todayStr;
      if (oTInp) oTInp.value = '16:45';

      const deptSelect = document.getElementById('inputDepartment');
      if (deptSelect) {
        updateHostSuggestions(deptSelect.value);
      }

      // Refresh data
      fetchActiveVisitors();
      fetchDashboardAnalytics();
      fetchSystemStatus();

      // Auto close modal popup after brief feedback
      setTimeout(() => {
        closeRegisterModal();
      }, 500);
    } else {
      sfx.playAlertTone();
      console.error("❌ [DATABASE ERROR] Lưu khách thất bại:", result.error);
      showToast(`Lỗi: ${result.error || 'Đăng ký không thành công'}`, 'error');
    }
  } catch (err) {
    console.error("❌ [NETWORK ERROR] Lỗi khi gửi dữ liệu đăng ký:", err);
    showToast('Lỗi mạng khi đăng ký khách', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleFastCheckout(queryKey) {
  const query = (queryKey || '').trim();
  if (!query) {
    showToast('Vui lòng quét hoặc nhập mã thẻ / CCCD để check-out!', 'error');
    return;
  }

  try {
    const res = await fetch('/api/visitor/fast_checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query })
    });
    const result = await res.json();

    if (result.success) {
      sfx.playSuccessChime();
      showToast(result.message || `Check-out thành công cho khách!`, 'success');

      // Console log prominently in DevTools confirming database checkout
      console.log("%c✓ [DATABASE CHECKOUT] ĐÃ CHECK-OUT VÀ CẬP NHẬT DATABASE THÀNH CÔNG!", "color: #3b82f6; font-weight: bold; font-size: 14px;");
      console.table({
        "Họ và Tên": result.visitor?.full_name,
        "Số CCCD": result.visitor?.cccd_number,
        "Mã Thẻ RFID": result.visitor?.card_number || '(Không có)',
        "Giờ Vào": result.visitor?.checkin_time,
        "Giờ Ra": result.visitor?.checkout_time,
        "Thời Gian Lưu Lại": result.visitor?.duration_str,
        "Thẻ ePAD": result.epad_card_status || 'Đã thu hồi',
        "Trạng Thái Database": "ĐÃ CHUYỂN SANG visitor_history.json"
      });

      // Clear quick checkout input
      const quickInp = document.getElementById('inputQuickCheckout');
      if (quickInp) quickInp.value = '';

      fetchActiveVisitors();
      fetchVisitorHistory();
      fetchDashboardAnalytics();
      fetchSystemStatus();
    } else {
      sfx.playAlertTone();
      console.warn(`%c⚠️ [DATABASE CHECKOUT FAILED] ${result.error || 'Không tìm thấy khách'}`, "color: #ef4444; font-weight: bold; font-size: 13px;");
      showToast(`Lỗi check-out: ${result.error || 'Không tìm thấy khách'}`, 'error');
    }
  } catch (e) {
    console.error("❌ [NETWORK ERROR] Lỗi kết nối check-out:", e);
    showToast('Lỗi kết nối khi check-out khách', 'error');
  }
}

// ---------------- Rendering Tables ----------------

function renderActiveVisitors() {
  const tbody = document.getElementById('activeVisitorsBody');
  if (!tbody) return;

  const search = (document.getElementById('searchActiveVisitors')?.value || '').toLowerCase();

  const filtered = state.activeVisitors.filter(v => {
    return (v.full_name || '').toLowerCase().includes(search) ||
           (v.cccd_number || '').toLowerCase().includes(search) ||
           (v.card_number || '').toLowerCase().includes(search) ||
           (v.company || '').toLowerCase().includes(search) ||
           (v.host_person || '').toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">
      <div class="empty-icon">👥</div>
      <div>Hiện không có khách nào đang trong văn phòng</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((v, i) => {
    // Time stay calculation & Overstay Alert (> 4 hours)
    let stayStr = "--";
    let isOverstay = false;
    try {
      const start = new Date(v.checkin_time.replace(" ", "T"));
      const diffMs = new Date() - start;
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      stayStr = hours > 0 ? `${hours}h ${remMins}p` : `${mins} phút`;
      if (hours >= 4) {
        isOverstay = true;
      }
    } catch (e) {
      stayStr = "--";
    }

    const cccdDisplay = v.cccd_number || v.id_number || '--';
    const cardBadge = v.card_number ? `<span class="badge-tag card">${v.card_number}</span>` : '';
    const birthInfo = v.birth_year ? `• Sinh: ${v.birth_year}` : (v.birth_date ? `• ${v.birth_date}` : '');
    const genderInfo = v.gender ? `• ${v.gender}` : '';

    return `
      <tr>
        <td style="font-weight: 700; color: #64748b;">${i + 1}</td>
        <td>
          <strong style="font-size: 0.95rem; color: #0b2341;">${escapeHtml(v.full_name)}</strong>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(v.phone || '')} ${genderInfo} ${birthInfo}</div>
        </td>
        <td>
          <span style="font-family: monospace; font-weight: 600;">${escapeHtml(cccdDisplay)}</span>
          ${cardBadge ? '<div style="margin-top: 3px;">' + cardBadge + '</div>' : ''}
        </td>
        <td>
          <strong>${escapeHtml(v.company || '--')}</strong>
          <div style="font-size: 0.74rem; color: #64748b;">${escapeHtml(v.department || 'Văn phòng')}</div>
        </td>
        <td>${escapeHtml(v.host_person || '--')}</td>
        <td>
          <strong>${v.checkin_time ? v.checkin_time.split(' ')[1] : '--'}</strong>
          <div style="font-size: 0.72rem; color: #64748b;">${v.checkin_time ? v.checkin_time.split(' ')[0] : ''}</div>
          ${v.expected_checkout_time ? '<div style="font-size: 0.70rem; color: #d97706; margin-top:2px; font-weight:600;">Dự kiến ra: ' + (v.expected_checkout_time.split(' ')[1] || v.expected_checkout_time) + '</div>' : ''}
        </td>
        <td>
          <span class="${isOverstay ? 'badge-tag overstay-alert' : ''}" style="font-weight: 700; color: ${isOverstay ? '#991b1b' : '#0284c7'};">
            ${isOverstay ? '⚠️ ' : ''}${stayStr}
          </span>
        </td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 0.35rem; justify-content: center;">
            <button class="btn-checkout" onclick="handleFastCheckout('${v.cccd_number || v.card_number || v.id}')" title="Hoàn tất lượt vào và cho khách về">
              Check-Out
            </button>
            <button class="btn-print" style="padding: 0.35rem 0.5rem; font-size: 0.75rem;" onclick="openPrintPassModalById('${v.id}')" title="In lại phiếu khách">
              🖨️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderRealtimeLogs() {
  const tbody = document.getElementById('realtimeLogsBody');
  if (!tbody) return;

  const search = (document.getElementById('searchRealtimeLogs')?.value || '').toLowerCase();
  const catFilter = state.currentCategoryFilter;
  const dirFilter = state.currentDirectionFilter || 'ALL';

  const filtered = state.realtimeLogs.filter(l => {
    // Category filter
    if (catFilter === 'STAFF' && !l.is_staff) return false;
    if (catFilter === 'VISITOR' && l.is_staff) return false;

    // Direction filter
    const dir = l.direction || (String(l.DeviceName || '').toLowerCase().includes('vào') ? 'IN' : 'OUT');
    if (dirFilter === 'IN' && dir !== 'IN') return false;
    if (dirFilter === 'OUT' && dir !== 'OUT') return false;

    // Search filter
    return (l.FullName || '').toLowerCase().includes(search) ||
           (l.EmployeeATID || '').toLowerCase().includes(search) ||
           (l.DeviceName || '').toLowerCase().includes(search) ||
           (l.Department || '').toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Chưa có bản ghi quét cửa nào phù hợp</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(l => {
    const isStaff = l.is_staff;
    const timeStr = l.CheckTime ? l.CheckTime.replace('T', ' ') : '--';
    const isIN = (l.direction === 'IN' || String(l.DeviceName || '').toLowerCase().includes('vào'));

    return `
      <tr>
        <td><small style="color:#64748b; font-family: monospace; font-weight: 600;">${timeStr}</small></td>
        <td><strong style="color: #0b2341;">${escapeHtml(l.FullName || '--')}</strong></td>
        <td><span class="badge-tag card" style="font-family: monospace;">${escapeHtml(l.EmployeeATID || '--')}</span></td>
        <td>${escapeHtml(l.Department || '--')}</td>
        <td style="text-align: center;">
          <span class="badge-direction ${isIN ? 'badge-in' : 'badge-out'}">
            ${isIN ? '🟢 Lượt VÀO' : '🔴 Lượt RA'}
          </span>
        </td>
        <td><span style="font-weight: 600; color: #475569;">${escapeHtml(l.DeviceName || '--')}</span></td>
        <td>
          <span class="badge-tag ${isStaff ? 'staff-cat' : 'visitor-cat'}">
            ${isStaff ? '🏢 Nhân Viên Văn Phòng' : '🎫 Khách Đến'}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: #64748b;">
            ${isStaff ? 'Quét Khuôn Mặt' : 'Quẹt Thẻ RFID'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

function renderVisitorHistory() {
  const tbody = document.getElementById('visitorHistoryBody');
  if (!tbody) return;

  const search = (document.getElementById('searchVisitorHistory')?.value || '').toLowerCase();

  const filtered = state.visitorHistory.filter(h => {
    return (h.full_name || '').toLowerCase().includes(search) ||
           (h.cccd_number || '').toLowerCase().includes(search) ||
           (h.card_number || '').toLowerCase().includes(search) ||
           (h.company || '').toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Chưa có dữ liệu lịch sử khách đã ra về</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((h, i) => {
    const dobGen = [h.birth_year ? `Năm ${h.birth_year}` : (h.birth_date || ''), h.gender].filter(Boolean).join(' • ');
    return `
      <tr>
        <td style="color: #64748b;">${i + 1}</td>
        <td><strong>${escapeHtml(h.full_name)}</strong></td>
        <td><span style="font-family: monospace;">${escapeHtml(h.cccd_number || h.id_number || '--')}</span></td>
        <td>${escapeHtml(dobGen || '--')}</td>
        <td>${escapeHtml(h.company || '--')}</td>
        <td>${escapeHtml(h.host_person || h.department || '--')}</td>
        <td><small style="color: #64748b;">${h.checkin_time || '--'}</small></td>
        <td><small style="color: #64748b;">${h.checkout_time || '--'}</small></td>
        <td><strong style="color: #059669;">${h.duration_str || '--'}</strong></td>
      </tr>
    `;
  }).join('');
}

function renderAuditLogs() {
  const tbody = document.getElementById('auditLogsBody');
  if (!tbody) return;

  if (state.auditLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Chưa có nhật ký lệnh mở cửa nào</td></tr>`;
    return;
  }

  tbody.innerHTML = state.auditLogs.map(a => `
    <tr>
      <td><small style="color:#64748b;">${a.timestamp}</small></td>
      <td><strong>${escapeHtml(a.door_name)}</strong></td>
      <td>${a.duration_sec}s</td>
      <td>${escapeHtml(a.operator || '--')}</td>
      <td>
        <span style="color: ${a.success ? '#10b981' : '#ef4444'}; font-weight: 700;">
          ${a.success ? 'Thành công' : 'Thất bại'}
        </span>
      </td>
    </tr>
  `).join('');
}

// ---------------- Dashboard Quick Logs Table ----------------

function renderDashboardQuickLogs() {
  const tbody = document.getElementById('dashboardQuickLogsBody');
  if (!tbody) return;

  const topLogs = (state.realtimeLogs || []).slice(0, 6);
  if (topLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Chưa có lượt quét cửa nào gần đây</td></tr>`;
    return;
  }

  tbody.innerHTML = topLogs.map(l => {
    const isStaff = l.is_staff;
    const timeStr = l.CheckTime ? (l.CheckTime.replace('T', ' ').split(' ')[1] || l.CheckTime) : '--';
    return `
      <tr>
        <td><small style="color: #64748b; font-family: monospace; font-weight: 600;">${timeStr}</small></td>
        <td><strong style="color: #0b2341;">${escapeHtml(l.FullName || '--')}</strong></td>
        <td><span style="color: #475569; font-weight: 500;">${escapeHtml(l.DeviceName || '--')}</span></td>
        <td>
          <span class="badge-tag ${isStaff ? 'staff-cat' : 'visitor-cat'}" style="font-size: 0.72rem; padding: 0.15rem 0.55rem;">
            ${isStaff ? '🏢 Văn Phòng' : '🎫 Khách Đến'}
          </span>
        </td>
        <td><small style="color: #64748b;">${isStaff ? 'Quét Mặt' : 'Thẻ RFID'}</small></td>
      </tr>
    `;
  }).join('');
}

// ---------------- Printable Visitor Pass Modal ----------------

function openPrintPassModal(data) {
  if (!data) return;

  const backdrop = document.getElementById('passModalBackdrop');
  if (!backdrop) return;

  const passName = document.getElementById('passName');
  const passCccd = document.getElementById('passCccd');
  const passDobGender = document.getElementById('passDobGender');
  const passCompany = document.getElementById('passCompany');
  const passHost = document.getElementById('passHost');
  const passTime = document.getElementById('passTime');
  const passBarcode = document.getElementById('passBarcodeText');

  if (passName) passName.innerText = data.full_name || '--';
  if (passCccd) passCccd.innerText = data.cccd_number || data.id_number || '--';
  if (passDobGender) passDobGender.innerText = `${data.birth_year ? 'Năm sinh: ' + data.birth_year : ''} ${data.gender ? '(' + data.gender + ')' : ''}`.trim() || '--';
  if (passCompany) passCompany.innerText = data.company || 'Khách vãng lai';
  if (passHost) passHost.innerText = `${data.host_person || '--'} (${data.department || 'Văn phòng'})`;
  if (passTime) passTime.innerText = data.checkin_time || new Date().toLocaleString('vi-VN');
  const passOutTime = document.getElementById('passOutTime');
  if (passOutTime) passOutTime.innerText = data.expected_checkout_time ? (data.expected_checkout_time.split(' ')[1] || data.expected_checkout_time) : '16:45';
  if (passBarcode) passBarcode.innerText = data.cccd_number || data.card_number || `SZ-${data.id || 'VISITOR'}`;

  backdrop.style.display = 'flex';
}

function openPrintPassModalById(id) {
  const found = state.activeVisitors.find(v => v.id === id);
  if (found) {
    openPrintPassModal(found);
  }
}

function closePrintPassModal() {
  const backdrop = document.getElementById('passModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ---------------- Present Details Popup Modal (Ai đang có mặt trong VP) ----------------

async function openPresentDetailsModal(type = 'staff') {
  state.currentPresentType = type;
  const backdrop = document.getElementById('presentDetailsModalBackdrop');
  if (!backdrop) return;

  const targetDate = currentAnalyticsDate || new Date().toISOString().split('T')[0];
  const isStaff = (type === 'staff');

  const titleEl = document.getElementById('presentModalTitle');
  const iconEl = document.getElementById('presentModalIcon');
  const subEl = document.getElementById('presentModalSubtitle');
  const badgeEl = document.getElementById('presentModalBadgeCount');
  const searchInp = document.getElementById('inputSearchPresentDetails');

  if (searchInp) searchInp.value = '';

  if (isStaff) {
    if (titleEl) titleEl.innerText = 'Danh Sách Nhân Viên Đang Có Mặt Trong Văn Phòng';
    if (badgeEl) {
      badgeEl.style.background = '#10b981';
      badgeEl.innerText = 'Đang tải...';
    }
    if (iconEl) {
      iconEl.style.background = '#ecfdf5';
      iconEl.style.color = '#059669';
      iconEl.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
    }
    if (subEl) subEl.innerText = `Thời gian thực ngày ${formatVnDate(targetDate)}: Nhân viên có lần quét gần nhất tại Làn VÀO`;
  } else {
    if (titleEl) titleEl.innerText = 'Danh Sách Khách Đang Có Mặt Trong Văn Phòng';
    if (badgeEl) {
      badgeEl.style.background = '#f59e0b';
      badgeEl.innerText = 'Đang tải...';
    }
    if (iconEl) {
      iconEl.style.background = '#fffbeb';
      iconEl.style.color = '#d97706';
      iconEl.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>';
    }
    if (subEl) subEl.innerText = `Thời gian thực ngày ${formatVnDate(targetDate)}: Khách có lần quẹt thẻ gần nhất tại Làn VÀO`;
  }

  backdrop.style.display = 'flex';
  await fetchPresentDetails(type, targetDate);
}

function closePresentDetailsModal() {
  const backdrop = document.getElementById('presentDetailsModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

function formatVnDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

async function fetchPresentDetails(type = 'staff', targetDate = '') {
  const tbody = document.getElementById('presentDetailsBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Đang tải danh sách người có mặt từ log quét cửa...</td></tr>`;
  }

  try {
    const d = targetDate || currentAnalyticsDate || '';
    const query = `?type=${encodeURIComponent(type)}` + (d ? `&date=${encodeURIComponent(d)}` : '');
    const res = await fetch(`/api/analytics/present_details${query}`);
    const data = await res.json();
    if (data.success) {
      state.presentDetailsList = data.items || [];
      const badgeEl = document.getElementById('presentModalBadgeCount');
      if (badgeEl) badgeEl.innerText = `${state.presentDetailsList.length} người`;
      renderPresentDetailsTable();
    }
  } catch (err) {
    console.error("Lỗi nạp chi tiết người có mặt:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:#ef4444;">Không thể tải dữ liệu: ${escapeHtml(err.message || 'Lỗi mạng')}</td></tr>`;
    }
  }
}

function renderPresentDetailsTable() {
  const tbody = document.getElementById('presentDetailsBody');
  const infoEl = document.getElementById('presentFilterInfo');
  if (!tbody) return;

  const search = (document.getElementById('inputSearchPresentDetails')?.value || '').trim().toLowerCase();
  const isStaff = (state.currentPresentType === 'staff');

  const filtered = state.presentDetailsList.filter(item => {
    if (!search) return true;
    const txt = `${item.fullname || ''} ${item.atid || ''} ${item.department || ''} ${item.company || ''} ${item.device_name || ''}`.toLowerCase();
    return txt.includes(search);
  });

  if (infoEl) {
    infoEl.innerText = `Hiển thị: ${filtered.length} / ${state.presentDetailsList.length} người`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Không tìm thấy ai phù hợp với từ khóa "${escapeHtml(search)}"</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((item, idx) => {
    const timeDisplay = item.time_only || (item.check_time ? item.check_time.replace('T', ' ').split(' ')[1] : '--');
    const deptDisplay = item.company ? `${escapeHtml(item.company)} (${escapeHtml(item.department || 'Khách')})` : escapeHtml(item.department || '--');
    return `
      <tr>
        <td style="text-align: center; color: #64748b; font-weight: 600;">${idx + 1}</td>
        <td><strong style="color: #0b2341; font-size: 0.95rem;">${escapeHtml(item.fullname || '--')}</strong></td>
        <td><span class="badge-tag card" style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(item.atid || '--')}</span></td>
        <td><span style="color: #334155; font-weight: 500;">${deptDisplay}</span></td>
        <td><small style="color: #059669; font-family: monospace; font-weight: 700; font-size: 0.88rem;">${timeDisplay}</small></td>
        <td><span style="color: #475569; font-weight: 600;">${escapeHtml(item.device_name || '--')}</span></td>
        <td>
          <span style="font-size: 0.8rem; color: #64748b;">
            ${escapeHtml(item.verify_mode || (isStaff ? 'Quét Khuôn Mặt' : 'Quẹt Thẻ RFID'))}
          </span>
        </td>
        <td style="text-align: center;">
          <span class="badge-direction badge-in" style="font-size: 0.72rem; padding: 2px 8px;">
            ✓ Đang trong VP
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------------- Popup Register Visitor Modal ----------------

function openRegisterModal() {
  const backdrop = document.getElementById('registerModalBackdrop');
  if (!backdrop) return;
  backdrop.style.display = 'flex';

  // Fill current date & time (editable, default today - now, and checkout today - 16:45)
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const nowTimeStr = now.toLocaleTimeString('vi-VN', { hour12: false }).substring(0, 5);

  const dateInp = document.getElementById('inputCheckinDate');
  const timeInp = document.getElementById('inputCheckinTime');
  const outDateInp = document.getElementById('inputCheckoutDate');
  const outTimeInp = document.getElementById('inputCheckoutTime');

  if (dateInp && !dateInp.value) dateInp.value = todayStr;
  if (timeInp && !timeInp.value) timeInp.value = nowTimeStr;
  if (outDateInp && !outDateInp.value) outDateInp.value = todayStr;
  if (outTimeInp && !outTimeInp.value) outTimeInp.value = '16:45';

  const deptSelect = document.getElementById('inputDepartment');
  if (deptSelect) {
    updateHostSuggestions(deptSelect.value);
  }

  // Focus ô Số CCCD
  setTimeout(() => {
    const cccdInp = document.getElementById('inputCccdNumber');
    if (cccdInp) {
      cccdInp.focus();
    }
  }, 100);
}

function closeRegisterModal() {
  const backdrop = document.getElementById('registerModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ---------------- Dedicated CCCD Scan Popup Modal ----------------

let scanDebounceTimer = null;
let scanAutoCloseTimer = null;
let scanCountdownInterval = null;
let lastParsedScanResult = null;
let scanCountdownSeconds = 2;

function openScanCccdModal() {
  if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
  if (scanAutoCloseTimer) clearTimeout(scanAutoCloseTimer);
  if (scanCountdownInterval) clearInterval(scanCountdownInterval);
  lastParsedScanResult = null;

  const backdrop = document.getElementById('scanCccdModalBackdrop');
  if (!backdrop) return;
  backdrop.style.display = 'flex';

  const scanInp = document.getElementById('popupScanCccdInput');
  const previewBox = document.getElementById('scanParsedPreview');
  const applyBtn = document.getElementById('btnApplyScanToForm');
  const alertText = document.getElementById('popupScanStatusText');

  if (scanInp) {
    scanInp.value = '';
    scanInp.readOnly = false;
    setTimeout(() => {
      scanInp.focus();
    }, 150);
  }
  if (previewBox) previewBox.style.display = 'none';
  if (applyBtn) {
    applyBtn.style.display = 'none';
    applyBtn.innerText = '✓ Xác Nhận & Điền Vào Form';
  }
  if (alertText) {
    alertText.innerHTML = '<span class="scanner-live-dot"></span><span>Sẵn sàng nhận tín hiệu từ máy quét...</span>';
  }
}

function closeScanCccdModal() {
  if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
  if (scanAutoCloseTimer) clearTimeout(scanAutoCloseTimer);
  if (scanCountdownInterval) clearInterval(scanCountdownInterval);

  const backdrop = document.getElementById('scanCccdModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

function commitScanResultToForm() {
  if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
  if (scanAutoCloseTimer) clearTimeout(scanAutoCloseTimer);
  if (scanCountdownInterval) clearInterval(scanCountdownInterval);

  if (!lastParsedScanResult) {
    closeScanCccdModal();
    return;
  }

  const data = lastParsedScanResult;

  // Tách thông tin từ bộ chuỗi và điền chuẩn xác vào 3 ô ngoài form
  const cccdInp = document.getElementById('inputCccdNumber');
  const nameInp = document.getElementById('inputFullName');
  const dobInp = document.getElementById('inputBirthDate');
  const yearInp = document.getElementById('inputBirthYear');

  if (cccdInp) cccdInp.value = data.cccd || '';
  if (nameInp) nameInp.value = data.fullName || '';
  if (dobInp) dobInp.value = data.birthDate || '';
  if (yearInp) yearInp.value = data.birthYear || '';

  // Đóng màn hình quét và mở lại Form Đăng Ký Khách
  closeScanCccdModal();
  openRegisterModal();

  showToast(`✓ Đã điền thông tin: ${data.fullName} (Số CC: ${data.cccd} | Ngày sinh: ${data.birthDate})`, 'success');
}

function processScannedRawString() {
  const scanInp = document.getElementById('popupScanCccdInput');
  if (!scanInp) return;
  const raw = scanInp.value.trim();
  if (!raw.includes('|')) return;

  const parsed = parseCccdQr(raw);
  if (!parsed || (!parsed.cccd && !parsed.fullName)) return;

  // Khóa input để máy quét không thể bắn thêm rác
  scanInp.readOnly = true;
  lastParsedScanResult = parsed;

  // Hiển thị khung xem trước trên màn hình quét
  const previewBox = document.getElementById('scanParsedPreview');
  const prevCccd = document.getElementById('prevCccd');
  const prevName = document.getElementById('prevName');
  const prevDob = document.getElementById('prevDob');
  const prevGender = document.getElementById('prevGender');
  const alertText = document.getElementById('popupScanStatusText');
  const applyBtn = document.getElementById('btnApplyScanToForm');

  if (prevCccd) prevCccd.innerText = parsed.cccd || '--';
  if (prevName) prevName.innerText = parsed.fullName || '--';
  if (prevDob) prevDob.innerText = `${parsed.birthDate || '--'} ${parsed.birthYear ? '(' + parsed.birthYear + ')' : ''}`;
  if (prevGender) prevGender.innerText = parsed.gender || '--';

  if (previewBox) previewBox.style.display = 'block';
  if (applyBtn) {
    applyBtn.style.display = 'inline-flex';
    applyBtn.innerText = '✓ Xác Nhận & Điền Vào Form';
  }

  sfx.playSuccessChime();

  // Đợi ở màn hình quét 2 giây để điền đủ rồi mới tắt
  scanCountdownSeconds = 2;
  if (alertText) {
    alertText.innerHTML = `<strong style="color:#059669;">✓ Đã nhận đủ chuỗi mã QR! Đang chuyển vào form sau <span id="scanCountdownVal">2</span>s...</strong>`;
  }

  if (scanCountdownInterval) clearInterval(scanCountdownInterval);
  scanCountdownInterval = setInterval(() => {
    scanCountdownSeconds--;
    const valEl = document.getElementById('scanCountdownVal');
    if (valEl) valEl.innerText = Math.max(0, scanCountdownSeconds);
    if (scanCountdownSeconds <= 0) {
      clearInterval(scanCountdownInterval);
    }
  }, 1000);

  if (scanAutoCloseTimer) clearTimeout(scanAutoCloseTimer);
  scanAutoCloseTimer = setTimeout(() => {
    commitScanResultToForm();
  }, 2000);
}

window.openRegisterModal = openRegisterModal;
window.closeRegisterModal = closeRegisterModal;
window.openScanCccdModal = openScanCccdModal;
window.closeScanCccdModal = closeScanCccdModal;
window.openPrintPassModalById = openPrintPassModalById;

// ---------------- Navigation (Sidebar Pages) ----------------

const PAGE_TITLES = {
  pageDashboard: 'Tổng Quan & Giám Sát Ra Vào',
  pageActiveVisitors: 'Khách Đang Có Mặt Trong Tòa Nhà',
  pageRealtimeScans: 'Quét Cửa Live Thời Gian Thực (4 Máy SenseFace)',
  pageHistory: 'Lịch Sử Khách Ra Vào & Báo Cáo',
  pageAudit: 'Nhật Ký Cửa & Lệnh Hệ Thống'
};

function navigateToPage(pageId) {
  // 1. Hide all page views
  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.remove('active');
  });

  // 2. Show target page
  const target = document.getElementById(pageId);
  if (target) {
    target.classList.add('active');
  }

  // 3. Update sidebar active item
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.getAttribute('data-page') === pageId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // 4. Update topbar title
  const titleEl = document.getElementById('pageTitle');
  if (titleEl && PAGE_TITLES[pageId]) {
    titleEl.innerText = PAGE_TITLES[pageId];
  }

  // 5. Trigger chart resize or page data refresh
  if (pageId === 'pageDashboard') {
    setTimeout(() => {
      if (state.hourlyChart) {
        state.hourlyChart.resize();
        state.hourlyChart.update();
      }
      if (state.donutChart) {
        state.donutChart.resize();
        state.donutChart.update();
      }
    }, 60);
    fetchDashboardAnalytics();
    fetchRealtimeLogs();
  } else if (pageId === 'pageActiveVisitors') {
    fetchActiveVisitors();
  } else if (pageId === 'pageRealtimeScans') {
    fetchRealtimeLogs();
  } else if (pageId === 'pageHistory') {
    fetchVisitorHistory();
  } else if (pageId === 'pageAudit') {
    fetchAuditLogs();
  }
}

window.navigateToPage = navigateToPage;

// ---------------- Helper Utilities ----------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------- Initialization ----------------

window.addEventListener('DOMContentLoaded', () => {
  startClock();
  initCharts();

  // Load initial data
  fetchSystemStatus();
  fetchDashboardAnalytics();
  fetchActiveVisitors();
  fetchRealtimeLogs();
  loadDepartmentsAndEmployees();

  // 1. Sidebar Navigation Links
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const pageId = item.getAttribute('data-page');
      if (pageId) navigateToPage(pageId);
    });
  });

  // Department change -> filter host person dropdown
  const deptSelectEl = document.getElementById('inputDepartment');
  const hostPersonEl = document.getElementById('inputHostPerson');

  deptSelectEl?.addEventListener('change', (e) => {
    const selectedDept = e.target.value;
    updateHostSuggestions(selectedDept);
    if (hostPersonEl) {
      hostPersonEl.value = '';
      hostPersonEl.focus();
    }
  });

  // Host person input -> auto-fill Department if empty
  hostPersonEl?.addEventListener('input', (e) => {
    const val = (e.target.value || '').trim().toLowerCase();
    if (!val || (deptSelectEl && deptSelectEl.value)) return;

    const matched = allCompanyEmployees.find(emp => {
      const codePart = emp.code || emp.atid ? ` (${emp.code || emp.atid})` : '';
      const full = `${emp.fullname}${codePart}`.toLowerCase();
      return full === val || emp.fullname.toLowerCase() === val;
    });

    if (matched && matched.department && deptSelectEl) {
      const targetDept = matched.department.trim().toLowerCase();
      for (let opt of deptSelectEl.options) {
        if (opt.value && opt.value.toLowerCase().includes(targetDept)) {
          deptSelectEl.value = opt.value;
          updateHostSuggestions(opt.value);
          break;
        }
      }
    }
  });

  // Ensure hostSuggestions is freshly populated whenever hostPersonEl is focused
  hostPersonEl?.addEventListener('focus', () => {
    if (deptSelectEl) {
      updateHostSuggestions(deptSelectEl.value);
    }
  });

  // Date Filter on Dashboard
  document.getElementById('selectAnalyticsDate')?.addEventListener('change', (e) => {
    currentAnalyticsDate = e.target.value;
    fetchDashboardAnalytics(e.target.value);
    fetchRealtimeLogs();
  });
  document.getElementById('inputCustomDate')?.addEventListener('change', (e) => {
    if (e.target.value) {
      currentAnalyticsDate = e.target.value;
      fetchDashboardAnalytics(e.target.value);
      fetchRealtimeLogs();
    }
  });

  // Manual Sync from ePAD button
  document.getElementById('btnSyncEpadHistory')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnSyncEpadHistory');
    if (btn) btn.disabled = true;
    showToast('Đang kết nối và đồng bộ dữ liệu từ máy chủ ePAD...', 'info');
    try {
      const res = await fetch('/api/sync/epad_history', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Đồng bộ ePAD thành công!', 'success');
        await loadDepartmentsAndEmployees();
        await fetchDashboardAnalytics(currentAnalyticsDate);
        await fetchRealtimeLogs();
      } else {
        showToast(data.error || 'Lỗi đồng bộ ePAD', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối đến máy chủ ePAD: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // 2. Open CCCD Scan Modal from Registration Form
  document.getElementById('btnOpenScanCccdModal')?.addEventListener('click', openScanCccdModal);

  // Close Dedicated CCCD Scan Modal
  document.getElementById('btnCloseScanCccdModal')?.addEventListener('click', closeScanCccdModal);
  document.getElementById('btnCancelScanCccdModal')?.addEventListener('click', closeScanCccdModal);

  // Dedicated Scan Input Listeners
  const popupScanInput = document.getElementById('popupScanCccdInput');
  if (popupScanInput) {
    popupScanInput.addEventListener('keydown', (e) => {
      // Chặn phím Tab tuyệt đối không cho nhảy focus đi đâu khi đang quét
      if (e.key === 'Tab') {
        e.preventDefault();
      }
      // Khi máy quét gửi Enter ở cuối chuỗi
      if (e.key === 'Enter') {
        e.preventDefault();
        if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
        processScannedRawString();
      }
    });

    popupScanInput.addEventListener('input', () => {
      // Debounce 400ms: đợi máy quét bắn hết toàn bộ chuỗi
      if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
      scanDebounceTimer = setTimeout(() => {
        processScannedRawString();
      }, 400);
    });
  }

  // Quick Test Sample Button in Scan Modal
  document.getElementById('btnTestUserSample')?.addEventListener('click', () => {
    if (popupScanInput) {
      popupScanInput.value = '049204013662||Nguyễn Huỳnh Văn Sang|10072004';
      if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
      processScannedRawString();
    }
  });

  // Apply button inside scan modal (Xác nhận & Điền Vào Form)
  document.getElementById('btnApplyScanToForm')?.addEventListener('click', () => {
    commitScanResultToForm();
  });

  // 3. Open Register Modal Buttons (Sidebar + Topbar)
  document.getElementById('btnSidebarRegister')?.addEventListener('click', openRegisterModal);
  document.getElementById('btnTopbarRegister')?.addEventListener('click', openRegisterModal);

  // 4. Close Register Modal Buttons
  document.getElementById('btnCloseRegisterModal')?.addEventListener('click', closeRegisterModal);
  document.getElementById('btnCancelRegisterModal')?.addEventListener('click', closeRegisterModal);

  // Close modals when clicking backdrop
  document.getElementById('registerModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'registerModalBackdrop') closeRegisterModal();
  });
  document.getElementById('scanCccdModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'scanCccdModalBackdrop') closeScanCccdModal();
  });
  document.getElementById('passModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'passModalBackdrop') closePrintPassModal();
  });

  // Present Details Modal Backdrop click to close
  document.getElementById('presentDetailsModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'presentDetailsModalBackdrop') closePresentDetailsModal();
  });

  // 5. Global Keyboard Shortcuts: Escape (Close all modals)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeScanCccdModal();
      closeRegisterModal();
      closePrintPassModal();
      closePresentDetailsModal();
    }
  });

  // KPI Cards Click Handlers -> Open Detailed Present Modals
  document.getElementById('cardKpiStaff')?.addEventListener('click', () => {
    openPresentDetailsModal('staff');
  });

  document.getElementById('cardKpiVisitor')?.addEventListener('click', () => {
    openPresentDetailsModal('visitor');
  });

  document.getElementById('cardKpiTotalIn')?.addEventListener('click', () => {
    navigateToPage('pageRealtimeScans');
    const inBtn = document.querySelector('#realtimeDirectionFilters [data-dir="IN"]');
    if (inBtn) inBtn.click();
  });

  document.getElementById('cardKpiTotalOut')?.addEventListener('click', () => {
    navigateToPage('pageRealtimeScans');
    const outBtn = document.querySelector('#realtimeDirectionFilters [data-dir="OUT"]');
    if (outBtn) outBtn.click();
  });

  // Present Details Modal Buttons & Search
  document.getElementById('btnClosePresentDetailsModal')?.addEventListener('click', closePresentDetailsModal);
  document.getElementById('btnCancelPresentDetailsModal')?.addEventListener('click', closePresentDetailsModal);
  document.getElementById('inputSearchPresentDetails')?.addEventListener('input', renderPresentDetailsTable);
  document.getElementById('btnRefreshPresentDetails')?.addEventListener('click', () => {
    fetchPresentDetails(state.currentPresentType, currentAnalyticsDate);
  });

  // 7. Category & Direction Filter Buttons inside Realtime Scans Page
  document.querySelectorAll('#realtimeCategoryFilters .cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#realtimeCategoryFilters .cat-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentCategoryFilter = btn.getAttribute('data-filter') || 'ALL';
      renderRealtimeLogs();
    });
  });

  document.querySelectorAll('#realtimeDirectionFilters .cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#realtimeDirectionFilters .cat-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentDirectionFilter = btn.getAttribute('data-dir') || 'ALL';
      renderRealtimeLogs();
    });
  });

  // 6. Visitor Registration Form Submission
  document.getElementById('visitorForm')?.addEventListener('submit', handleRegisterVisitor);

  // 7. Reset Form Button
  document.getElementById('btnResetForm')?.addEventListener('click', () => {
    setTimeout(() => {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const nowTimeStr = now.toLocaleTimeString('vi-VN', { hour12: false }).substring(0, 5);

      const dInp = document.getElementById('inputCheckinDate');
      const tInp = document.getElementById('inputCheckinTime');
      const oDInp = document.getElementById('inputCheckoutDate');
      const oTInp = document.getElementById('inputCheckoutTime');

      if (dInp) dInp.value = todayStr;
      if (tInp) tInp.value = nowTimeStr;
      if (oDInp) oDInp.value = todayStr;
      if (oTInp) oTInp.value = '16:45';

      const deptSelect = document.getElementById('inputDepartment');
      if (deptSelect) {
        updateHostSuggestions(deptSelect.value);
      }
      document.getElementById('inputCccdNumber')?.focus();
    }, 50);
  });

  // 10. Print Current Form Pass Button
  document.getElementById('btnPrintCurrentForm')?.addEventListener('click', () => {
    const nameInp = document.getElementById('inputFullName');
    if (!nameInp || !nameInp.value.trim()) {
      showToast('Vui lòng điền thông tin khách trước khi in phiếu!', 'warning');
      return;
    }
    const currentFormData = {
      full_name: document.getElementById('inputFullName').value,
      cccd_number: document.getElementById('inputCccdNumber').value,
      birth_year: document.getElementById('inputBirthYear').value,
      company: document.getElementById('inputCompany').value,
      host_person: document.getElementById('inputHostPerson').value,
      department: document.getElementById('inputDepartment').value,
      checkin_time: `${document.getElementById('inputCheckinDate').value} ${document.getElementById('inputCheckinTime').value}`,
      expected_checkout_time: `${document.getElementById('inputCheckoutDate').value} ${document.getElementById('inputCheckoutTime').value}`
    };
    openPrintPassModal(currentFormData);
  });

  // 11. Fast Check-out Bar Handler
  const quickCheckoutInput = document.getElementById('inputQuickCheckout');
  const btnQuickCheckoutAction = document.getElementById('btnQuickCheckoutAction');

  quickCheckoutInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleFastCheckout(quickCheckoutInput.value);
    }
  });

  btnQuickCheckoutAction?.addEventListener('click', () => {
    handleFastCheckout(quickCheckoutInput?.value || '');
  });

  // 12. Modal Buttons
  document.getElementById('btnClosePassModal')?.addEventListener('click', closePrintPassModal);
  document.getElementById('btnCancelPassModal')?.addEventListener('click', closePrintPassModal);
  document.getElementById('btnExecutePrint')?.addEventListener('click', () => {
    window.print();
  });

  // 13. Search Input Filters
  document.getElementById('searchActiveVisitors')?.addEventListener('input', renderActiveVisitors);
  document.getElementById('searchRealtimeLogs')?.addEventListener('input', renderRealtimeLogs);
  document.getElementById('searchVisitorHistory')?.addEventListener('input', renderVisitorHistory);

  // 14. Export Excel Button
  document.getElementById('btnExportHistory')?.addEventListener('click', () => {
    window.location.href = '/api/export/visitors';
  });

  // 15. Periodic Background Polling
  // Realtime device scan logs: every 4 seconds
  setInterval(() => {
    if (!document.hidden) fetchRealtimeLogs();
  }, 4000);

  // Dashboard analytics & charts: every 8 seconds (only auto-refresh if looking at today)
  setInterval(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (!document.hidden && (!currentAnalyticsDate || currentAnalyticsDate === todayStr)) {
      fetchDashboardAnalytics(currentAnalyticsDate);
    }
  }, 8000);

  // Active visitors list: every 6 seconds
  setInterval(() => {
    if (!document.hidden) fetchActiveVisitors();
  }, 6000);

  // System connectivity: every 25 seconds
  setInterval(() => {
    if (!document.hidden) fetchSystemStatus();
  }, 25000);
});


