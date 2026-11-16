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
window.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.keyCode === 80)) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Security] Đã chặn lệnh in Ctrl+P từ bàn phím / súng quét.');
    return false;
  }
}, true);

// Global State
const state = {
  currentUser: null,
  activeVisitors: [],
  visitorHistory: [],
  realtimeLogs: [],
  auditLogs: [],
  analytics: null,
  currentCategoryFilter: 'ALL',
  currentDirectionFilter: 'ALL',
  presentDetailsInside: [],
  presentDetailsLeft: [],
  presentDetailsTab: 'inside',
  currentPresentType: 'staff',
  selectedActiveVisitors: new Set(),
  currentViewingVisitor: null,
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
    } catch (e) { }
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
    } catch (e) { }
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
  const statusTag = document.getElementById('popupScanStatusText');

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
  }

  if (showNotification) {
    sfx.playSuccessChime();
    showToast(`✓ Đã điền thông tin: ${cccdData.fullName} (CCCD: ${cccdData.cccd})`, 'success');
  }
}

// ---------------- API Calls & Data Fetching ----------------

async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const dot = document.getElementById('epadDot');
    const label = document.getElementById('epadStatusLabel');

    const zkInfo = data.zk_direct || data.epad;
    if (zkInfo && zkInfo.connected) {
      if (dot) dot.className = 'pulse-dot';
      const online = zkInfo.devices_online !== undefined ? zkInfo.devices_online : 4;
      const total = zkInfo.device_count || 4;
      if (label) label.innerText = `ZKTeco: ${online}/${total} Máy Online`;
      updateDeviceStatusUI(zkInfo);
    } else {
      if (dot) dot.className = 'pulse-dot error';
      if (label) label.innerText = 'ZKTeco: Mất kết nối';
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

function updateDeviceStatusUI(zkInfo) {
  const container = document.getElementById('deviceStatusGrid');
  if (!container || !zkInfo || !zkInfo.devices) return;

  container.innerHTML = zkInfo.devices.map(dev => {
    const isOnline = dev.online;
    const doorId = (dev.ip.endsWith('.139') || dev.ip.endsWith('.138')) ? 1 : 2;
    return `
      <div class="card-device-status" style="background: #ffffff; border: 1.5px solid ${isOnline ? '#86efac' : '#fca5a5'}; border-radius: var(--radius-md); padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div class="flex-between mb-2">
            <strong class="text-black" style="font-size: 0.95rem;">${escapeHtml(dev.name)}</strong>
            <span class="badge-tag ${isOnline ? 'badge-in' : 'overstay-alert'}" style="font-size: 0.75rem; padding: 2px 8px;">
              <span class="status-dot ${isOnline ? 'dot-green' : 'dot-gray'}"></span>
              ${isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div style="font-size: 0.82rem; color: #64748b; line-height: 1.6;">
            <div><strong>IP:</strong> <span class="font-mono text-black">${escapeHtml(dev.ip)}</span>:${dev.port || 4370}</div>
            <div><strong>SN:</strong> <span class="font-mono">${escapeHtml(dev.sn || '--')}</span></div>
            <div><strong>Bộ nhớ:</strong> <span class="fw-700 text-yellow">${dev.user_count || 0} users</span></div>
            <div><strong>Firmware:</strong> <span class="text-sm">${escapeHtml(dev.firmware ? dev.firmware.split(' ')[0] : 'v6.60')}</span></div>
          </div>
        </div>
        <div class="mt-3 pt-2" style="border-top: 1px dashed #e2e8f0; display: flex; gap: 6px;">
          <button type="button" class="btn-primary btn-sm" style="flex: 1; padding: 0.35rem 0.2rem; font-size: 0.78rem; font-weight: 700; background: #16a34a; border-color: #15803d;" onclick="triggerUnlockDoor(${doorId}, '${dev.sn}', '${escapeHtml(dev.name)}', 1)">
            ⚡ Mở 1s
          </button>
          <button type="button" class="btn-secondary btn-sm" style="flex: 1; padding: 0.35rem 0.2rem; font-size: 0.78rem; font-weight: 700; background: #fee2e2; color: #991b1b; border-color: #fca5a5;" onclick="triggerLockDoor(${doorId}, '${dev.sn}', '${escapeHtml(dev.name)}')">
            🛑 Đóng Ngay
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function triggerUnlockDoor(doorId, serial = null, channelName = null, seconds = 1) {
  try {
    const targetLabel = channelName || `Cửa ${doorId}`;
    showToast(`Đang gửi tín hiệu rơ-le mở ${targetLabel}...`, 'info');
    const res = await fetch('/api/door/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        door_id: doorId,
        serial: serial,
        channel_name: channelName,
        seconds: seconds
      })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof sfx !== 'undefined' && sfx.playSuccessChime) sfx.playSuccessChime();
      showToast(data.message || `Đã kích hoạt mở ${targetLabel} (${seconds}s)!`, 'success');
      fetchAuditLogs();
    } else {
      showToast(`Không thể mở cửa: ${data.error || 'Lỗi thiết bị'}`, 'error');
    }
  } catch (err) {
    showToast(`Lỗi kết nối khi mở cửa: ${err.message}`, 'error');
  }
}

async function triggerLockDoor(doorId, serial = null, channelName = null) {
  try {
    const targetLabel = channelName || `Cửa ${doorId}`;
    showToast(`Đang gửi tín hiệu đóng/khóa ngay ${targetLabel}...`, 'info');
    const res = await fetch('/api/door/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        door_id: doorId,
        serial: serial,
        channel_name: channelName
      })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof sfx !== 'undefined' && sfx.playSuccessChime) sfx.playSuccessChime();
      showToast(data.message || `Đã khóa/đóng ${targetLabel} ngay lập tức!`, 'success');
      fetchAuditLogs();
    } else {
      showToast(`Không thể đóng cửa: ${data.error || 'Lỗi thiết bị'}`, 'error');
    }
  } catch (err) {
    showToast(`Lỗi kết nối khi đóng cửa: ${err.message}`, 'error');
  }
}

async function triggerUnlockAllDoors(seconds = 1) {
  if (!confirm(`XÁC NHẬN: Bạn có chắc chắn muốn MỞ TOÀN BỘ 4 CỬA trong ${seconds} giây không?`)) {
    return;
  }
  try {
    showToast('Đang kích hoạt mở toàn bộ 4 cửa...', 'warning');
    const res = await fetch('/api/door/unlock_all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: seconds })
    });
    const data = await res.json();
    if (data.success) {
      if (typeof sfx !== 'undefined' && sfx.playSuccessChime) sfx.playSuccessChime();
      showToast(data.message || `Đã mở toàn bộ 4 cửa (${seconds}s)!`, 'success');
      fetchAuditLogs();
    } else {
      showToast(`Lỗi mở toàn bộ cửa: ${data.error || 'Lỗi thiết bị'}`, 'error');
    }
  } catch (err) {
    showToast(`Lỗi kết nối khi mở toàn bộ cửa: ${err.message}`, 'error');
  }
}

async function triggerLockAllDoors() {
  if (!confirm('XÁC NHẬN: Bạn có chắc chắn muốn ĐÓNG / KHÓA TOÀN BỘ 4 CỬA ngay lập tức không?')) {
    return;
  }
  try {
    showToast('Đang kích hoạt đóng/khóa toàn bộ 4 cửa...', 'info');
    const res = await fetch('/api/door/lock_all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      if (typeof sfx !== 'undefined' && sfx.playSuccessChime) sfx.playSuccessChime();
      showToast(data.message || 'Đã đóng/khóa toàn bộ 4 cửa tức thì!', 'success');
      fetchAuditLogs();
    } else {
      showToast(`Lỗi đóng toàn bộ cửa: ${data.error || 'Lỗi thiết bị'}`, 'error');
    }
  } catch (err) {
    showToast(`Lỗi kết nối khi đóng toàn bộ cửa: ${err.message}`, 'error');
  }
}

window.triggerUnlockDoor = triggerUnlockDoor;
window.triggerLockDoor = triggerLockDoor;
window.triggerUnlockAllDoors = triggerUnlockAllDoors;
window.triggerLockAllDoors = triggerLockAllDoors;

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
      const depts = data.analytics.top_departments || data.analytics.departments || [];
      renderTopDepartments(depts, data.analytics.departments_type || 'visitor');
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
  } catch (e) { }
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
  } catch (e) { }
}

async function fetchVisitorHistory() {
  try {
    const res = await fetch('/api/visitors/history?limit=100');
    const data = await res.json();
    state.visitorHistory = data.history || [];
    renderVisitorHistory();
  } catch (e) { }
}

async function fetchAuditLogs() {
  try {
    const res = await fetch('/api/door/audit_logs?limit=100');
    const data = await res.json();
    state.auditLogs = data.actions || [];
    renderAuditLogs();
  } catch (e) {
    console.warn("Lỗi tải nhật ký lệnh mở cửa:", e);
  }
}

window.fetchAuditLogs = fetchAuditLogs;

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
            backgroundColor: '#11142D',
            borderRadius: 6,
            barPercentage: 0.7
          },
          {
            label: 'Khách Đến (Thẻ / Đăng ký)',
            data: new Array(defaultLabels.length).fill(0),
            backgroundColor: '#FFB800',
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
            backgroundColor: '#11142D',
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
          backgroundColor: ['#11142D', '#FFB800'],
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
            labels: {
              boxWidth: 12,
              font: { size: 11, weight: '600' },
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: '#11142D',
            padding: 10,
            callbacks: {
              label: function (context) {
                const label = context.label || '';
                return ` ${label}`;
              }
            }
          }
        }
      }
    });
  }
}

function updateKpis(kpi) {
  if (!kpi) return;
  const staffTotalEl = document.getElementById('kpiStaffTotalToday');
  const staffPresentEl = document.getElementById('kpiStaffPresent');
  const staffLeftEl = document.getElementById('kpiStaffCheckedOut');
  const staffScansEl = document.getElementById('kpiStaffScans');

  const visitorsTotalEl = document.getElementById('kpiVisitorsToday');
  const activeVisitorsEl = document.getElementById('kpiActiveVisitors');
  const checkedOutEl = document.getElementById('kpiCheckedOutToday');
  const visitorScansEl = document.getElementById('kpiVisitorScans');

  const totalInEl = document.getElementById('kpiTotalIn');
  const totalInHintEl = document.getElementById('kpiTotalInHint');
  const totalOutEl = document.getElementById('kpiTotalOut');
  const totalOutHintEl = document.getElementById('kpiTotalOutHint');

  const staffTotal = (kpi.staff_total_today !== undefined) ? kpi.staff_total_today : (kpi.staff_unique_today || 0);
  const staffPresent = (kpi.staff_present !== undefined) ? kpi.staff_present : (kpi.staff_count || 0);
  const staffLeft = (kpi.staff_checked_out !== undefined) ? kpi.staff_checked_out : Math.max(0, staffTotal - staffPresent);

  const visitorsTotal = (kpi.visitors_today !== undefined) ? kpi.visitors_today : (kpi.visitor_count || 0);
  const activeVisitors = (kpi.active_visitors_now !== undefined) ? kpi.active_visitors_now : (kpi.visitor_present || 0);
  const checkedOut = (kpi.checked_out_today !== undefined) ? kpi.checked_out_today : (kpi.visitor_checked_out || 0);
  const visitorScans = (kpi.visitor_in_scans || 0) + (kpi.visitor_out_scans || 0);

  if (staffTotalEl) staffTotalEl.innerText = staffTotal;
  if (staffPresentEl) staffPresentEl.innerText = staffPresent;
  if (staffLeftEl) staffLeftEl.innerText = staffLeft;
  if (staffScansEl) staffScansEl.innerText = kpi.staff_scans_total || 0;

  if (visitorsTotalEl) visitorsTotalEl.innerText = visitorsTotal;
  if (activeVisitorsEl) activeVisitorsEl.innerText = activeVisitors;
  if (checkedOutEl) checkedOutEl.innerText = checkedOut;
  if (visitorScansEl) visitorScansEl.innerText = visitorScans;

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
  if (state.donutChart) {
    const dist = analytics.distribution || analytics.donut || {};
    const sCount = (dist.staff_total !== undefined) ? dist.staff_total : (dist.staff_present || 0);
    const vCount = (dist.visitor_total !== undefined) ? dist.visitor_total : (dist.visitor_present || 0);
    const total = sCount + vCount;

    const sPct = total > 0 ? Math.round((sCount / total) * 100) : 0;
    const vPct = total > 0 ? (100 - sPct) : 0;

    state.donutChart.data.labels = [
      `Nhân Viên (${sCount} người - ${sPct}%)`,
      `Khách Đến (${vCount} người - ${vPct}%)`
    ];
    state.donutChart.data.datasets[0].data = total > 0 ? [sCount, vCount] : [1, 0];
    state.donutChart.update();
  }
}

function renderTopDepartments(depts, type = 'visitor') {
  const container = document.getElementById('topDepartmentsList');
  const titleEl = document.getElementById('topDepartmentsTitle');
  if (!container) return;

  if (titleEl) {
    if (type === 'visitor' && depts && depts.length > 0) {
      titleEl.innerText = 'Phòng ban tiếp khách nhiều nhất:';
    } else {
      titleEl.innerText = 'Lưu lượng theo phòng ban:';
    }
  }

  if (!depts || depts.length === 0) {
    container.innerHTML = '<span class="badge-tag">Chưa có lượt khách nào hôm nay</span>';
    return;
  }

  const unitLabel = (type === 'visitor') ? 'khách' : 'lượt';
  container.innerHTML = depts.map(d => `
    <span class="badge-tag" style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; margin: 3px 2px;">
      ${escapeHtml(d.name)} <strong class="text-yellow">(${d.count} ${unitLabel})</strong>
    </span>
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

  const hostPhoneInp = document.getElementById('inputHostPhone');
  const accessAreaInp = document.getElementById('inputAccessArea');
  const noteInp = document.getElementById('inputNote');

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
    host_phone: (hostPhoneInp?.value || '').trim(),
    host_atid: hostAtid,
    department: selectedDeptName,
    department_index: deptIndex,
    access_area: (accessAreaInp?.value || 'Văn phòng chính (Tầng 1 - Tầng 4)').trim(),
    note: (noteInp?.value || '').trim(),
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
      if (result.visitor?.card_number && result.epad_sync_ok === false) {
        showToast(result.message || 'Lưu CSDL thành công nhưng CẢNH BÁO ĐỒNG BỘ CỬA!', 'warning');
      } else {
        showToast(result.message || `Đã đăng ký thành công cho khách: ${fullName}!`, 'success');
      }

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
      const statusTag = document.getElementById('popupScanStatusText');
      if (statusTag) {
        statusTag.innerText = 'Sẵn sàng nhận tín hiệu...';
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
      if (result.conflict_visitor) {
        showCardConflict(result.conflict_visitor);
      }
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

// ---------------- Batch Selection & Action Bar ----------------

function updateBatchActionBar() {
  const bar = document.getElementById('activeBatchActionBar');
  const countEl = document.getElementById('selectedVisitorCount');
  if (!bar) return;

  const count = state.selectedActiveVisitors.size;
  if (count > 0) {
    bar.style.display = 'flex';
    if (countEl) countEl.innerText = count;
  } else {
    bar.style.display = 'none';
  }
}

function toggleSelectVisitor(id, isChecked) {
  if (isChecked) {
    state.selectedActiveVisitors.add(id);
  } else {
    state.selectedActiveVisitors.delete(id);
  }
  updateBatchActionBar();

  // Cập nhật trạng thái ô chọn tất cả
  const checkAllBox = document.getElementById('checkAllActiveVisitors');
  if (checkAllBox) {
    const search = (document.getElementById('searchActiveVisitors')?.value || '').toLowerCase();
    const filtered = state.activeVisitors.filter(v => {
      return (v.full_name || '').toLowerCase().includes(search) ||
        (v.cccd_number || '').toLowerCase().includes(search) ||
        (v.card_number || '').toLowerCase().includes(search) ||
        (v.company || '').toLowerCase().includes(search) ||
        (v.host_person || '').toLowerCase().includes(search);
    });
    checkAllBox.checked = (filtered.length > 0 && filtered.every(v => state.selectedActiveVisitors.has(v.id)));
  }
}

function toggleSelectAllActiveVisitors(isChecked) {
  const search = (document.getElementById('searchActiveVisitors')?.value || '').toLowerCase();
  const filtered = state.activeVisitors.filter(v => {
    return (v.full_name || '').toLowerCase().includes(search) ||
      (v.cccd_number || '').toLowerCase().includes(search) ||
      (v.card_number || '').toLowerCase().includes(search) ||
      (v.company || '').toLowerCase().includes(search) ||
      (v.host_person || '').toLowerCase().includes(search);
  });

  if (isChecked) {
    filtered.forEach(v => state.selectedActiveVisitors.add(v.id));
  } else {
    state.selectedActiveVisitors.clear();
  }

  renderActiveVisitors();
}

function deselectAllActiveVisitors() {
  state.selectedActiveVisitors.clear();
  const checkAllBox = document.getElementById('checkAllActiveVisitors');
  if (checkAllBox) checkAllBox.checked = false;
  renderActiveVisitors();
}

async function handleBatchCheckout() {
  const count = state.selectedActiveVisitors.size;
  if (count === 0) {
    showToast('Vui lòng tích chọn ít nhất một khách để check-out!', 'warning');
    return;
  }

  const confirmMsg = `Bạn có chắc chắn muốn Check-Out đồng loạt cho ${count} khách đã chọn không?`;
  if (!confirm(confirmMsg)) return;

  const btnBatch = document.getElementById('btnBatchCheckout');
  if (btnBatch) btnBatch.disabled = true;

  try {
    const ids = Array.from(state.selectedActiveVisitors);
    const res = await fetch('/api/visitor/batch_checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    });
    const result = await res.json();

    if (result.success) {
      sfx.playSuccessChime();
      showToast(result.message || `Đã check-out thành công cho ${result.success_count} khách!`, 'success');
      state.selectedActiveVisitors.clear();

      fetchActiveVisitors();
      fetchVisitorHistory();
      fetchDashboardAnalytics();
      fetchSystemStatus();
    } else {
      showToast(`Lỗi: ${result.error || 'Không thể check-out hàng loạt'}`, 'error');
    }
  } catch (e) {
    console.error("Lỗi kết nối check-out hàng loạt:", e);
    showToast('Lỗi kết nối khi check-out hàng loạt!', 'error');
  } finally {
    if (btnBatch) btnBatch.disabled = false;
  }
}

// ---------------- Visitor Details Modal (Hồ Sơ Chi Tiết) ----------------

function openVisitorDetailsModal(visitor) {
  if (!visitor) return;
  state.currentViewingVisitor = visitor;
  const backdrop = document.getElementById('visitorDetailsModalBackdrop');
  if (!backdrop) return;

  const nameEl = document.getElementById('vDetailName');
  const subEl = document.getElementById('vDetailSubtitle');
  const statusEl = document.getElementById('vDetailStatusBadge');
  const cccdEl = document.getElementById('vDetailCccd');
  const phoneEl = document.getElementById('vDetailPhone');
  const dobEl = document.getElementById('vDetailDob');
  const genderEl = document.getElementById('vDetailGender');
  const addressEl = document.getElementById('vDetailAddress');
  const companyEl = document.getElementById('vDetailCompany');
  const deptEl = document.getElementById('vDetailDepartment');
  const hostEl = document.getElementById('vDetailHost');
  const hostPhoneEl = document.getElementById('vDetailHostPhone');
  const purposeEl = document.getElementById('vDetailPurpose');
  const vehicleEl = document.getElementById('vDetailVehicle');
  const cardEl = document.getElementById('vDetailCard');
  const durationEl = document.getElementById('vDetailDuration');
  const checkinEl = document.getElementById('vDetailCheckin');
  const expCheckoutEl = document.getElementById('vDetailExpectedCheckout');
  const noteEl = document.getElementById('vDetailNote');
  const btnCheckout = document.getElementById('btnDetailCheckout');

  // Kiểm tra xem khách đang ở trong văn phòng hay đã về
  const isActive = state.activeVisitors.some(v => v.id === visitor.id);

  if (nameEl) nameEl.innerText = visitor.full_name || '--';
  if (subEl) subEl.innerText = `Mã hồ sơ: ${visitor.id || 'N/A'}`;

  if (statusEl) {
    if (isActive) {
      statusEl.className = 'badge-status-present';
      statusEl.innerHTML = '<span class="status-dot dot-green"></span> Đang trong VP';
    } else {
      statusEl.className = 'badge-status-left';
      statusEl.innerHTML = '<span class="status-dot dot-gray"></span> Đã check-out';
    }
  }

  if (cccdEl) cccdEl.innerText = visitor.cccd_number || visitor.id_number || '--';
  if (phoneEl) phoneEl.innerText = visitor.phone || '--';
  if (dobEl) dobEl.innerText = visitor.birth_date || (visitor.birth_year ? `Năm ${visitor.birth_year}` : '--');
  if (genderEl) genderEl.innerText = visitor.gender || '--';
  if (addressEl) addressEl.innerText = visitor.address || '--';
  if (companyEl) companyEl.innerText = visitor.company || '--';
  if (deptEl) deptEl.innerText = visitor.department || '--';
  if (hostEl) hostEl.innerText = visitor.host_person || '--';
  if (hostPhoneEl) hostPhoneEl.innerText = visitor.host_phone || '--';
  if (purposeEl) purposeEl.innerText = visitor.purpose || '--';
  if (vehicleEl) vehicleEl.innerText = visitor.vehicle_number || '--';
  if (cardEl) cardEl.innerText = visitor.card_number || '(Không dùng thẻ)';

  let stayStr = visitor.duration_str || '--';
  if (isActive && visitor.checkin_time) {
    try {
      const start = new Date(visitor.checkin_time.replace(" ", "T"));
      const diffMs = new Date() - start;
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      stayStr = hours > 0 ? `${hours} giờ ${remMins} phút` : `${mins} phút`;
    } catch (e) { }
  }
  if (durationEl) durationEl.innerText = stayStr;

  if (checkinEl) checkinEl.innerText = visitor.checkin_time || '--';
  if (expCheckoutEl) expCheckoutEl.innerText = visitor.checkout_time || visitor.expected_checkout_time || '--';
  if (noteEl) noteEl.innerText = visitor.note || '(Không có)';

  if (btnCheckout) {
    btnCheckout.style.display = isActive ? 'inline-flex' : 'none';
  }

  backdrop.style.display = 'flex';
}

function openVisitorDetailsModalById(id) {
  const found = state.activeVisitors.find(v => v.id === id) ||
    state.visitorHistory.find(h => h.id === id);
  if (found) {
    openVisitorDetailsModal(found);
  } else {
    showToast('Không tìm thấy thông tin chi tiết khách!', 'warning');
  }
}

function closeVisitorDetailsModal() {
  const backdrop = document.getElementById('visitorDetailsModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
  state.currentViewingVisitor = null;
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

  const checkAllBox = document.getElementById('checkAllActiveVisitors');
  if (checkAllBox) {
    checkAllBox.checked = (filtered.length > 0 && filtered.every(v => state.selectedActiveVisitors.has(v.id)));
  }
  updateBatchActionBar();

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
      Hiện không có khách nào đang trong văn phòng
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
    const cardBadge = v.card_number ? `<span class="badge-tag card-black text-white">${v.card_number}</span>` : '';
    const isChecked = state.selectedActiveVisitors.has(v.id);

    return `
      <tr>
        <td class="text-center" style="width: 38px;">
          <input type="checkbox" class="check-visitor-item" data-id="${v.id}" ${isChecked ? 'checked' : ''} onchange="toggleSelectVisitor('${v.id}', this.checked)">
        </td>
        <td class="fw-800 text-gray text-center" style="width: 45px;">${i + 1}</td>
        <td>
          <strong class="text-black clickable" onclick="openVisitorDetailsModalById('${v.id}')" title="Bấm xem đầy đủ hồ sơ chi tiết">${escapeHtml(v.full_name)}</strong>
        </td>
        <td>
          <span class="badge-tag card-black text-white">${escapeHtml(cccdDisplay)}</span>
          ${cardBadge ? '<div style="margin-top: 3px;">' + cardBadge + '</div>' : ''}
        </td>
        <td>
          <strong>${escapeHtml(v.company || '--')}</strong>
          <div class="text-sm text-gray">${escapeHtml(v.department || 'Văn phòng')}</div>
        </td>
        <td>${escapeHtml(v.host_person || '--')}</td>
        <td>
          <strong>${v.checkin_time ? v.checkin_time.split(' ')[1] : '--'}</strong>
          <div class="text-sm text-gray">${v.checkin_time ? v.checkin_time.split(' ')[0] : ''}</div>
        </td>
        <td>
          <span class="${isOverstay ? 'badge-tag overstay-alert' : 'badge-tag'}">
            ${isOverstay ? 'Quá giờ: ' : ''}${stayStr}
          </span>
        </td>
        <td class="text-center">
          <div class="flex-center gap-2">
            <button class="btn-secondary" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;" onclick="openVisitorDetailsModalById('${v.id}')" title="Xem đầy đủ hồ sơ chi tiết">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              Chi tiết
            </button>
            <button class="btn-primary" style="padding: 0.35rem 0.6rem; font-size: 0.8rem;" onclick="handleFastCheckout('${v.cccd_number || v.card_number || v.id}')" title="Hoàn tất lượt vào và cho khách về">
              Check-Out
            </button>
            <button class="btn-secondary" style="padding: 0.35rem 0.6rem; font-size: 0.8rem; display: inline-flex; align-items: center;" onclick="openPrintPassModalById('${v.id}')" title="In lại phiếu khách">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
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
        <td><small class="fw-800 text-gray">${timeStr}</small></td>
        <td><strong class="text-black">${escapeHtml(l.FullName || '--')}</strong></td>
        <td><span class="badge-tag card-black text-white">${escapeHtml(l.EmployeeATID || '--')}</span></td>
        <td>${escapeHtml(l.Department || '--')}</td>
        <td class="text-center">
          <span class="badge-direction ${isIN ? 'badge-in' : 'badge-out'}">
            <span class="status-dot ${isIN ? 'dot-green' : 'dot-gray'}" style="margin-right: 3px;"></span>
            ${isIN ? 'VÀO' : 'RA'}
          </span>
        </td>
        <td><span class="fw-600 text-gray">${escapeHtml(l.DeviceName || '--')}</span></td>
        <td>
          <span class="badge-tag ${isStaff ? 'card-white' : 'card-yellow text-black'}">
            ${isStaff ? 'Nhân Viên' : 'Khách Đến'}
          </span>
        </td>
        <td>
          <span class="text-sm fw-600 text-gray">
            ${isStaff ? 'Face' : 'RFID'}
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
        <td class="text-gray fw-800">${i + 1}</td>
        <td><strong class="text-black clickable" onclick="openVisitorDetailsModalById('${h.id}')" title="Bấm xem đầy đủ hồ sơ chi tiết">${escapeHtml(h.full_name)}</strong></td>
        <td><span class="badge-tag card-black text-white">${escapeHtml(h.cccd_number || h.id_number || '--')}</span></td>
        <td>${escapeHtml(dobGen || '--')}</td>
        <td>${escapeHtml(h.company || '--')}</td>
        <td>${escapeHtml(h.host_person || h.department || '--')}</td>
        <td><small class="fw-600 text-gray">${h.checkin_time || '--'}</small></td>
        <td><small class="fw-600 text-gray">${h.checkout_time || '--'}</small></td>
        <td><strong class="text-success">${h.duration_str || '--'}</strong></td>
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
      <td><small class="text-gray fw-600">${a.timestamp}</small></td>
      <td><strong class="text-black">${escapeHtml(a.door_name)}</strong></td>
      <td>${a.action === 'LOCK' ? '<span class="badge-tag card-black text-white" style="font-size: 0.75rem;">🛑 Đóng / Khóa</span>' : `<span class="badge-tag badge-in" style="font-size: 0.75rem;">⚡ Mở ${a.duration_sec}s</span>`}</td>
      <td>${escapeHtml(a.operator || '--')}</td>
      <td>
        <span class="fw-800 ${a.success ? 'text-success' : 'text-danger'}">
          ${a.success ? '✓ Thành công' : '✕ Thất bại'}
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
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Chưa có lượt quét cửa nào gần đây</td></tr>`;
    return;
  }

  tbody.innerHTML = topLogs.map(l => {
    const isStaff = l.is_staff;
    const timeStr = l.CheckTime ? (l.CheckTime.replace('T', ' ').split(' ')[1] || l.CheckTime) : '--';
    const isIN = (l.direction === 'IN' || String(l.DeviceName || '').toLowerCase().includes('vào'));

    return `
      <tr>
        <td><small class="text-gray fw-800">${timeStr}</small></td>
        <td><strong class="text-black">${escapeHtml(l.FullName || '--')}</strong></td>
        <td><span class="badge-tag card-black text-white">${escapeHtml(l.EmployeeATID || '--')}</span></td>
        <td><span class="text-gray fw-600">${escapeHtml(l.Department || '--')}</span></td>
        <td><span class="text-gray fw-600">${escapeHtml(l.DeviceName || '--')}</span></td>
        <td>
          <span class="badge-tag ${isStaff ? 'card-white' : 'card-yellow text-black'}">
            ${isStaff ? 'NV' : 'Khách'}
          </span>
        </td>
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
  const found = state.activeVisitors.find(v => v.id === id) ||
    state.visitorHistory.find(h => h.id === id);
  if (found) {
    openPrintPassModal(found);
  }
}

function closePrintPassModal() {
  const backdrop = document.getElementById('passModalBackdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ---------------- Present Details Popup Modal (2 Bản: Còn Trong VP & Đã Về) ----------------

async function openPresentDetailsModal(type = 'staff', initialTab = 'inside') {
  state.currentPresentType = type;
  state.presentDetailsTab = initialTab;
  const backdrop = document.getElementById('presentDetailsModalBackdrop');
  if (!backdrop) return;

  const targetDate = currentAnalyticsDate || new Date().toISOString().split('T')[0];
  const isStaff = (type === 'staff');

  const titleEl = document.getElementById('presentModalTitle');
  const subEl = document.getElementById('presentModalSubtitle');
  const searchInp = document.getElementById('inputSearchPresentDetails');

  if (searchInp) searchInp.value = '';

  if (isStaff) {
    if (titleEl) titleEl.innerText = 'Chi Tiết Nhân Viên Ra Vào';
    if (subEl) subEl.innerText = `Ngày ${formatVnDate(targetDate)}: Phân loại theo lần quét gần nhất từ hệ thống kiểm soát cửa`;
  } else {
    if (titleEl) titleEl.innerText = 'Chi Tiết Khách Ra Vào';
    if (subEl) subEl.innerText = `Ngày ${formatVnDate(targetDate)}: Phân loại theo lần quét thẻ gần nhất từ hệ thống cửa`;
  }

  // Cập nhật giao diện tab ngay khi mở modal
  updateTabVisualState(initialTab);

  backdrop.style.display = 'flex';
  await fetchPresentDetails(type, targetDate);
}

function switchPresentDetailsTab(tab = 'inside') {
  state.presentDetailsTab = tab;
  updateTabVisualState(tab);
  renderPresentDetailsTable();
}

function updateTabVisualState(tab) {
  const btnInside = document.getElementById('tabBtnPresentInside');
  const btnLeft = document.getElementById('tabBtnPresentLeft');
  const thTime = document.getElementById('thPresentTime');
  const thGate = document.getElementById('thPresentGate');

  if (btnInside) btnInside.classList.toggle('active', tab === 'inside');
  if (btnLeft) btnLeft.classList.toggle('active', tab === 'left');

  if (thTime) thTime.innerText = (tab === 'inside') ? 'Giờ Vào' : 'Giờ Về (Ra)';
  if (thGate) thGate.innerText = (tab === 'inside') ? 'Làn Vào' : 'Làn Ra';
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
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Đang tải danh sách từ dữ liệu nhật ký quẹt cửa...</td></tr>`;
  }

  try {
    const d = targetDate || currentAnalyticsDate || '';
    const query = `?type=${encodeURIComponent(type)}` + (d ? `&date=${encodeURIComponent(d)}` : '');
    const res = await fetch(`/api/analytics/present_details${query}`);
    const data = await res.json();
    if (data.success) {
      state.presentDetailsInside = data.inside_items || [];
      state.presentDetailsLeft = data.left_items || [];

      // Cập nhật số lượng hiển thị trên 2 tab
      const countInsideEl = document.getElementById('modalTabInsideCount');
      const countLeftEl = document.getElementById('modalTabLeftCount');
      if (countInsideEl) countInsideEl.innerText = state.presentDetailsInside.length;
      if (countLeftEl) countLeftEl.innerText = state.presentDetailsLeft.length;

      renderPresentDetailsTable();
    }
  } catch (err) {
    console.error("Lỗi nạp chi tiết người ra vào:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state text-danger">Không thể tải dữ liệu: ${escapeHtml(err.message || 'Lỗi mạng')}</td></tr>`;
    }
  }
}

function renderPresentDetailsTable() {
  const tbody = document.getElementById('presentDetailsBody');
  const infoEl = document.getElementById('presentFilterInfo');
  if (!tbody) return;

  const isInside = (state.presentDetailsTab === 'inside');
  const currentList = isInside ? state.presentDetailsInside : state.presentDetailsLeft;
  const search = (document.getElementById('inputSearchPresentDetails')?.value || '').trim().toLowerCase();
  const isStaff = (state.currentPresentType === 'staff');

  const filtered = currentList.filter(item => {
    if (!search) return true;
    const txt = `${item.fullname || ''} ${item.atid || ''} ${item.department || ''} ${item.company || ''} ${item.device_name || ''}`.toLowerCase();
    return txt.includes(search);
  });

  const tabName = isInside ? 'Còn trong văn phòng' : 'Đã về / Ra ngoài';
  if (infoEl) {
    infoEl.innerText = `Bản [${tabName}]: Hiển thị ${filtered.length} / ${currentList.length} người`;
  }

  if (filtered.length === 0) {
    const emptyMsg = search
      ? `Không tìm thấy ai phù hợp với từ khóa "${escapeHtml(search)}"`
      : (isInside ? `Hiện không có ai còn trong văn phòng.` : `Chưa ghi nhận ai đã ra về trong ngày.`);
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${emptyMsg}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((item, idx) => {
    const timeDisplay = item.time_only || (item.check_time ? item.check_time.replace('T', ' ').split(' ')[1] : '--');
    const deptDisplay = item.company ? `${escapeHtml(item.company)} (${escapeHtml(item.department || 'Khách')})` : escapeHtml(item.department || '--');

    const timeColorClass = isInside ? 'text-success fw-800' : 'text-gray fw-600';
    const statusBadge = isInside
      ? `<span class="badge-status-present">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Đang trong VP
        </span>`
      : `<span class="badge-status-left">
          <span class="status-dot dot-gray"></span>
          Đã về
        </span>`;

    return `
      <tr>
        <td class="text-center nowrap" style="width: 45px;"><span class="fw-800 text-gray">${idx + 1}</span></td>
        <td class="nowrap"><strong class="text-black">${escapeHtml(item.fullname || '--')}</strong></td>
        <td class="nowrap"><span class="badge-tag card-black text-white">${escapeHtml(item.atid || '--')}</span></td>
        <td class="nowrap"><span class="fw-600">${deptDisplay}</span></td>
        <td class="nowrap"><small class="${timeColorClass}">${timeDisplay}</small></td>
        <td class="nowrap"><span class="fw-600 text-gray">${escapeHtml(item.device_name || '--')}</span></td>
        <td class="nowrap">
          <span class="text-sm text-gray">
            ${escapeHtml(item.verify_mode || (isStaff ? 'Quét Khuôn Mặt' : 'Quẹt Thẻ RFID'))}
          </span>
        </td>
        <td class="text-center nowrap">
          ${statusBadge}
        </td>
      </tr>
    `;
  }).join('');
}

// ---------------- Card Conflict Detection in Registration Form ----------------

let currentCardConflictVisitor = null;

function showCardConflict(conflict) {
  if (!conflict) return;
  currentCardConflictVisitor = conflict;
  const conflictBox = document.getElementById('cardConflictBox');
  const conflictName = document.getElementById('conflictVisitorName');
  const conflictMeta = document.getElementById('conflictVisitorMeta');
  if (!conflictBox) return;

  if (conflictName) conflictName.textContent = conflict.full_name || 'Khách chưa rõ tên';
  if (conflictMeta) {
    const t = conflict.checkin_time ? (conflict.checkin_time.split(' ')[1] || conflict.checkin_time) : '--';
    const d = conflict.department || conflict.company || 'Văn phòng';
    const c = conflict.card_number || '--';
    conflictMeta.textContent = `Thẻ ${c} | Giờ vào: ${t} | Bộ phận: ${d}`;
  }
  conflictBox.style.display = 'block';
}

function hideCardConflict() {
  const conflictBox = document.getElementById('cardConflictBox');
  if (conflictBox) conflictBox.style.display = 'none';
  currentCardConflictVisitor = null;
}

function checkCardConflict() {
  const cardInp = document.getElementById('inputCardNumber');
  if (!cardInp) return;

  const rawVal = (cardInp.value || '').trim();
  if (!rawVal) {
    hideCardConflict();
    return;
  }

  const cleanVal = rawVal.replace(/^0+/, '');

  // Search active visitors in state
  const conflict = (state.activeVisitors || []).find(v => {
    const vCard = String(v.card_number || '').trim();
    const vClean = vCard.replace(/^0+/, '');
    const vId = String(v.id || '').trim();
    return (vCard && (vCard.toLowerCase() === rawVal.toLowerCase() || (cleanVal && vClean === cleanVal))) ||
           (vId && vId.toLowerCase() === rawVal.toLowerCase());
  });

  if (conflict) {
    showCardConflict(conflict);
  } else {
    hideCardConflict();
  }
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

  const accessAreaInp = document.getElementById('inputAccessArea');
  if (accessAreaInp && !accessAreaInp.value) {
    accessAreaInp.value = 'Văn phòng chính (Tầng 1 - Tầng 4)';
  }

  hideCardConflict();

  // Focus ô Số CCCD
  setTimeout(() => {
    const cccdInp = document.getElementById('inputCccdNumber');
    if (cccdInp) {
      cccdInp.focus();
    }
  }, 100);
}

function closeRegisterModal() {
  hideCardConflict();
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
  }
  if (alertText) {
    alertText.innerText = 'Sẵn sàng nhận tín hiệu từ máy quét...';
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

  // Tách thông tin từ bộ chuỗi và điền chuẩn xác vào form
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

  showToast(`✓ Đã điền thông tin: ${data.fullName}`, 'success');
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
  const alertText = document.getElementById('popupScanStatusText');
  const applyBtn = document.getElementById('btnApplyScanToForm');

  if (prevCccd) prevCccd.innerText = parsed.cccd || '--';
  if (prevName) prevName.innerText = parsed.fullName || '--';

  if (previewBox) previewBox.style.display = 'block';
  if (applyBtn) applyBtn.style.display = 'inline-flex';

  sfx.playSuccessChime();

  if (alertText) {
    alertText.innerText = `✓ Đã nhận đủ chuỗi mã QR! Đang tự động điền form...`;
  }

  if (scanAutoCloseTimer) clearTimeout(scanAutoCloseTimer);
  scanAutoCloseTimer = setTimeout(() => {
    commitScanResultToForm();
  }, 1500);
}

window.openRegisterModal = openRegisterModal;
window.closeRegisterModal = closeRegisterModal;
window.openScanCccdModal = openScanCccdModal;
window.closeScanCccdModal = closeScanCccdModal;
window.openPrintPassModalById = openPrintPassModalById;
window.openVisitorDetailsModal = openVisitorDetailsModal;
window.openVisitorDetailsModalById = openVisitorDetailsModalById;
window.closeVisitorDetailsModal = closeVisitorDetailsModal;
window.toggleSelectVisitor = toggleSelectVisitor;
window.toggleSelectAllActiveVisitors = toggleSelectAllActiveVisitors;
window.deselectAllActiveVisitors = deselectAllActiveVisitors;
window.handleBatchCheckout = handleBatchCheckout;

// ---------------- Navigation (Sidebar Pages) ----------------

const PAGE_TITLES = {
  pageDashboard: 'Tổng Quan & Giám Sát Ra Vào',
  pageActiveVisitors: 'Khách Đang Có Mặt Trong Tòa Nhà',
  pageRealtimeScans: 'Quét Cửa Live Thời Gian Thực',
  pageEmployees: 'Danh Bạ Nhân Sự & Sinh Trắc Học',
  pageHistory: 'Lịch Sử Khách Ra Vào & Báo Cáo',
  pageAudit: 'Nhật Ký Cửa & Lệnh Hệ Thống'
};

function navigateToPage(pageId) {
  // Phân quyền: Nhân viên thường (staff) chỉ được phép xem pageDashboard & pageActiveVisitors
  if (state.currentUser && state.currentUser.role === 'staff') {
    if (pageId !== 'pageDashboard' && pageId !== 'pageActiveVisitors') {
      showToast('Tính năng này chỉ dành riêng cho Quản trị viên (Admin)', 'warning');
      return;
    }
  }

  document.querySelectorAll('.page-view').forEach(view => {
    view.classList.remove('active');
  });

  const target = document.getElementById(pageId);
  if (target) {
    target.classList.add('active');
  }

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.getAttribute('data-page') === pageId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  const titleEl = document.getElementById('pageTitle');
  if (titleEl && PAGE_TITLES[pageId]) {
    titleEl.innerText = PAGE_TITLES[pageId];
  }

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
  } else if (pageId === 'pageEmployees') {
    loadEmployeesDirectoryPage();
  } else if (pageId === 'pageHistory') {
    fetchVisitorHistory();
  } else if (pageId === 'pageAudit') {
    fetchAuditLogs();
  }
}

window.navigateToPage = navigateToPage;

function applyUserRole(user) {
  state.currentUser = user;
  const isStaff = user && user.role === 'staff';

  if (isStaff) {
    document.body.classList.add('role-staff');
  } else {
    document.body.classList.remove('role-staff');
  }

  const userFullNameEl = document.getElementById('userFullName');
  const userRoleBadgeEl = document.getElementById('userRoleBadge');
  const userAvatarEl = document.getElementById('userAvatar');

  if (user) {
    if (userFullNameEl) userFullNameEl.innerText = user.full_name || user.username;
    if (userRoleBadgeEl) {
      if (isStaff) {
        userRoleBadgeEl.innerText = 'Nhân viên';
        userRoleBadgeEl.classList.add('staff');
      } else {
        userRoleBadgeEl.innerText = 'Quản trị viên';
        userRoleBadgeEl.classList.remove('staff');
      }
    }
    if (userAvatarEl) {
      const initial = (user.full_name || user.username || 'U').charAt(0).toUpperCase();
      userAvatarEl.innerText = initial;
      if (isStaff) {
        userAvatarEl.classList.add('staff');
      } else {
        userAvatarEl.classList.remove('staff');
      }
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------- Initialization ----------------

window.addEventListener('DOMContentLoaded', () => {

  // --- LOGIC CHO LANDING PAGE, BẢO MẬT & PHÂN QUYỀN ĐĂNG NHẬP ---
  const landingPage = document.getElementById('landingPage');
  const loginPage = document.getElementById('loginPage');
  const mainApp = document.getElementById('mainApp');

  let isSystemStarted = false;
  function startSystemData() {
    if (isSystemStarted) return;
    isSystemStarted = true;
    startClock();
    initCharts();
    fetchSystemStatus();
    fetchDashboardAnalytics();
    fetchActiveVisitors();
    fetchRealtimeLogs();
    loadDepartmentsAndEmployees();
  }

  // 1. Tự động kiểm tra session đăng nhập có sẵn từ cookie server
  fetch('/api/auth/me')
    .then(res => res.json())
    .then(data => {
      if (data.authenticated && data.user) {
        landingPage.style.display = 'none';
        loginPage.style.display = 'none';
        mainApp.style.display = 'flex';
        mainApp.style.opacity = '1';
        applyUserRole(data.user);
        startSystemData();
      }
    })
    .catch(err => {
      console.warn('Lỗi kiểm tra session đăng nhập:', err);
    });

  // 2. Xử lý nút bắt đầu từ Landing Page
  const btnStart = document.getElementById('btnStart');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      landingPage.style.opacity = '0';
      setTimeout(() => {
        landingPage.style.display = 'none';
        loginPage.style.display = 'flex';
        setTimeout(() => loginPage.style.opacity = '1', 50);
        document.getElementById('username')?.focus();
      }, 400);
    });
  }

  // 3. Xử lý Form đăng nhập thật (gọi Backend /api/auth/login)
  const loginForm = document.getElementById('loginForm');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const loginErrorBanner = document.getElementById('loginError');
  const loginErrorText = document.getElementById('loginErrorText');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = (document.getElementById('username')?.value || '').trim();
      const p = (document.getElementById('password')?.value || '').trim();

      if (!u || !p) {
        if (loginErrorBanner) {
          if (loginErrorText) loginErrorText.innerText = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu!';
          loginErrorBanner.style.display = 'flex';
        }
        return;
      }

      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.innerHTML = '<span>Đang xác thực...</span>';
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: u, password: p })
        });
        const data = await res.json();

        if (data.success && data.user) {
          if (loginErrorBanner) loginErrorBanner.style.display = 'none';
          applyUserRole(data.user);

          loginPage.style.opacity = '0';
          setTimeout(() => {
            loginPage.style.display = 'none';
            mainApp.style.display = 'flex';
            setTimeout(() => mainApp.style.opacity = '1', 50);
            showToast(`Đăng nhập thành công! Xin chào ${data.user.full_name}`, 'success');
            startSystemData();
          }, 350);
        } else {
          if (loginErrorBanner) {
            if (loginErrorText) loginErrorText.innerText = data.error || 'Tài khoản hoặc mật khẩu không chính xác!';
            loginErrorBanner.style.display = 'flex';
          }
          const pwdInput = document.getElementById('password');
          if (pwdInput) {
            pwdInput.value = '';
            pwdInput.focus();
          }
        }
      } catch (err) {
        if (loginErrorBanner) {
          if (loginErrorText) loginErrorText.innerText = 'Không thể kết nối đến máy chủ: ' + err.message;
          loginErrorBanner.style.display = 'flex';
        }
      } finally {
        if (btnLoginSubmit) {
          btnLoginSubmit.disabled = false;
          btnLoginSubmit.innerHTML = '<span>Đăng Nhập</span>';
        }
      }
    });
  }

  // 4. Nút hiện / ẩn mật khẩu (Eye Toggle)
  const btnTogglePassword = document.getElementById('btnTogglePassword');
  const passwordInput = document.getElementById('password');
  const eyeIcon = document.getElementById('eyeIcon');
  if (btnTogglePassword && passwordInput) {
    btnTogglePassword.addEventListener('click', () => {
      const isPwd = passwordInput.type === 'password';
      passwordInput.type = isPwd ? 'text' : 'password';
      if (eyeIcon) {
        if (isPwd) {
          // Hiện mật khẩu -> Icon gạch chéo
          eyeIcon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          `;
        } else {
          // Ẩn mật khẩu -> Icon mắt mở
          eyeIcon.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          `;
        }
      }
    });
  }

  // 5. Quên mật khẩu
  document.getElementById('btnForgotPassword')?.addEventListener('click', () => {
    alert('Vui lòng liên hệ Quản trị viên hệ thống SeaZen Security hoặc bộ phận IT để được cấp lại mật khẩu.');
  });

  // 6. Xử lý Đăng xuất
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { }

      showToast('Đã đăng xuất khỏi hệ thống', 'info');
      state.currentUser = null;
      document.body.classList.remove('role-staff');

      mainApp.style.opacity = '0';
      setTimeout(() => {
        mainApp.style.display = 'none';
        loginPage.style.display = 'flex';
        setTimeout(() => loginPage.style.opacity = '1', 50);
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        if (usernameInput) usernameInput.value = '';
        if (passwordInput) passwordInput.value = '';
      }, 350);
    });
  }
  // -------------------------------------------------------------

  // ======================================================================
  // Quản lý Danh Bạ Nhân Sự & Sinh Trắc Học
  // ======================================================================

  let currentEmpPage = 1;
  let currentEmpTotalPages = 1;
  let empSearchTimeout = null;

  async function loadEmployeesDirectoryPage(page = 1) {
    currentEmpPage = page;
    const tbody = document.getElementById('employeesTableBody');
    const countLabel = document.getElementById('empTableCountLabel');
    const pageInfo = document.getElementById('empPaginationInfo');
    const searchInput = document.getElementById('inputEmployeeSearch');
    const deptSelect = document.getElementById('selectEmployeeDeptFilter');

    const query = (searchInput?.value || '').trim();
    const dept = (deptSelect?.value || '').trim();

    // Populate department filter dropdown if empty
    if (deptSelect && deptSelect.options.length <= 1 && companyDepartments.length > 0) {
      companyDepartments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = d.name;
        deptSelect.appendChild(opt);
      });
    }

    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-gray"><div class="spinner-sm" style="display:inline-block; margin-right:8px;"></div> Đang tải danh bạ nhân sự...</td></tr>`;
    }

    try {
      const params = new URLSearchParams({
        page: currentEmpPage,
        limit: 25,
        q: query,
        department: dept
      });

      const response = await fetch(`/api/employees?${params.toString()}`);
      if (!response.ok) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">Không thể nạp danh bạ (HTTP ${response.status})</td></tr>`;
        return;
      }
      const res = await response.json();
      if (!res || !res.success) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">Không thể nạp danh bạ nhân sự: ${res?.error || 'Lỗi không xác định'}</td></tr>`;
        return;
      }

      currentEmpTotalPages = res.total_pages || 1;
      const total = res.total || 0;
      const emps = res.employees || [];

      // Update KPI stats
      const empTotalEl = document.getElementById('empTotalStat');
      if (empTotalEl) empTotalEl.textContent = total.toLocaleString();

      const empDeptsEl = document.getElementById('empDeptsStat');
      if (empDeptsEl) empDeptsEl.textContent = (res.departments_count || 12).toLocaleString();

      if (countLabel) {
        countLabel.textContent = `Hiển thị ${emps.length} / ${total} nhân sự`;
      }

      if (pageInfo) {
        pageInfo.textContent = `Trang ${res.page} / ${res.total_pages} (Tổng ${total} nhân sự)`;
      }

      // Prev/Next buttons state
      const btnPrev = document.getElementById('btnEmpPrevPage');
      const btnNext = document.getElementById('btnEmpNextPage');
      if (btnPrev) btnPrev.disabled = currentEmpPage <= 1;
      if (btnNext) btnNext.disabled = currentEmpPage >= currentEmpTotalPages;

      if (emps.length === 0) {
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-gray">Không tìm thấy nhân viên nào phù hợp với bộ lọc.</td></tr>`;
        }
        return;
      }

      // Render table rows
      if (tbody) {
        tbody.innerHTML = emps.map(emp => {
          const atid = emp.atid || emp.code || '--';
          const code = emp.code || emp.atid || '--';
          const name = emp.fullname || 'Chưa cập nhật';
          const deptName = emp.department || '--';
          const cardNum = emp.card_number || '(Chưa cấp)';
          
          // Initial letter for avatar
          const words = name.trim().split(' ');
          const initial = words[words.length - 1].charAt(0).toUpperCase();

          return `
            <tr>
              <td>
                <div style="width: 34px; height: 34px; border-radius: 50%; background: #11142D; color: #fbbf24; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;">
                  ${initial}
                </div>
              </td>
              <td><span class="badge-tag card-black text-white" style="font-family: monospace; font-size: 12px;">${escapeHtml(atid)}</span></td>
              <td><span style="color: #334155; font-weight: 600;">${escapeHtml(code)}</span></td>
              <td><strong class="text-black" style="color: #11142D; font-size: 0.95rem; font-weight: 700;">${escapeHtml(name)}</strong></td>
              <td><span class="badge-tag" style="font-size: 11px;">${escapeHtml(deptName)}</span></td>
              <td>
                ${cardNum !== '(Chưa cấp)' && cardNum !== ''
                  ? `<span class="badge-tag" style="background: #ede9fe; color: #6d28d9; font-family: monospace; font-size: 11px; font-weight: 600;">💳 ${escapeHtml(cardNum)}</span>` 
                  : `<span class="text-gray" style="font-size: 12px;">Chưa cấp thẻ</span>`}
              </td>
              <td>
                <span style="display: inline-flex; align-items: center; gap: 4px; color: #166534; background: #dcfce7; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; border: 1px solid #bbf7d0;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  Face v4/v7
                </span>
              </td>
              <td style="text-align: right;">
                <span class="badge-active-pill" style="display: inline-flex; align-items: center; gap: 5px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700;">
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
                  Hoạt động
                </span>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Lỗi khi nạp danh bạ nhân sự:', err);
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">Lỗi kết nối máy chủ: ${err.message}</td></tr>`;
    }
  }

  // Hook up event listeners for employees page
  document.getElementById('inputEmployeeSearch')?.addEventListener('input', () => {
    clearTimeout(empSearchTimeout);
    empSearchTimeout = setTimeout(() => {
      loadEmployeesDirectoryPage(1);
    }, 300);
  });

  document.getElementById('selectEmployeeDeptFilter')?.addEventListener('change', () => {
    loadEmployeesDirectoryPage(1);
  });

  document.getElementById('btnRefreshEmployees')?.addEventListener('click', () => {
    loadEmployeesDirectoryPage(currentEmpPage);
    showToast('Đã làm mới danh bạ nhân sự', 'success');
  });

  document.getElementById('btnEmpPrevPage')?.addEventListener('click', () => {
    if (currentEmpPage > 1) {
      loadEmployeesDirectoryPage(currentEmpPage - 1);
    }
  });

  document.getElementById('btnEmpNextPage')?.addEventListener('click', () => {
    if (currentEmpPage < currentEmpTotalPages) {
      loadEmployeesDirectoryPage(currentEmpPage + 1);
    }
  });

  // Sự kiện chuyển trang Sidebar
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const pageId = item.getAttribute('data-page');
      if (pageId) navigateToPage(pageId);
    });
  });

  // Department change -> filter host person
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

  hostPersonEl?.addEventListener('focus', () => {
    if (deptSelectEl) {
      updateHostSuggestions(deptSelectEl.value);
    }
  });

  // Lọc theo ngày
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

  // Nút Sync 4 máy cửa ZKTeco
  document.getElementById('btnSyncEpadHistory')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnSyncEpadHistory');
    if (btn) btn.disabled = true;
    showToast('Đang kết nối và đồng bộ trực tiếp từ 4 máy ZKTeco SenseFace (TCP 4370)...', 'info');
    try {
      const res = await fetch('/api/sync/epad_history', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Đồng bộ 4 máy ZKTeco thành công!', 'success');
        await loadDepartmentsAndEmployees();
        await fetchDashboardAnalytics(currentAnalyticsDate);
        await fetchRealtimeLogs();
        await fetchSystemStatus();
      } else {
        showToast(data.error || 'Lỗi đồng bộ dữ liệu thiết bị', 'error');
      }
    } catch (err) {
      showToast('Không thể kết nối đến máy chủ: ' + err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Nút kiểm tra trạng thái 4 máy cửa
  document.getElementById('btnRefreshDeviceStatus')?.addEventListener('click', async () => {
    showToast('Đang kiểm tra kết nối 4 máy ZKTeco...', 'info');
    await fetchSystemStatus();
    showToast('Đã cập nhật trạng thái kết nối 4 máy cửa!', 'success');
  });

  // Nút Khóa / Đóng Toàn Bộ Cửa Ngay Lập Tức
  document.getElementById('btnEmergencyLockAll')?.addEventListener('click', () => {
    triggerLockAllDoors();
  });

  // Nút Mở Toàn Bộ Cửa (Xung 1s)
  document.getElementById('btnEmergencyUnlockAll')?.addEventListener('click', () => {
    triggerUnlockAllDoors(1);
  });

  // Mở Đăng Ký
  document.getElementById('btnSidebarRegister')?.addEventListener('click', openRegisterModal);
  document.getElementById('btnTopbarRegister')?.addEventListener('click', openRegisterModal);
  document.getElementById('btnCloseRegisterModal')?.addEventListener('click', closeRegisterModal);
  document.getElementById('btnCancelRegisterModal')?.addEventListener('click', closeRegisterModal);

  // Mở Quét CCCD
  document.getElementById('btnOpenScanCccdModal')?.addEventListener('click', openScanCccdModal);
  document.getElementById('btnCloseScanCccdModal')?.addEventListener('click', closeScanCccdModal);
  document.getElementById('btnCancelScanCccdModal')?.addEventListener('click', closeScanCccdModal);

  const popupScanInput = document.getElementById('popupScanCccdInput');
  if (popupScanInput) {
    popupScanInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') e.preventDefault();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
        processScannedRawString();
      }
    });
    popupScanInput.addEventListener('input', () => {
      if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
      scanDebounceTimer = setTimeout(() => {
        processScannedRawString();
      }, 400);
    });
  }

  document.getElementById('btnApplyScanToForm')?.addEventListener('click', () => {
    commitScanResultToForm();
  });

  // Đóng Modal qua Backdrop
  document.getElementById('registerModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'registerModalBackdrop') closeRegisterModal();
  });
  document.getElementById('scanCccdModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'scanCccdModalBackdrop') closeScanCccdModal();
  });
  document.getElementById('passModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'passModalBackdrop') closePrintPassModal();
  });
  document.getElementById('presentDetailsModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'presentDetailsModalBackdrop') closePresentDetailsModal();
  });
  document.getElementById('visitorDetailsModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'visitorDetailsModalBackdrop') closeVisitorDetailsModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeScanCccdModal();
      closeRegisterModal();
      closePrintPassModal();
      closePresentDetailsModal();
      closeVisitorDetailsModal();
    }
  });

  // KPI Click & Sub-block Clicks (Còn trong VP & Đã về)
  document.getElementById('subKpiStaffInside')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPresentDetailsModal('staff', 'inside');
  });
  document.getElementById('subKpiStaffLeft')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPresentDetailsModal('staff', 'left');
  });
  document.getElementById('cardKpiStaff')?.addEventListener('click', () => openPresentDetailsModal('staff', 'inside'));

  document.getElementById('subKpiVisitorInside')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPresentDetailsModal('visitor', 'inside');
  });
  document.getElementById('subKpiVisitorLeft')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPresentDetailsModal('visitor', 'left');
  });
  document.getElementById('cardKpiVisitor')?.addEventListener('click', () => openPresentDetailsModal('visitor', 'inside'));

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

  // Present Details Modal Tabs (2 Bản)
  document.getElementById('tabBtnPresentInside')?.addEventListener('click', () => switchPresentDetailsTab('inside'));
  document.getElementById('tabBtnPresentLeft')?.addEventListener('click', () => switchPresentDetailsTab('left'));

  // Present Details Controls
  document.getElementById('btnClosePresentDetailsModal')?.addEventListener('click', closePresentDetailsModal);
  document.getElementById('btnCancelPresentDetailsModal')?.addEventListener('click', closePresentDetailsModal);
  document.getElementById('inputSearchPresentDetails')?.addEventListener('input', renderPresentDetailsTable);
  document.getElementById('btnRefreshPresentDetails')?.addEventListener('click', () => {
    fetchPresentDetails(state.currentPresentType, currentAnalyticsDate);
  });

  // Batch Checkout Active Visitors
  document.getElementById('checkAllActiveVisitors')?.addEventListener('change', function () {
    toggleSelectAllActiveVisitors(this.checked);
  });
  document.getElementById('btnBatchCheckout')?.addEventListener('click', handleBatchCheckout);
  document.getElementById('btnDeselectAllActive')?.addEventListener('click', deselectAllActiveVisitors);

  // Visitor Details Modal Controls
  document.getElementById('btnCloseVisitorDetailsModal')?.addEventListener('click', closeVisitorDetailsModal);
  document.getElementById('btnCancelVisitorDetailsModal')?.addEventListener('click', closeVisitorDetailsModal);
  document.getElementById('btnDetailPrintPass')?.addEventListener('click', () => {
    if (state.currentViewingVisitor) {
      openPrintPassModal(state.currentViewingVisitor);
    }
  });
  document.getElementById('btnDetailCheckout')?.addEventListener('click', () => {
    if (state.currentViewingVisitor) {
      const v = state.currentViewingVisitor;
      handleFastCheckout(v.cccd_number || v.card_number || v.id);
      closeVisitorDetailsModal();
    }
  });

  // Category Filters
  document.querySelectorAll('#realtimeCategoryFilters .btn-filter, #realtimeCategoryFilters .cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#realtimeCategoryFilters .btn-filter, #realtimeCategoryFilters .cat-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentCategoryFilter = btn.getAttribute('data-filter') || 'ALL';
      renderRealtimeLogs();
    });
  });

  document.querySelectorAll('#realtimeDirectionFilters .btn-filter, #realtimeDirectionFilters .cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#realtimeDirectionFilters .btn-filter, #realtimeDirectionFilters .cat-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentDirectionFilter = btn.getAttribute('data-dir') || 'ALL';
      renderRealtimeLogs();
    });
  });

  // Submit đăng ký
  document.getElementById('visitorForm')?.addEventListener('submit', handleRegisterVisitor);

  // Nút Reset
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

      const hostPhoneInp = document.getElementById('inputHostPhone');
      const accessAreaInp = document.getElementById('inputAccessArea');
      const noteInp = document.getElementById('inputNote');
      const purposeInp = document.getElementById('inputPurpose');
      const vehicleInp = document.getElementById('inputVehicle');
      const cardInp = document.getElementById('inputCardNumber');
      const phoneInp = document.getElementById('inputPhone');
      const companyInp = document.getElementById('inputCompany');
      const nameInp = document.getElementById('inputFullName');
      const cccdInp = document.getElementById('inputCccdNumber');
      const birthDateInp = document.getElementById('inputBirthDate');

      if (hostPhoneInp) hostPhoneInp.value = '';
      if (accessAreaInp) accessAreaInp.value = 'Văn phòng chính (Tầng 1 - Tầng 4)';
      if (noteInp) noteInp.value = '';
      if (purposeInp) purposeInp.value = '';
      if (vehicleInp) vehicleInp.value = '';
      if (cardInp) cardInp.value = '';
      if (phoneInp) phoneInp.value = '';
      if (companyInp) companyInp.value = '';
      if (nameInp) nameInp.value = '';
      if (cccdInp) cccdInp.value = '';
      if (birthDateInp) birthDateInp.value = '';

      const deptSelect = document.getElementById('inputDepartment');
      if (deptSelect) {
        updateHostSuggestions(deptSelect.value);
      }
      hideCardConflict();
      document.getElementById('inputCccdNumber')?.focus();
    }, 50);
  });

  // ---------------- Card Conflict Detection & 1-Click Checkout ----------------
  const cardInpEl = document.getElementById('inputCardNumber');
  if (cardInpEl) {
    cardInpEl.addEventListener('input', checkCardConflict);
    cardInpEl.addEventListener('change', checkCardConflict);
    cardInpEl.addEventListener('paste', () => setTimeout(checkCardConflict, 50));
  }

  const btnConflictCheckoutEl = document.getElementById('btnConflictCheckout');
  if (btnConflictCheckoutEl) {
    btnConflictCheckoutEl.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!currentCardConflictVisitor) return;

      const targetKey = currentCardConflictVisitor.card_number || currentCardConflictVisitor.id;
      const visitorName = currentCardConflictVisitor.full_name || 'khách cũ';

      btnConflictCheckoutEl.disabled = true;
      btnConflictCheckoutEl.innerHTML = '<div class="spinner-sm" style="display:inline-block; margin-right:6px;"></div> Đang check-out...';

      try {
        const res = await fetch('/api/visitor/fast_checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: targetKey })
        });
        const result = await res.json();
        if (result.success) {
          sfx.playSuccessChime();
          showToast(`Đã Check-Out thành công cho "${visitorName}". Thẻ ${targetKey} đã được thu hồi và sẵn sàng cấp mới!`, 'success');

          // Refresh all data
          await fetchActiveVisitors();
          await fetchDashboardAnalytics();
          await fetchVisitorHistory();

          // Hide conflict alert box
          hideCardConflict();
        } else {
          showToast(`Lỗi Check-Out: ${result.error || 'Thao tác không thành công'}`, 'error');
        }
      } catch (err) {
        showToast(`Lỗi kết nối máy chủ: ${err.message}`, 'error');
      } finally {
        btnConflictCheckoutEl.disabled = false;
        btnConflictCheckoutEl.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          ⚡ Check-Out Khách Này & Thu Hồi Thẻ
        `;
      }
    });
  }

  // In phiếu
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

  // Checkout Box
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

  // Pass Modal Buttons
  document.getElementById('btnClosePassModal')?.addEventListener('click', closePrintPassModal);
  document.getElementById('btnCancelPassModal')?.addEventListener('click', closePrintPassModal);
  document.getElementById('btnExecutePrint')?.addEventListener('click', () => {
    window.print();
  });

  // Live Search
  document.getElementById('searchActiveVisitors')?.addEventListener('input', renderActiveVisitors);
  document.getElementById('searchRealtimeLogs')?.addEventListener('input', renderRealtimeLogs);
  document.getElementById('searchVisitorHistory')?.addEventListener('input', renderVisitorHistory);

  // Xuất Excel
  document.getElementById('btnExportHistory')?.addEventListener('click', () => {
    window.location.href = '/api/export/visitors';
  });

  // Interval Fetching
  setInterval(() => {
    if (mainApp.style.display !== 'none' && !document.hidden) fetchRealtimeLogs();
  }, 4000);

  setInterval(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (mainApp.style.display !== 'none' && !document.hidden && (!currentAnalyticsDate || currentAnalyticsDate === todayStr)) {
      fetchDashboardAnalytics(currentAnalyticsDate);
    }
  }, 8000);

  setInterval(() => {
    if (mainApp.style.display !== 'none' && !document.hidden) fetchActiveVisitors();
  }, 6000);

  setInterval(() => {
    if (mainApp.style.display !== 'none' && !document.hidden) fetchSystemStatus();
  }, 25000);
});