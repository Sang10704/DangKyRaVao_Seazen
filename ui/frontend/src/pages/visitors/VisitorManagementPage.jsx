import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { apiFetch } from '../../services/apiClient';

function foldVn(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function normCard(c) {
  const s = String(c || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || '0';
  return s.toLowerCase();
}

function parseDtMs(raw) {
  const s = String(raw || '').replace('T', ' ').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    ).getTime();
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    ).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function formatDurationVi(totalMinutes) {
  const mins = Math.max(0, Math.floor(totalMinutes || 0));
  const days = Math.floor(mins / 1440);
  const remH = mins % 1440;
  const hrs = Math.floor(remH / 60);
  const rm = remH % 60;
  if (days > 0) return hrs > 0 ? `${days} ngày ${hrs}g ${rm}p` : `${days} ngày ${rm}p`;
  if (hrs > 0) return `${hrs}g ${String(rm).padStart(2, '0')}p`;
  return `${rm} phút`;
}

function formatDateTimeCompact(raw, nowMs) {
  const s = String(raw || '').replace('T', ' ').trim();
  if (!s) return '—';
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?/);
  if (!m) return s.slice(0, 16);
  const dIso = `${m[1]}-${m[2]}-${m[3]}`;
  const hm = m[5] ? `${m[4]}:${m[5]}` : m[4];
  if (dIso === todayIso) return hm;
  return `${m[3]}/${m[2]} ${hm}`;
}

/**
 * Smart dd/MM/yyyy formatter:
 * - Typing "10072004" automatically formats into "10/07/2004" (inserts '/' after dd and MM).
 * - Pressing Backspace at a '/' boundary deletes the preceding digit cleanly without trapping the cursor.
 */
function formatDobSmart(nextVal, prevVal = '') {
  const nextStr = String(nextVal || '');
  const prevStr = String(prevVal || '');
  const isDeleting = nextStr.length < prevStr.length;
  let digits = nextStr.replace(/\D/g, '').slice(0, 8);

  if (isDeleting && prevStr.endsWith('/') && !nextStr.endsWith('/')) {
    digits = digits.slice(0, -1);
  }

  if (digits.length === 0) return '';
  if (digits.length < 2) return digits;
  if (digits.length === 2) return isDeleting ? digits : `${digits}/`;
  if (digits.length < 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  if (digits.length === 4) {
    return isDeleting
      ? `${digits.slice(0, 2)}/${digits.slice(2)}`
      : `${digits.slice(0, 2)}/${digits.slice(2)}/`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeStoredDob(raw) {
  const s = String(raw || '').trim();
  if (!s || s.startsWith('0001')) return '';
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 8) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  return s;
}

function evaluateVisitorTiming(v, nowMs) {
  const cinMs = parseDtMs(v.checkin_time || v.CheckInTime) || nowMs;
  const coutMs = parseDtMs(v.checkout_time || v.CheckOutTime);
  const expMs = parseDtMs(v.expected_checkout_time || v.ExpectedCheckoutTime);
  const endMs = coutMs || nowMs;
  const elapsedMins = Math.max(0, Math.floor((endMs - cinMs) / 60000));
  const elapsedLabel = formatDurationVi(elapsedMins);

  let overdueAlert = Boolean(v.overdue_alert);
  let alertMessage = v.alert_message || '';
  let overdueMins = Number(v.overdue_minutes || 0);

  if (!coutMs && String(v.status || v.Status || 'ACTIVE').toUpperCase() === 'ACTIVE') {
    const outGateMs = parseDtMs(v.gate_last_out_time);
    const cardLabel = v.card_display_name || v.card_number || 'không gắn thẻ';
    const fname = v.full_name || 'Khách';

    if (v.expiry_alert_message) {
      overdueAlert = true;
      overdueMins = expMs ? Math.max(0, Math.floor((nowMs - expMs) / 60000)) : 0;
      alertMessage = v.expiry_alert_message;
    } else if (expMs && nowMs >= expMs) {
      overdueAlert = true;
      overdueMins = Math.max(0, Math.floor((nowMs - expMs) / 60000));
      if (outGateMs) {
        const outHhmm = new Date(outGateMs).toTimeString().slice(0, 5);
        alertMessage = `Thẻ ${cardLabel} khách ${fname} đã ra về lúc ${outHhmm} nhưng chưa check-out, kiểm tra lý do hoặc check-out. Lưu ý: Nếu kho không có thẻ đó nghĩa là có thể khách đã cầm về.`;
      } else {
        const expHhmm = new Date(expMs).toTimeString().slice(0, 5);
        alertMessage = `Khách ${fname} (Thẻ ${cardLabel}) đã đến hạn ${expHhmm} nhưng chưa check-out và chưa quẹt Làn RA — có thể vẫn đang ở trong công ty.`;
      }
    } else if (outGateMs && String(v.gate_last_scan_direction || '').toUpperCase() === 'OUT') {
      const minsSinceOut = Math.max(0, Math.floor((nowMs - outGateMs) / 60000));
      if (minsSinceOut >= 15) {
        overdueAlert = true;
        overdueMins = minsSinceOut;
        const hhmm = new Date(outGateMs).toTimeString().slice(0, 5);
        alertMessage = `Đã quét ${v.gate_last_out_device || 'cổng RA'} lúc ${hhmm} (${minsSinceOut} phút trước) chưa trả thẻ — Yêu cầu Check-out!`;
      }
    } else {
      const cinDateStr = new Date(cinMs).toISOString().slice(0, 10);
      const nowDateStr = new Date(nowMs).toISOString().slice(0, 10);
      if (cinDateStr < nowDateStr && elapsedMins >= 1) {
        overdueAlert = true;
        overdueMins = elapsedMins;
        alertMessage = alertMessage || 'Khách từ ngày trước chưa trả thẻ — Yêu cầu Check-out!';
      }
    }
  }

  return {
    elapsedMins,
    elapsedLabel,
    overdueAlert,
    overdueMins,
    alertMessage,
  };
}

function groupVisitorsByParent(rawList) {
  const normalized = (rawList || []).map((item) => ({
    ...item,
    id: item.id || item.VisitorCode || item.VisitorID,
    full_name: item.full_name || item.FullName || 'Khách',
    cccd_number: item.cccd_number || item.CCCDNumber || '',
    card_number: item.card_number || item.CardNumber || '',
    company: item.company || item.Company || '',
    department: item.department || item.HostDepartment || item.Department || '',
    host_person: item.host_person || item.HostPerson || '',
    checkin_time: item.checkin_time || item.CheckInTime || '',
    checkout_time: item.checkout_time || item.CheckOutTime || '',
    expected_checkout_time: item.expected_checkout_time || item.ExpectedCheckoutTime || '',
    purpose: item.purpose || item.Purpose || '',
    parent_visitor_id: item.parent_visitor_id || item.ParentVisitorID || '',
    parent_visitor_name: item.parent_visitor_name || item.ParentVisitorName || '',
  }));

  const byId = new Map();
  const byNameDate = new Map();
  const parentNodes = [];
  const childMap = new Map();

  for (const v of normalized) {
    if (v.id) byId.set(String(v.id), v);
    const cinDay = String(v.checkin_time || '').slice(0, 10);
    const fNameKey = `${foldVn(v.full_name)}|${cinDay}`;
    if (!byNameDate.has(fNameKey) && !v.parent_visitor_id && !String(v.purpose || '').startsWith('Đi cùng đoàn:')) {
      byNameDate.set(fNameKey, v);
    }
  }

  for (const v of normalized) {
    let resolvedParentId = v.parent_visitor_id ? String(v.parent_visitor_id) : '';
    if (!resolvedParentId) {
      const m = String(v.purpose || '').match(/^Đi cùng đoàn:\s*([^-\n]+)/i);
      if (m) {
        const pName = m[1].trim();
        const cinDay = String(v.checkin_time || '').slice(0, 10);
        const foundParent = byNameDate.get(`${foldVn(pName)}|${cinDay}`);
        if (foundParent && foundParent.id && String(foundParent.id) !== String(v.id)) {
          resolvedParentId = String(foundParent.id);
        }
      }
    }

    if (resolvedParentId && byId.has(resolvedParentId) && resolvedParentId !== String(v.id)) {
      if (!childMap.has(resolvedParentId)) childMap.set(resolvedParentId, []);
      childMap.get(resolvedParentId).push(v);
    } else {
      parentNodes.push(v);
    }
  }

  return parentNodes.map((p) => ({
    ...p,
    companions: childMap.get(String(p.id)) || [],
  }));
}

export default function VisitorManagementPage({
  departments,
  employees,
  activeVisitors,
  visitorHistory = [],
  customerCards,
  pendingAppointments = [],
  onRefreshData,
  notify,
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowTimeStr = new Date().toTimeString().slice(0, 5);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // DEFAULT CLOSED: Mặc định thu gọn thành nút "+ Đăng ký khách"
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [listTab, setListTab] = useState('ACTIVE'); // ACTIVE | HISTORY
  const [visitorSearch, setVisitorSearch] = useState('');
  const [onlyOverdueFilter, setOnlyOverdueFilter] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});

  const [frequentVisitors, setFrequentVisitors] = useState([]);
  const [focusedField, setFocusedField] = useState(null); // 'main_name' | 'main_cccd' | 'main_card' | 'comp_name' | 'comp_cccd' | 'comp_card' | 'quick_checkout' | null
  const [activeSuggestIdx, setActiveSuggestIdx] = useState(0);

  const mainQrInputRef = useRef(null);
  const compQrInputRef = useRef(null);
  const [showMainQrBox, setShowMainQrBox] = useState(false);
  const [showCompQrBox, setShowCompQrBox] = useState(false);
  const [mainQrRaw, setMainQrRaw] = useState('');
  const [compQrRaw, setCompQrRaw] = useState('');
  const [checkoutQuery, setCheckoutQuery] = useState('');
  const [releasingKey, setReleasingKey] = useState('');
  const [justReleasedInfo, setJustReleasedInfo] = useState({ card: '', holder: '' });
  const [submitting, setSubmitting] = useState(false);
  const [assignCardMap, setAssignCardMap] = useState({});
  const [assigningId, setAssigningId] = useState(null);
  const [swapRowId, setSwapRowId] = useState(null);
  const [swapCardInput, setSwapCardInput] = useState('');
  const [swapping, setSwapping] = useState(false);

  const handleAssignPendingCard = async (apt) => {
    const cardNo = String(assignCardMap[apt.id] || '').trim();
    if (!cardNo) {
      notify('Vui lòng đặt trỏ chuột và quẹt thẻ NFC để cấp cho khách.', 'error');
      return;
    }
    setAssigningId(apt.id);
    try {
      const { ok, data } = await apiFetch('/api/visitor/assign_card', {
        method: 'POST',
        body: JSON.stringify({ visitor_id: apt.id, card_number: cardNo }),
      });
      if (ok && data?.success) {
        notify(data.message || 'Đã cấp thẻ và kích hoạt cửa thành công!', 'success');
        setAssignCardMap((prev) => {
          const next = { ...prev };
          delete next[apt.id];
          return next;
        });
        if (onRefreshData) onRefreshData();
      } else {
        notify(data?.error || 'Không thể cấp thẻ.', 'error');
      }
    } finally {
      setAssigningId(null);
    }
  };

  const handleSwapVisitorCard = async (v) => {
    const newCard = String(swapCardInput || '').trim();
    if (!newCard) {
      notify('Vui lòng quẹt Mã thẻ mới để đổi.', 'error');
      return;
    }
    setSwapping(true);
    try {
      const { ok, data } = await apiFetch('/api/visitor/swap_card', {
        method: 'POST',
        body: JSON.stringify({
          visitor_id: v.id,
          old_card_number: v.card_number || '',
          new_card_number: newCard,
        }),
      });
      if (ok && data?.success) {
        notify(data.message || 'Đã đổi thẻ thành công!', 'success');
        setSwapRowId(null);
        setSwapCardInput('');
        if (onRefreshData) onRefreshData();
      } else {
        notify(data?.error || 'Không thể đổi thẻ.', 'error');
      }
    } finally {
      setSwapping(false);
    }
  };

  const [form, setForm] = useState({
    full_name: '',
    birth_date: '',
    from_date: todayStr,
    from_time: nowTimeStr,
    to_date: todayStr,
    to_time: '16:45',
    purpose: '',
    cccd_number: '',
    phone: '',
    company: '',
    access_area: 'Sảnh Chính (Cổng Làn Vào & Làn Ra)',
    notes: '',
    use_phone: false,
    department: 'BGĐ SeaZen',
    host_person: '',
    host_phone: '',
    card_number: '',
    auto_unlock: false,
  });

  const [compForm, setCompForm] = useState({
    full_name: '',
    birth_date: '',
    cccd_number: '',
    from_time: `${todayStr} ${nowTimeStr}`,
    to_time: `${todayStr} 16:45`,
    card_number: '',
  });

  const [companions, setCompanions] = useState([]);
  const [selectedCompIdx, setSelectedCompIdx] = useState([]);

  // Sync companion default time window when primary date/time edits while compForm is blank
  useEffect(() => {
    setCompForm((prev) => {
      if (prev.full_name || prev.cccd_number || prev.card_number) return prev;
      return {
        ...prev,
        from_time: `${form.from_date} ${form.from_time}`,
        to_time: `${form.to_date} ${form.to_time}`,
      };
    });
  }, [form.from_date, form.from_time, form.to_date, form.to_time]);

  const loadFrequentVisitors = useCallback(async () => {
    const { ok, data } = await apiFetch('/api/visitors/frequent');
    if (ok && data?.visitors) {
      setFrequentVisitors(data.visitors);
    }
  }, []);

  useEffect(() => {
    loadFrequentVisitors();
  }, [loadFrequentVisitors, visitorHistory.length, activeVisitors.length]);

  // Fast map of active cardholders by normalized CardNumber
  const activeCardHolderMap = useMemo(() => {
    const map = new Map();
    for (const v of activeVisitors) {
      const nc = normCard(v.card_number);
      if (nc) map.set(nc, v);
    }
    return map;
  }, [activeVisitors]);

  const findActiveCardHolder = useCallback(
    (cardVal) => {
      const nc = normCard(cardVal);
      if (!nc) return null;
      return activeCardHolderMap.get(nc) || null;
    },
    [activeCardHolderMap]
  );

  const findActiveCccdHolder = useCallback(
    (cccdVal) => {
      const clean = String(cccdVal || '').trim().toLowerCase();
      if (!clean || clean.length < 6) return null;
      return activeVisitors.find((v) => String(v.cccd_number || '').trim().toLowerCase() === clean) || null;
    },
    [activeVisitors]
  );

  const mainCardConflict = useMemo(() => findActiveCardHolder(form.card_number), [form.card_number, findActiveCardHolder]);
  const compCardConflict = useMemo(() => findActiveCardHolder(compForm.card_number), [compForm.card_number, findActiveCardHolder]);
  const mainCccdConflict = useMemo(() => findActiveCccdHolder(form.cccd_number), [form.cccd_number, findActiveCccdHolder]);

  const cardNameLookup = useMemo(() => {
    const map = {};
    (customerCards || []).forEach((c) => {
      const num = String(c.CardNumber || '').trim();
      const cname = String(c.CardName || '').trim();
      if (num && cname) {
        map[num] = cname;
        map[normCard(num)] = cname;
      }
    });
    return map;
  }, [customerCards]);

  const renderCardCell = (cardNumber, displayName, pillClass = 'badge badge-gold') => {
    const num = String(cardNumber || '').trim();
    if (!num) {
      return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Không thẻ</span>;
    }
    const resolvedName =
      (displayName && String(displayName).trim() !== num ? String(displayName).trim() : '') ||
      cardNameLookup[num] ||
      cardNameLookup[normCard(num)] ||
      '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
        {resolvedName && (
          <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111111', lineHeight: 1.2 }}>
            {resolvedName}
          </div>
        )}
        <span className={pillClass} style={{ fontFamily: 'var(--font-mono)', fontSize: resolvedName ? 11 : 12 }}>
          {num}
        </span>
      </div>
    );
  };

  // Image 2 Live Quick Return / Lookup Matches
  const quickCheckoutMatches = useMemo(() => {
    const q = String(checkoutQuery || '').trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    const qFold = foldVn(q);
    const qCardNorm = normCard(q);

    return activeVisitors
      .filter((v) => {
        const vCard = String(v.card_number || '').trim();
        const vCardNorm = normCard(vCard);
        const vCccd = String(v.cccd_number || '').trim().toLowerCase();
        const vId = String(v.id || '').trim().toLowerCase();
        const vNameFold = foldVn(v.full_name || '');
        if (vCardNorm && qCardNorm && (vCardNorm === qCardNorm || vCardNorm.includes(qCardNorm))) return true;
        if (vCccd && vCccd.includes(qLower)) return true;
        if (vId && vId === qLower) return true;
        if (qFold.length >= 2 && vNameFold.includes(qFold)) return true;
        return false;
      })
      .slice(0, 6);
  }, [checkoutQuery, activeVisitors]);

  // Inline Quick Check-out from Card Conflict Alert or Image 2 Lookup
  const handleQuickReleaseHolder = async (holderVisitor, targetField = 'main') => {
    if (!holderVisitor || releasingKey) return;
    const key = holderVisitor.id || holderVisitor.card_number || holderVisitor.cccd_number;
    const holderName = holderVisitor.full_name || holderVisitor.card_number;
    const cardReleased = holderVisitor.card_number || '';
    setReleasingKey(`${targetField}:${key}`);
    try {
      const { ok, data } = await apiFetch('/api/visitor/fast_checkout', {
        method: 'POST',
        body: JSON.stringify({ query: key }),
      });
      if (ok && data.success) {
        notify(
          `Đã thu hồi thẻ ${cardReleased || ''} và check-out cho ${holderName}. Sẵn sàng gán cho khách mới!`,
          'success'
        );
        setJustReleasedInfo({ card: normCard(cardReleased), holder: holderName });
        if (targetField === 'quick') setCheckoutQuery('');
        onRefreshData();
        setTimeout(() => {
          setJustReleasedInfo((prev) => (prev.card === normCard(cardReleased) ? { card: '', holder: '' } : prev));
        }, 5000);
      } else {
        notify(data.error || 'Không thể thu hồi thẻ cho khách này.', 'error');
      }
    } finally {
      setReleasingKey('');
    }
  };

  // Filtered Card Picker Options for Image 3 (shows available vs currently held cards cleanly)
  const getCardPickerOptions = useCallback(
    (cardInput) => {
      const q = normCard(cardInput);
      const qRaw = String(cardInput || '').trim().toLowerCase();
      const mapped = customerCards
        .filter((c) => !['LOST', 'LOCKED'].includes(String(c.Status || '').toUpperCase()))
        .map((c) => {
          const num = String(c.CardNumber || '').trim();
          const holder = findActiveCardHolder(num);
          return {
            cardNumber: num,
            cardName: c.CardName || '',
            cardCode: c.CardCode || num,
            cardType: c.CardType || 'VISITOR',
            holder,
          };
        });
      const filtered = !q && !qRaw
        ? mapped
        : mapped.filter(
            (item) =>
              normCard(item.cardNumber).includes(q) ||
              item.cardNumber.toLowerCase().includes(qRaw) ||
              item.cardName.toLowerCase().includes(qRaw) ||
              item.cardCode.toLowerCase().includes(qRaw) ||
              (item.holder && foldVn(item.holder.full_name).includes(foldVn(cardInput)))
          );
      // Sort available cards first unless typing an assigned card
      return filtered.sort((a, b) => Number(Boolean(a.holder)) - Number(Boolean(b.holder))).slice(0, 12);
    },
    [customerCards, findActiveCardHolder]
  );

  const mainCardOptions = useMemo(
    () => (focusedField === 'main_card' ? getCardPickerOptions(form.card_number) : []),
    [focusedField, form.card_number, getCardPickerOptions]
  );
  const compCardOptions = useMemo(
    () => (focusedField === 'comp_card' ? getCardPickerOptions(compForm.card_number) : []),
    [focusedField, compForm.card_number, getCardPickerOptions]
  );

  // Unified returning-guest pool for autocomplete
  const returningGuestsPool = useMemo(() => {
    const map = new Map();
    const cleanVal = (v) => {
      const s = String(v || '').trim();
      return ['0', '--', '---', 'None', 'null', 'NoDepartment'].includes(s) ? '' : s;
    };

    for (const item of frequentVisitors) {
      const fn = cleanVal(item.full_name);
      const cccd = cleanVal(item.cccd_number);
      if (!fn && !cccd) continue;
      const key = cccd ? cccd.toUpperCase() : foldVn(fn);
      map.set(key, {
        full_name: fn,
        cccd_number: cccd,
        birth_date: normalizeStoredDob(item.birth_date),
        phone: cleanVal(item.phone),
        company: cleanVal(item.company),
        department: cleanVal(item.department),
        host_person: cleanVal(item.host_person),
        host_phone: cleanVal(item.host_phone),
        visit_count: Number(item.visit_count || 1),
      });
    }

    for (const raw of [...visitorHistory, ...activeVisitors]) {
      const fn = cleanVal(raw.FullName || raw.full_name);
      const cccd = cleanVal(raw.CCCDNumber || raw.cccd_number);
      if (!fn && !cccd) continue;
      if (fn.startsWith('NV 000') || fn.startsWith('Khách thẻ')) continue;
      const key = cccd ? cccd.toUpperCase() : foldVn(fn);
      if (!map.has(key)) {
        map.set(key, {
          full_name: fn,
          cccd_number: cccd,
          birth_date: normalizeStoredDob(raw.BirthDate || raw.birth_date),
          phone: cleanVal(raw.Phone || raw.phone),
          company: cleanVal(raw.Company || raw.company),
          department: cleanVal(raw.HostDepartment || raw.Department || raw.department),
          host_person: cleanVal(raw.HostPerson || raw.host_person),
          host_phone: cleanVal(raw.host_phone),
          visit_count: 1,
        });
      }
    }

    return Array.from(map.values());
  }, [frequentVisitors, visitorHistory, activeVisitors]);

  const matchReturningGuests = useCallback(
    (query, mode = 'name') => {
      const qRaw = String(query || '').trim();
      if (!qRaw) return [];
      const qFold = foldVn(qRaw);
      if (mode === 'name' && qFold.length < 1) return [];
      if (mode === 'cccd' && qRaw.length < 2) return [];

      const scored = [];
      for (const g of returningGuestsPool) {
        if (mode === 'name') {
          if (!g.full_name) continue;
          const fnFold = foldVn(g.full_name);
          if (fnFold === qFold && g.cccd_number && g.cccd_number === form.cccd_number) continue;
          if (fnFold.startsWith(qFold)) scored.push({ g, score: 300 + g.visit_count });
          else if (fnFold.split(/\s+/).some((w) => w.startsWith(qFold))) scored.push({ g, score: 200 + g.visit_count });
          else if (fnFold.includes(qFold)) scored.push({ g, score: 100 + g.visit_count });
        } else {
          if (!g.cccd_number) continue;
          const cLower = g.cccd_number.toLowerCase();
          const qLower = qRaw.toLowerCase();
          if (cLower === qLower && g.full_name && g.full_name === form.full_name) continue;
          if (cLower.startsWith(qLower)) scored.push({ g, score: 300 + g.visit_count });
          else if (cLower.includes(qLower)) scored.push({ g, score: 150 + g.visit_count });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 6).map((s) => s.g);
    },
    [returningGuestsPool, form.cccd_number, form.full_name]
  );

  const mainNameSuggestions = useMemo(
    () => (focusedField === 'main_name' ? matchReturningGuests(form.full_name, 'name') : []),
    [focusedField, form.full_name, matchReturningGuests]
  );
  const mainCccdSuggestions = useMemo(
    () => (focusedField === 'main_cccd' ? matchReturningGuests(form.cccd_number, 'cccd') : []),
    [focusedField, form.cccd_number, matchReturningGuests]
  );
  const compNameSuggestions = useMemo(
    () => (focusedField === 'comp_name' ? matchReturningGuests(compForm.full_name, 'name') : []),
    [focusedField, compForm.full_name, matchReturningGuests]
  );
  const compCccdSuggestions = useMemo(
    () => (focusedField === 'comp_cccd' ? matchReturningGuests(compForm.cccd_number, 'cccd') : []),
    [focusedField, compForm.cccd_number, matchReturningGuests]
  );

  const applyGuestToMainForm = (guest) => {
    if (!guest) return;
    const validDept = departments.some((d) => d.DepartmentName === guest.department)
      ? guest.department
      : null;

    setForm((prev) => ({
      ...prev,
      full_name: guest.full_name || prev.full_name,
      cccd_number: guest.cccd_number || prev.cccd_number,
      birth_date: guest.birth_date || prev.birth_date,
      phone: guest.phone || prev.phone,
      company: guest.company || prev.company,
      department: validDept || prev.department,
      host_person: guest.host_person || prev.host_person,
      host_phone: guest.host_phone || prev.host_phone,
    }));
    setFocusedField(null);
    setActiveSuggestIdx(0);
  };

  const applyGuestToCompForm = (guest) => {
    if (!guest) return;
    setCompForm((prev) => ({
      ...prev,
      full_name: guest.full_name || prev.full_name,
      cccd_number: guest.cccd_number || prev.cccd_number,
      birth_date: guest.birth_date || prev.birth_date,
    }));
    setFocusedField(null);
    setActiveSuggestIdx(0);
  };

  const handleSuggestKeyDown = (e, list, onSelect) => {
    if (!list || list.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestIdx((i) => (i + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestIdx((i) => (i - 1 + list.length) % list.length);
    } else if (e.key === 'Enter') {
      const target = list[activeSuggestIdx] || list[0];
      if (target) {
        e.preventDefault();
        onSelect(target);
      }
    } else if (e.key === 'Escape') {
      setFocusedField(null);
    }
  };

  const deptEmployees = useMemo(() => {
    const targetDept = String(form.department || '').trim().toLowerCase();
    return (employees || []).filter((e) => {
      const dName = String(e.department || e.DepartmentName || '').trim().toLowerCase();
      return !targetDept || dName === targetDept;
    });
  }, [employees, form.department]);

  const filteredHostEmployees = useMemo(() => {
    const qRaw = String(form.host_person || '').trim().toLowerCase();
    const qFold = foldVn(qRaw);
    if (!qRaw) return deptEmployees.slice(0, 60);
    return deptEmployees
      .filter((emp) => {
        const name = String(emp.fullname || emp.FullName || '');
        const atid = String(emp.atid || emp.EmployeeATID || '');
        const hay = `${name} ${atid}`.toLowerCase();
        return hay.includes(qRaw) || foldVn(name).includes(qFold);
      })
      .slice(0, 60);
  }, [deptEmployees, form.host_person]);

  const parseQrForMain = async (raw) => {
    setMainQrRaw(raw);
    if (!raw.includes('|')) return;
    const { ok, data } = await apiFetch('/api/visitor/parse_cccd', {
      method: 'POST',
      body: JSON.stringify({ qr_string: raw }),
    });
    if (ok && data.success && data.data) {
      const p = data.data;
      setForm((prev) => ({
        ...prev,
        full_name: p.full_name || prev.full_name,
        cccd_number: p.cccd_number || prev.cccd_number,
        birth_date: normalizeStoredDob(p.birth_date) || prev.birth_date,
      }));
      setShowMainQrBox(false);
      setMainQrRaw('');
      notify(`Đã đọc QR căn cước: ${p.full_name} (${p.cccd_number})`, 'success');
    }
  };

  const parseQrForCompanion = async (raw) => {
    setCompQrRaw(raw);
    if (!raw.includes('|')) return;
    const { ok, data } = await apiFetch('/api/visitor/parse_cccd', {
      method: 'POST',
      body: JSON.stringify({ qr_string: raw }),
    });
    if (ok && data.success && data.data) {
      const p = data.data;
      setCompForm((prev) => ({
        ...prev,
        full_name: p.full_name || prev.full_name,
        cccd_number: p.cccd_number || prev.cccd_number,
        birth_date: normalizeStoredDob(p.birth_date) || prev.birth_date,
      }));
      setShowCompQrBox(false);
      setCompQrRaw('');
      notify(`Đã đọc QR người đi cùng: ${p.full_name}`, 'success');
    }
  };

  const handleAddCompanion = () => {
    const compMissing = [];
    if (!compForm.full_name.trim()) compMissing.push('Họ tên');
    if (!compForm.birth_date.trim()) compMissing.push('Ngày sinh');
    if (!compForm.cccd_number.trim()) compMissing.push('CCCD/Passport');
    if (compMissing.length > 0) {
      notify(`Nhân sự đi cùng còn thiếu: ${compMissing.join(', ')}.`, 'error');
      return;
    }
    if (compCardConflict) {
      notify(
        `Thẻ ${compForm.card_number} đang được giữ bởi ${compCardConflict.full_name}. Hãy bấm "Trả thẻ & Check-out nhanh" ngay bên dưới ô Mã thẻ trước.`,
        'error'
      );
      return;
    }
    if (
      compForm.card_number.trim() &&
      form.card_number.trim() &&
      normCard(compForm.card_number) === normCard(form.card_number)
    ) {
      notify('Mã thẻ của người đi cùng đang trùng với thẻ của khách chính.', 'error');
      return;
    }
    setCompanions((prev) => [...prev, { ...compForm }]);
    setCompForm({
      full_name: '',
      birth_date: '',
      cccd_number: '',
      from_time: `${form.from_date} ${form.from_time}`,
      to_time: `${form.to_date} ${form.to_time}`,
      card_number: '',
    });
  };

  const handleDeleteSelectedCompanions = () => {
    if (selectedCompIdx.length === 0) {
      setCompanions([]);
      return;
    }
    setCompanions((prev) => prev.filter((_, idx) => !selectedCompIdx.includes(idx)));
    setSelectedCompIdx([]);
  };

  const handleResetForm = () => {
    setForm({
      full_name: '',
      birth_date: '',
      from_date: todayStr,
      from_time: nowTimeStr,
      to_date: todayStr,
      to_time: '16:45',
      purpose: '',
      cccd_number: '',
      phone: '',
      company: '',
      access_area: 'Sảnh Chính (Cổng Làn Vào & Làn Ra)',
      notes: '',
      use_phone: false,
      department: 'BGĐ SeaZen',
      host_person: '',
      host_phone: '',
      card_number: '',
      auto_unlock: false,
    });
    setCompanions([]);
    setSelectedCompIdx([]);
    setFocusedField(null);
  };

  const handleSubmitRegistration = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const requiredFields = [
      ['full_name', 'Họ tên khách'],
      ['birth_date', 'Ngày tháng năm sinh'],
      ['from_date', 'Ngày bắt đầu'],
      ['from_time', 'Giờ bắt đầu'],
      ['to_date', 'Ngày kết thúc'],
      ['to_time', 'Giờ kết thúc'],
      ['purpose', 'Nội dung làm việc'],
      ['cccd_number', 'CMND/CCCD/Passport'],
      ['company', 'Tên công ty'],
      ['access_area', 'Khu vực được phép truy cập'],
      ['department', 'Phòng ban liên hệ'],
      ['host_person', 'Người liên hệ'],
      ['host_phone', 'Số điện thoại người liên hệ'],
      ['card_number', 'Mã thẻ'],
    ];
    const missing = requiredFields
      .filter(([key]) => !String(form[key] || '').trim())
      .map(([, label]) => label);

    if (missing.length > 0) {
      notify(`Vui lòng nhập đầy đủ các trường bắt buộc: ${missing.join(', ')}.`, 'error');
      return;
    }

    const fromDtStr = `${form.from_date} ${form.from_time}`;
    const toDtStr = `${form.to_date} ${form.to_time}`;
    if (toDtStr < fromDtStr) {
      notify('Thời gian kết thúc ("Đến thời gian") không được nhỏ hơn thời gian bắt đầu ("Từ thời gian").', 'error');
      return;
    }
    if (mainCardConflict) {
      notify(
        `Thẻ ${form.card_number} đang gắn cho ${mainCardConflict.full_name}. Hãy bấm "Trả thẻ & Check-out nhanh" ngay dưới ô Mã thẻ rồi lưu lại.`,
        'error'
      );
      return;
    }
    const typedNormCard = normCard(form.card_number);
    const blockedCard = typedNormCard
      ? customerCards.find(
          (c) =>
            normCard(c.CardNumber) === typedNormCard &&
            ['LOST', 'LOCKED'].includes(String(c.Status || '').toUpperCase())
        )
      : null;
    if (blockedCard) {
      notify(
        `Thẻ ${blockedCard.CardNumber} đang ở trạng thái ${blockedCard.Status}. Không thể cấp cho khách.`,
        'error'
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        expected_checkout_time: `${form.to_date} ${form.to_time}:00`,
        companions,
      };
      const { ok, data } = await apiFetch('/api/visitor/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (ok && data.success) {
        notify(data.message || 'Đã đăng ký khách thành công.', 'success');
        handleResetForm();
        setIsFormOpen(false);
        onRefreshData();
        loadFrequentVisitors();
      } else {
        notify(data.error || 'Không thể đăng ký khách.', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleFastCheckout = async (qVal) => {
    const q = qVal || checkoutQuery;
    if (!q) return;
    const { ok, data } = await apiFetch('/api/visitor/fast_checkout', {
      method: 'POST',
      body: JSON.stringify({ query: q }),
    });
    if (ok && data.success) {
      notify(data.message || 'Đã thu hồi thẻ và hoàn tất trả khách.', 'success');
      setCheckoutQuery('');
      onRefreshData();
    } else {
      notify(data.error || 'Không tìm thấy khách đang có mặt.', 'error');
    }
  };

  const handleGroupCheckout = async (parentVisitor) => {
    const { ok, data } = await apiFetch('/api/visitor/checkout_group', {
      method: 'POST',
      body: JSON.stringify({ query: parentVisitor.id }),
    });
    if (ok && data.success) {
      notify(data.message || `Đã trả thẻ & Check-out cả đoàn ${parentVisitor.full_name}.`, 'success');
      onRefreshData();
    } else {
      notify(data.error || 'Không thể check-out đoàn khách.', 'error');
    }
  };

  // Enrich & group active visitors and history visitors
  const groupedActiveVisitors = useMemo(() => {
    const enriched = activeVisitors.map((v) => ({
      ...v,
      _timing: evaluateVisitorTiming(v, nowMs),
    }));
    const groups = groupVisitorsByParent(enriched);
    const q = foldVn(visitorSearch);

    return groups
      .map((g) => ({
        ...g,
        _timing: g._timing || evaluateVisitorTiming(g, nowMs),
        companions: (g.companions || []).map((c) => ({
          ...c,
          _timing: c._timing || evaluateVisitorTiming(c, nowMs),
        })),
      }))
      .filter((g) => {
        const groupHasOverdue =
          g._timing.overdueAlert || g.companions.some((c) => c._timing?.overdueAlert);
        if (onlyOverdueFilter && !groupHasOverdue) return false;
        if (!q) return true;
        const mainMatch = foldVn(
          `${g.full_name} ${g.cccd_number} ${g.card_number} ${g.department} ${g.host_person} ${g.company}`
        ).includes(q);
        const compMatch = g.companions.some((c) =>
          foldVn(`${c.full_name} ${c.cccd_number} ${c.card_number}`).includes(q)
        );
        return mainMatch || compMatch;
      });
  }, [activeVisitors, visitorSearch, onlyOverdueFilter, nowMs]);

  const overdueActiveList = useMemo(
    () =>
      activeVisitors
        .map((v) => ({ ...v, _timing: evaluateVisitorTiming(v, nowMs) }))
        .filter((v) => v._timing.overdueAlert),
    [activeVisitors, nowMs]
  );

  const groupedHistoryVisitors = useMemo(() => {
    const groups = groupVisitorsByParent(visitorHistory);
    const q = foldVn(visitorSearch);
    if (!q) return groups;
    return groups.filter((g) => {
      const mainMatch = foldVn(
        `${g.full_name} ${g.cccd_number} ${g.card_number} ${g.department} ${g.host_person} ${g.company}`
      ).includes(q);
      const compMatch = (g.companions || []).some((c) =>
        foldVn(`${c.full_name} ${c.cccd_number} ${c.card_number}`).includes(q)
      );
      return mainMatch || compMatch;
    });
  }, [visitorHistory, visitorSearch]);

  const renderSuggestPopover = (list, onSelect) => {
    if (!list || list.length === 0) return null;
    return (
      <div className="guest-suggest-popover">
        <div className="guest-suggest-head">
          <span>Khách quen đã lưu</span>
          <span>Chọn để điền nhanh</span>
        </div>
        <div className="guest-suggest-list">
          {list.map((g, idx) => {
            const metaParts = [];
            if (g.cccd_number) metaParts.push(`CCCD: ${g.cccd_number}`);
            if (g.birth_date) metaParts.push(`NS: ${g.birth_date}`);
            if (g.company) metaParts.push(g.company);
            else if (g.department) metaParts.push(g.department);
            return (
              <div
                key={`${g.cccd_number || g.full_name}-${idx}`}
                className={`guest-suggest-item ${idx === activeSuggestIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveSuggestIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(g);
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="guest-suggest-name">{g.full_name || 'Khách'}</div>
                  <div className="guest-suggest-meta">
                    {metaParts.join(' · ') || 'Hồ sơ khách trước đây'}
                  </div>
                </div>
                <span className="guest-suggest-pill">
                  {g.visit_count > 1 ? `${g.visit_count} lần đến` : 'Khách quen'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCardPickerPopover = (options, onPick) => {
    if (!options || options.length === 0) return null;
    return (
      <div className="guest-suggest-popover" style={{ zIndex: 95 }}>
        <div className="guest-suggest-head">
          <span>Chọn từ Kho Thẻ Khách ({options.length})</span>
          <span>Trống / Đang giữ</span>
        </div>
        <div className="guest-suggest-list">
          {options.map((opt) => (
            <div
              key={opt.cardNumber}
              className="guest-suggest-item"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(opt.cardNumber);
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="guest-suggest-name" style={{ fontFamily: 'var(--font-mono)' }}>
                  {opt.cardName && (
                    <span style={{ fontFamily: 'inherit', fontWeight: 800, marginRight: 6 }}>
                      {opt.cardName} ·
                    </span>
                  )}
                  {opt.cardNumber}
                  {opt.cardCode && opt.cardCode !== opt.cardNumber && (
                    <span style={{ fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>
                      ({opt.cardCode})
                    </span>
                  )}
                </div>
                {opt.holder && (
                  <div className="guest-suggest-meta" style={{ color: '#b45309' }}>
                    Đang giữ: {opt.holder.full_name} (vào {formatDateTimeCompact(opt.holder.checkin_time, nowMs)})
                  </div>
                )}
              </div>
              <span
                className="guest-suggest-pill"
                style={
                  opt.holder
                    ? { background: '#fef3c7', color: '#b45309' }
                    : { background: '#ecfdf5', color: '#15803d' }
                }
              >
                {opt.holder ? 'Đang giữ' : 'Khả dụng'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCardConflictBox = (cardVal, conflictHolder, targetField) => {
    const nc = normCard(cardVal);
    if (!nc) return null;
    if (conflictHolder) {
      const timing = evaluateVisitorTiming(conflictHolder, nowMs);
      const isReleasing = releasingKey === `${targetField}:${conflictHolder.id || conflictHolder.card_number}`;
      return (
        <div className="card-holder-inline">
          <div style={{ minWidth: 0, flex: '1 1 170px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#9a3412' }}>
              Đang giữ bởi: {conflictHolder.full_name}
            </div>
            <div style={{ fontSize: 11, color: '#b45309' }}>
              Vào lúc {formatDateTimeCompact(conflictHolder.checkin_time, nowMs)} · Đã ở {timing.elapsedLabel}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={isReleasing}
            style={{
              background: '#111111',
              color: '#ffffff',
              borderColor: '#111111',
              height: 28,
              fontSize: 11.5,
              whiteSpace: 'nowrap',
            }}
            onClick={() => handleQuickReleaseHolder(conflictHolder, targetField)}
          >
            {isReleasing ? 'Đang trả thẻ...' : 'Trả thẻ & Check-out nhanh'}
          </button>
        </div>
      );
    }
    if (justReleasedInfo.card && justReleasedInfo.card === nc) {
      return (
        <div className="card-holder-inline ready" style={{ fontSize: 11.5, fontWeight: 600 }}>
          <span>Đã thu hồi thẻ từ {justReleasedInfo.holder} — Thẻ sẵn sàng gán cho khách mới.</span>
        </div>
      );
    }
    const knownCard = customerCards.find((c) => normCard(c.CardNumber) === nc);
    if (knownCard && ['LOST', 'LOCKED'].includes(String(knownCard.Status || '').toUpperCase())) {
      const label = String(knownCard.Status).toUpperCase() === 'LOST' ? 'ĐÃ BÁO MẤT' : 'ĐANG KHÓA / HỎNG';
      return (
        <div
          className="card-holder-inline"
          style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c', fontSize: 11.5, fontWeight: 600 }}
        >
          <span>Thẻ {knownCard.CardNumber} ({knownCard.CardCode}) đang ở trạng thái {label} — Không thể cấp phát.</span>
        </div>
      );
    }
    if (!knownCard && nc.length >= 4) {
      return (
        <div
          className="card-holder-inline ready"
          style={{
            background: '#fffbeb',
            borderColor: '#fde68a',
            color: '#92400e',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <span>Thẻ mới chưa có trong Kho thẻ — Hệ thống sẽ tự thêm mới và báo Admin bổ sung ảnh bằng chứng khi lưu.</span>
        </div>
      );
    }
    return null;
  };

  const toggleGroupExpand = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className="tino-body">
      <div className="tino-center">
        {/* THANH TIÊU ĐỀ + Ô QUẸT THẺ TRẢ NHANH CÓ HIỂN THỊ NGƯỜI ĐANG GIỮ + NÚT ĐĂNG KÝ KHÁCH */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="tino-greeting-sub" style={{ fontSize: 13 }}>
              Quản lý Khách Ra vào · Theo dõi Thời gian lưu trú &amp; Cảnh báo trả thẻ &gt; 15 phút
            </div>
            <h1 className="tino-greeting-title" style={{ fontSize: 22 }}>
              Danh sách Khách &amp; Đăng ký Ra vào ({activeVisitors.length} khách đang có mặt)
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* IMAGE 2: Live Cardholder Lookup + Quick Check-out Box */}
            <div className="quick-checkout-wrap">
              <input
                type="text"
                className="v-input"
                style={{ width: 255 }}
                value={checkoutQuery}
                onFocus={() => setFocusedField('quick_checkout')}
                onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'quick_checkout' ? null : f)), 180)}
                onChange={(e) => {
                  setCheckoutQuery(e.target.value);
                  setFocusedField('quick_checkout');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && checkoutQuery.trim()) {
                    e.preventDefault();
                    const topMatch = quickCheckoutMatches[0];
                    if (topMatch && quickCheckoutMatches.length === 1) {
                      handleQuickReleaseHolder(topMatch, 'quick');
                    } else {
                      handleFastCheckout();
                    }
                  }
                }}
                placeholder="Quẹt thẻ trả lại hoặc quét CCCD..."
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (quickCheckoutMatches.length === 1) {
                    handleQuickReleaseHolder(quickCheckoutMatches[0], 'quick');
                  } else {
                    handleFastCheckout();
                  }
                }}
              >
                Trả thẻ &amp; Check-out
              </button>

              {/* Inline preview directly below Image 2 showing exact holder */}
              {checkoutQuery.trim() && (
                <div className="quick-checkout-popover">
                  {quickCheckoutMatches.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 4px' }}>
                      Không có khách đang giữ thẻ hoặc CCCD khớp với &quot;{checkoutQuery.trim()}&quot;.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        Người đang giữ thẻ / hồ sơ ({quickCheckoutMatches.length})
                      </div>
                      {quickCheckoutMatches.map((m) => {
                        const t = evaluateVisitorTiming(m, nowMs);
                        return (
                          <div
                            key={m.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                              padding: '7px 9px',
                              borderRadius: 8,
                              background: t.overdueAlert ? '#fef2f2' : '#f8fafc',
                              border: `1px solid ${t.overdueAlert ? '#fecaca' : '#e5e7eb'}`,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--jet)' }}>
                                {m.full_name}
                                {m.card_number && (
                                  <span className="badge badge-gold" style={{ marginLeft: 6, fontSize: 10.5 }}>
                                    Thẻ {m.card_number}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                                Vào {formatDateTimeCompact(m.checkin_time, nowMs)} · Ở {t.elapsedLabel}
                                {m.cccd_number ? ` · CCCD ${m.cccd_number}` : ''}
                                {m.parent_visitor_name ? ` · Đoàn ${m.parent_visitor_name}` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              style={{ flexShrink: 0 }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleQuickReleaseHolder(m, 'quick');
                              }}
                            >
                              Check-out ngay
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!isFormOpen ? (
              <button
                type="button"
                className="btn btn-gold"
                style={{ padding: '0 20px', height: 38, fontWeight: 700 }}
                onClick={() => setIsFormOpen(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Đăng ký khách</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '0 18px', height: 38 }}
                onClick={() => setIsFormOpen(false)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
                <span>Thu gọn phiếu đăng ký</span>
              </button>
            )}
          </div>
        </div>

        {/* CẢNH BÁO TỔNG HỢP KHÁCH QUÁ 15 PHÚT CHƯA TRẢ THẺ & CHECK-OUT */}
        {overdueActiveList.length > 0 && (
          <div className="visitor-alert-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 320px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2.3" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div style={{ fontSize: 12.5, color: '#7c2d12' }}>
                <strong>
                  Cảnh báo: {overdueActiveList.length} khách đã ra cổng hoặc quá giờ dự kiến &gt; 15 phút nhưng chưa thu hồi thẻ &amp; Check-out:
                </strong>{' '}
                {overdueActiveList
                  .slice(0, 3)
                  .map((v) => `${v.full_name} (Thẻ ${v.card_number || '—'})`)
                  .join(', ')}
                {overdueActiveList.length > 3 ? ` và ${overdueActiveList.length - 3} khách khác` : ''}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: onlyOverdueFilter ? '#111111' : '#ffffff',
                color: onlyOverdueFilter ? '#ffffff' : '#9a3412',
                borderColor: '#fdba74',
              }}
              onClick={() => {
                setListTab('ACTIVE');
                setOnlyOverdueFilter((v) => !v);
              }}
            >
              {onlyOverdueFilter ? 'Hiện tất cả khách' : `Lọc khách cần Check-out (${overdueActiveList.length})`}
            </button>
          </div>
        )}

        {/* PHIẾU ĐĂNG KÝ LÀM VIỆC TRONG NHÀ MÁY / TÒA NHÀ */}
        {isFormOpen && (
          <form
            onSubmit={handleSubmitRegistration}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target?.tagName === 'INPUT') {
                e.preventDefault();
              }
            }}
            noValidate
            className="visitor-sheet"
            style={{
              marginBottom: 0,
              flex: 1,
              overflowY: 'auto',
            }}
          >
            <div className="visitor-sheet-header">
              <div className="visitor-sheet-title">Phiếu đăng ký làm việc trong nhà máy / tòa nhà</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn-qr-navy"
                  onClick={() => {
                    setShowMainQrBox((v) => !v);
                    setTimeout(() => mainQrInputRef.current?.focus(), 60);
                  }}
                >
                  Đọc thông tin từ QR căn cước
                </button>
                <button
                  type="submit"
                  className="btn btn-gold"
                  style={{ height: 34, padding: '0 18px', fontWeight: 700, opacity: submitting ? 0.7 : 1 }}
                  disabled={submitting}
                >
                  {submitting ? 'Đang lưu...' : 'Đồng ý lưu & Nạp thẻ'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setIsFormOpen(false)}
                >
                  Thu gọn phiếu
                </button>
              </div>
            </div>

            {showMainQrBox && (
              <div
                style={{
                  background: 'var(--gold-soft)',
                  border: '1px solid var(--gold)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <input
                  ref={mainQrInputRef}
                  type="text"
                  className="v-input"
                  value={mainQrRaw}
                  onChange={(e) => parseQrForMain(e.target.value)}
                  placeholder="Đặt con trỏ tại đây và bấm súng quét mã QR trên căn cước công dân..."
                />
                <button type="button" className="btn btn-sm" onClick={() => setShowMainQrBox(false)}>
                  Đóng
                </button>
              </div>
            )}

            {/* 3-COLUMN PRIMARY VISITOR GRID */}
            <div className="visitor-3col-grid">
              {/* CỘT 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Họ tên khách
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    autoComplete="off"
                    placeholder="Gõ tên khách (tự động gợi ý nếu khách quen)..."
                    value={form.full_name}
                    onFocus={() => {
                      setFocusedField('main_name');
                      setActiveSuggestIdx(0);
                    }}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'main_name' ? null : f)), 140)}
                    onChange={(e) => {
                      setForm({ ...form, full_name: e.target.value });
                      setFocusedField('main_name');
                      setActiveSuggestIdx(0);
                    }}
                    onKeyDown={(e) => handleSuggestKeyDown(e, mainNameSuggestions, applyGuestToMainForm)}
                    required
                  />
                  {renderSuggestPopover(mainNameSuggestions, applyGuestToMainForm)}
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Ngày tháng năm sinh
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    className="v-input"
                    placeholder="dd/MM/yyyy (gõ nhanh VD: 10072004)"
                    value={form.birth_date}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        birth_date: formatDobSmart(e.target.value, prev.birth_date),
                      }))
                    }
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Từ thời gian
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
                    <input
                      type="date"
                      className="v-input"
                      value={form.from_date}
                      onChange={(e) => setForm({ ...form, from_date: e.target.value })}
                    />
                    <input
                      type="time"
                      className="v-input"
                      value={form.from_time}
                      onChange={(e) => setForm({ ...form, from_time: e.target.value })}
                    />
                  </div>
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Đến thời gian
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
                    <input
                      type="date"
                      className="v-input"
                      value={form.to_date}
                      onChange={(e) => setForm({ ...form, to_date: e.target.value })}
                    />
                    <input
                      type="time"
                      className="v-input"
                      value={form.to_time}
                      onChange={(e) => setForm({ ...form, to_time: e.target.value })}
                    />
                  </div>
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Nội dung làm việc
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="VD: Họp đối tác, bảo trì hệ thống..."
                    value={form.purpose}
                    onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  />
                </div>
              </div>

              {/* CỘT 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>CMND/CCCD/Passport
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    autoComplete="off"
                    placeholder="Gõ số CCCD/Passport (tự động gợi ý khách quen)..."
                    value={form.cccd_number}
                    onFocus={() => {
                      setFocusedField('main_cccd');
                      setActiveSuggestIdx(0);
                    }}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'main_cccd' ? null : f)), 140)}
                    onChange={(e) => {
                      setForm({ ...form, cccd_number: e.target.value });
                      setFocusedField('main_cccd');
                      setActiveSuggestIdx(0);
                    }}
                    onKeyDown={(e) => handleSuggestKeyDown(e, mainCccdSuggestions, applyGuestToMainForm)}
                    required
                  />
                  {renderSuggestPopover(mainCccdSuggestions, applyGuestToMainForm)}
                  {mainCccdConflict && (
                    <div className="card-holder-inline">
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#9a3412' }}>
                        CCCD đang có mặt: {mainCccdConflict.full_name} (Thẻ {mainCccdConflict.card_number || '—'})
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#111111', color: '#fff', borderColor: '#111111', height: 26, fontSize: 11 }}
                        onClick={() => handleQuickReleaseHolder(mainCccdConflict, 'main_cccd')}
                      >
                        Check-out lượt cũ
                      </button>
                    </div>
                  )}
                </div>

                <div className="v-field">
                  <label>Số điện thoại</label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Tên công ty
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Khu vực được phép truy cập
                  </label>
                  <select
                    className="v-input"
                    value={form.access_area}
                    onChange={(e) => setForm({ ...form, access_area: e.target.value })}
                  >
                    <option value="Sảnh Chính (Cổng Làn Vào & Làn Ra)">Sảnh Chính (Cổng Làn Vào & Làn Ra)</option>
                    <option value="Khu vực Văn phòng & Phòng họp">Khu vực Văn phòng &amp; Phòng họp</option>
                    <option value="Khu vực Kỹ thuật & Nhà máy">Khu vực Kỹ thuật &amp; Nhà máy</option>
                    <option value="Toàn bộ các cửa kiểm soát">Toàn bộ các cửa kiểm soát</option>
                  </select>
                </div>

                <div className="v-field">
                  <label>Ghi chú</label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Sử dụng điện thoại</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.use_phone}
                      onChange={(e) => setForm({ ...form, use_phone: e.target.checked })}
                    />
                    <span>Có</span>
                  </label>
                </div>
              </div>

              {/* CỘT 3 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Phòng ban liên hệ
                  </label>
                  <select
                    className="v-input"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  >
                    {departments.map((d) => (
                      <option key={d.DepartmentID || d.id} value={d.DepartmentName || d.name}>
                        {d.DepartmentName || d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="v-field" style={{ position: 'relative' }}>
                  <label>
                    <span className="req">*</span>Người liên hệ ({deptEmployees.length} thuộc {form.department || 'Tất cả'})
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    className="v-input"
                    placeholder="Gõ không dấu hoặc chọn nhanh người liên hệ..."
                    value={form.host_person}
                    onFocus={() => setFocusedField('host_person')}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'host_person' ? null : f)), 160)}
                    onChange={(e) => {
                      const val = e.target.value;
                      const found = deptEmployees.find((emp) => (emp.fullname || emp.FullName) === val);
                      setForm({
                        ...form,
                        host_person: val,
                        host_phone: found?.phone || found?.Phone || form.host_phone,
                      });
                      setFocusedField('host_person');
                    }}
                  />
                  {focusedField === 'host_person' && (
                    <div className="guest-suggest-popover" style={{ maxHeight: 240, overflowY: 'auto' }}>
                      <div className="guest-suggest-header">
                        <span>
                          NHÂN SỰ PHÒNG {String(form.department || 'TẤT CẢ').toUpperCase()} ({filteredHostEmployees.length})
                        </span>
                      </div>
                      {filteredHostEmployees.length === 0 ? (
                        <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                          Không tìm thấy nhân sự khớp "{form.host_person}" trong phòng {form.department}.
                        </div>
                      ) : (
                        filteredHostEmployees.map((emp, idx) => {
                          const empName = emp.fullname || emp.FullName || '';
                          const empDept = emp.department || emp.DepartmentName || '';
                          const empPhone = emp.phone || emp.Phone || '';
                          return (
                            <div
                              key={emp.atid || emp.EmployeeATID || idx}
                              className="guest-suggest-item"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setForm((prev) => ({
                                  ...prev,
                                  host_person: empName,
                                  host_phone: empPhone || prev.host_phone,
                                }));
                                setFocusedField(null);
                              }}
                            >
                              <div>
                                <div className="guest-suggest-name">{empName}</div>
                                <div className="guest-suggest-meta">
                                  {empDept}
                                  {empPhone ? ` · ${empPhone}` : ''}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Số điện thoại người liên hệ
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    value={form.host_phone}
                    onChange={(e) => setForm({ ...form, host_phone: e.target.value })}
                  />
                </div>

                {/* IMAGE 3: * Mã thẻ + Live Conflict Holder + Instant Check-out Button */}
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Mã thẻ
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    className="v-input"
                    style={mainCardConflict ? { borderColor: '#ea580c', background: '#fffbeb' } : {}}
                    placeholder="Quẹt thẻ NFC lên đầu đọc hoặc chọn thẻ..."
                    value={form.card_number}
                    onFocus={() => setFocusedField('main_card')}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'main_card' ? null : f)), 160)}
                    onChange={(e) => {
                      setForm({ ...form, card_number: e.target.value });
                      setFocusedField('main_card');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        setFocusedField(null);
                      }
                    }}
                  />
                  {renderCardPickerPopover(mainCardOptions, (num) => {
                    setForm((prev) => ({ ...prev, card_number: num }));
                    setFocusedField(null);
                  })}
                  {renderCardConflictBox(form.card_number, mainCardConflict, 'main')}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={form.auto_unlock}
                      onChange={(e) => setForm({ ...form, auto_unlock: e.target.checked })}
                    />
                    <span>Mở cổng Làn VÀO ngay khi lưu</span>
                  </label>
                </div>
              </div>
            </div>

            {/* PHẦN DƯỚI: THÔNG TIN NHÂN SỰ ĐI CÙNG */}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                    Thông tin nhân sự đi cùng ({companions.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedCompanions}
                    title="Xóa danh sách người đi cùng đã chọn"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 12,
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    <span>Xóa đã chọn</span>
                  </button>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Để trống Mã thẻ nếu người đi cùng dùng chung lối vào với trưởng đoàn
                </span>
              </div>

              {showCompQrBox && (
                <div
                  style={{
                    background: 'var(--gold-soft)',
                    border: '1px solid var(--gold)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    marginBottom: 12,
                    display: 'flex',
                    gap: 10,
                  }}
                >
                  <input
                    ref={compQrInputRef}
                    type="text"
                    className="v-input"
                    value={compQrRaw}
                    onChange={(e) => parseQrForCompanion(e.target.value)}
                    placeholder="Bấm súng quét mã QR CCCD của nhân sự đi cùng..."
                  />
                  <button type="button" className="btn btn-sm" onClick={() => setShowCompQrBox(false)}>
                    Đóng
                  </button>
                </div>
              )}

              <div className="companion-bar">
                <div className="v-field">
                  <label>
                    <span className="req">*</span>Họ tên
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    autoComplete="off"
                    value={compForm.full_name}
                    onFocus={() => {
                      setFocusedField('comp_name');
                      setActiveSuggestIdx(0);
                    }}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'comp_name' ? null : f)), 140)}
                    onChange={(e) => {
                      setCompForm({ ...compForm, full_name: e.target.value });
                      setFocusedField('comp_name');
                      setActiveSuggestIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (compNameSuggestions.length > 0) {
                        handleSuggestKeyDown(e, compNameSuggestions, applyGuestToCompForm);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCompanion();
                      }
                    }}
                  />
                  {renderSuggestPopover(compNameSuggestions, applyGuestToCompForm)}
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>Ngày sinh
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    className="v-input"
                    placeholder="dd/MM/yyyy"
                    value={compForm.birth_date}
                    onChange={(e) =>
                      setCompForm((prev) => ({
                        ...prev,
                        birth_date: formatDobSmart(e.target.value, prev.birth_date),
                      }))
                    }
                  />
                </div>

                <div className="v-field">
                  <label>
                    <span className="req">*</span>CCCD/ Passport
                  </label>
                  <input
                    type="text"
                    className="v-input"
                    autoComplete="off"
                    value={compForm.cccd_number}
                    onFocus={() => {
                      setFocusedField('comp_cccd');
                      setActiveSuggestIdx(0);
                    }}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'comp_cccd' ? null : f)), 140)}
                    onChange={(e) => {
                      setCompForm({ ...compForm, cccd_number: e.target.value });
                      setFocusedField('comp_cccd');
                      setActiveSuggestIdx(0);
                    }}
                    onKeyDown={(e) => handleSuggestKeyDown(e, compCccdSuggestions, applyGuestToCompForm)}
                  />
                  {renderSuggestPopover(compCccdSuggestions, applyGuestToCompForm)}
                </div>

                <div className="v-field">
                  <label>Từ thời gian</label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="YYYY-MM-DD HH:mm"
                    value={compForm.from_time}
                    onChange={(e) => setCompForm({ ...compForm, from_time: e.target.value })}
                  />
                </div>

                <div className="v-field">
                  <label>Đến thời gian</label>
                  <input
                    type="text"
                    className="v-input"
                    placeholder="YYYY-MM-DD HH:mm"
                    value={compForm.to_time}
                    onChange={(e) => setCompForm({ ...compForm, to_time: e.target.value })}
                  />
                </div>

                {/* Companion * Mã thẻ with instant conflict holder & quick checkout */}
                <div className="v-field">
                  <label>Mã thẻ NFC</label>
                  <input
                    type="text"
                    autoComplete="off"
                    className="v-input"
                    style={compCardConflict ? { borderColor: '#ea580c', background: '#fffbeb' } : {}}
                    placeholder="Quẹt thẻ..."
                    value={compForm.card_number}
                    onFocus={() => setFocusedField('comp_card')}
                    onBlur={() => setTimeout(() => setFocusedField((f) => (f === 'comp_card' ? null : f)), 160)}
                    onChange={(e) => {
                      setCompForm({ ...compForm, card_number: e.target.value });
                      setFocusedField('comp_card');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCompanion();
                      }
                    }}
                  />
                  {renderCardPickerPopover(compCardOptions, (num) => {
                    setCompForm((prev) => ({ ...prev, card_number: num }));
                    setFocusedField(null);
                  })}
                  {renderCardConflictBox(compForm.card_number, compCardConflict, 'comp')}
                </div>

                <div style={{ paddingTop: 21 }}>
                  <button
                    type="button"
                    className="btn-qr-navy"
                    style={{ height: 36 }}
                    onClick={() => {
                      setShowCompQrBox((v) => !v);
                      setTimeout(() => compQrInputRef.current?.focus(), 60);
                    }}
                  >
                    Quét QR CCCD
                  </button>
                </div>

                <div style={{ paddingTop: 21 }}>
                  <button
                    type="button"
                    className="btn-qr-navy"
                    style={{ height: 36 }}
                    onClick={handleAddCompanion}
                  >
                    + Thêm nhanh
                  </button>
                </div>
              </div>

              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          checked={companions.length > 0 && selectedCompIdx.length === companions.length}
                          onChange={(e) =>
                            setSelectedCompIdx(e.target.checked ? companions.map((_, i) => i) : [])
                          }
                        />
                      </th>
                      <th style={{ width: 44 }}>#</th>
                      <th>Họ tên</th>
                      <th>Ngày sinh</th>
                      <th>CCCD/ Passport</th>
                      <th>Từ thời gian</th>
                      <th>Đến thời gian</th>
                      <th>Mã thẻ</th>
                      <th style={{ textAlign: 'right' }}>Xóa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companions.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>
                          Chưa có nhân sự đi cùng — Nhập tên / quét QR ở hàng trên và bấm &quot;+ Thêm nhanh&quot;
                        </td>
                      </tr>
                    ) : (
                      companions.map((c, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedCompIdx.includes(idx)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedCompIdx((prev) => [...prev, idx]);
                                else setSelectedCompIdx((prev) => prev.filter((i) => i !== idx));
                              }}
                            />
                          </td>
                          <td>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{c.full_name}</td>
                          <td>{c.birth_date || '—'}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.cccd_number || '—'}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.from_time}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.to_time}</td>
                          <td>
                            {c.card_number ? (
                              <span className="badge badge-gold">{c.card_number}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Đi cùng đoàn</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setCompanions((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              Xóa
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    handleResetForm();
                    setIsFormOpen(false);
                  }}
                >
                  Hủy bỏ &amp; Thu gọn
                </button>
                <button
                  type="submit"
                  className="btn-qr-navy"
                  style={{ padding: '0 26px', height: 36, opacity: submitting ? 0.7 : 1 }}
                  disabled={submitting}
                >
                  {submitting ? 'Đang lưu & nạp thẻ...' : 'Đồng ý lưu & Nạp thẻ'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* DANH SÁCH KHÁCH (GỌN GÀNG, HIỂN THỊ GIỜ VÀO/RA, THỜI LƯỢNG Ở, CẢNH BÁO >15P & NÚT "v" XEM NGƯỜI ĐI CÙNG) */}
        {!isFormOpen && (
          <div className="card card-table-fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card-header" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-sm ${listTab === 'ACTIVE' ? 'btn-primary' : ''}`}
                onClick={() => setListTab('ACTIVE')}
              >
                Đang làm việc ({activeVisitors.length}) &amp; Chờ cấp thẻ ({pendingAppointments.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${listTab === 'HISTORY' ? 'btn-primary' : ''}`}
                onClick={() => setListTab('HISTORY')}
              >
                Lịch sử Khách đã đăng ký ({visitorHistory.length})
              </button>

              <div className="tino-search-bar" style={{ marginTop: 0, padding: '6px 12px', width: 290 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  placeholder="Tìm họ tên khách, người đi cùng, CCCD, thẻ..."
                  value={visitorSearch}
                  onChange={(e) => setVisitorSearch(e.target.value)}
                />
              </div>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Cảnh báo tự động khi khách qua cổng RA / quá giờ dự kiến &gt; 15 phút mà chưa trả thẻ
            </span>
          </div>

          {listTab === 'ACTIVE' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* NỬA TRÊN: KHÁCH ĐANG LÀM VIỆC */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '2px solid #e2e8f0' }}>
                <div
                  style={{
                    padding: '7px 16px',
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                      Khách đang làm việc
                    </span>
                    <span className="badge badge-info">{activeVisitors.length}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Khách đang giữ thẻ ra vào trong tòa nhà
                  </span>
                </div>
                <div className="table-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <table className="data-table" key="table-active">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
                      <tr>
                        <th style={{ width: 62 }}>#</th>
                        <th>Khách hàng &amp; Định danh</th>
                        <th>Thẻ NFC</th>
                        <th>Phòng ban / Người liên hệ</th>
                    <th>Giờ vào / Ra cổng</th>
                    <th>Ở trong CTy / Cảnh báo</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedActiveVisitors.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        {onlyOverdueFilter
                          ? 'Không có khách nào quá hạn 15 phút chưa trả thẻ.'
                          : 'Hiện không có khách nào đang giữ thẻ trong tòa nhà. Bấm "+ Đăng ký khách" ở góc trên để thêm mới.'}
                      </td>
                    </tr>
                  ) : (
                    groupedActiveVisitors.map((v, idx) => {
                      const hasCompanions = v.companions && v.companions.length > 0;
                      const isExpanded = Boolean(expandedGroups[`act_${v.id}`]);
                      const t = v._timing;
                      const anyGroupOverdue =
                        t.overdueAlert || (hasCompanions && v.companions.some((c) => c._timing?.overdueAlert));

                      return (
                        <React.Fragment key={`act_${v.id || idx}_${idx}`}>
                          <tr className={anyGroupOverdue ? 'visitor-row-overdue' : ''}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {hasCompanions ? (
                                  <button
                                    type="button"
                                    className={`visitor-expand-btn ${isExpanded ? 'open' : ''}`}
                                    onClick={() => toggleGroupExpand(`act_${v.id}`)}
                                    title={`Xem ${v.companions.length} nhân sự đi cùng`}
                                    aria-label="Mở rộng nhân sự đi cùng"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                ) : null}
                                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}</span>
                              </div>
                            </td>

                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--jet)' }}>
                                  {v.full_name}
                                </span>
                                {hasCompanions && (
                                  <span
                                    className="badge"
                                    style={{ background: '#e0f2fe', color: '#0369a1', fontSize: 11, cursor: 'pointer' }}
                                    onClick={() => toggleGroupExpand(`act_${v.id}`)}
                                  >
                                    +{v.companions.length} đi cùng
                                  </span>
                                )}
                                {v.parent_visitor_name && (
                                  <span className="badge" style={{ background: '#f3f4f6', color: '#4b5563', fontSize: 10.5 }}>
                                    Đoàn: {v.parent_visitor_name}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                                {v.cccd_number ? `CCCD: ${v.cccd_number}` : `ID: ${v.id}`}
                                {v.company && v.company !== 'Khách Đến Tòa Nhà' && v.company !== '0'
                                  ? ` · ${v.company}`
                                  : ''}
                              </div>
                            </td>

                            <td>
                              {renderCardCell(v.card_number, v.card_display_name, 'badge badge-gold')}
                              {(v.in_scan_count > 0 || v.out_scan_count > 0) && (
                                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                                  Quẹt cổng: {v.in_scan_count} vào · {v.out_scan_count} ra
                                </div>
                              )}
                            </td>

                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--jet)', fontSize: 12.5 }}>
                                {v.department || 'Khách Vãng Lai'}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                                {v.host_person && v.host_person !== '--' ? `Gặp: ${v.host_person}` : 'Chưa gắn người đón'}
                              </div>
                            </td>

                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                              <div>
                                <span style={{ color: '#15803d', fontWeight: 700 }}>Vào: </span>
                                {formatDateTimeCompact(v.checkin_time, nowMs)}
                                {v.gate_first_in_time && v.gate_first_in_time !== v.checkin_time && (
                                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                    {' '}
                                    (cổng {formatDateTimeCompact(v.gate_first_in_time, nowMs)})
                                  </span>
                                )}
                              </div>
                              <div style={{ marginTop: 2 }}>
                                {v.gate_last_out_time ? (
                                  <span style={{ color: t.overdueAlert ? '#dc2626' : '#b45309', fontWeight: 700 }}>
                                    Ra cổng: {formatDateTimeCompact(v.gate_last_out_time, nowMs)}
                                  </span>
                                ) : v.expected_checkout_time ? (
                                  <span style={{ color: 'var(--text-secondary)' }}>
                                    Dự kiến: {formatDateTimeCompact(v.expected_checkout_time, nowMs)}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Chưa quét cổng RA</span>
                                )}
                              </div>
                            </td>

                            <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                                <span className={`visitor-duration-pill ${t.overdueAlert ? 'warn' : ''}`}>
                                  {t.elapsedLabel}
                                </span>
                                {t.overdueAlert ? (
                                  <span
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: '#dc2626',
                                      lineHeight: 1.35,
                                    }}
                                  >
                                    {t.alertMessage}
                                  </span>
                                ) : v.gate_out_recent_minutes !== null && v.gate_out_recent_minutes !== undefined ? (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: '#b45309' }}>
                                    Vừa qua cổng RA {v.gate_out_recent_minutes} phút trước
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, color: '#15803d', fontWeight: 600 }}>
                                    Đang làm việc trong tòa nhà
                                  </span>
                                )}
                              </div>
                            </td>

                            <td style={{ textAlign: 'right' }}>
                              {swapRowId === v.id ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="text"
                                    autoFocus
                                    className="v-input"
                                    style={{ width: 135, height: 30, fontSize: 12 }}
                                    placeholder="Quẹt thẻ mới..."
                                    value={swapCardInput}
                                    onChange={(e) => setSwapCardInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSwapVisitorCard(v);
                                      } else if (e.key === 'Escape') {
                                        setSwapRowId(null);
                                        setSwapCardInput('');
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    disabled={swapping}
                                    onClick={() => handleSwapVisitorCard(v)}
                                  >
                                    {swapping ? '...' : 'Đổi'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => {
                                      setSwapRowId(null);
                                      setSwapCardInput('');
                                    }}
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${t.overdueAlert ? '' : 'btn-primary'}`}
                                    style={
                                      t.overdueAlert
                                        ? { background: '#dc2626', borderColor: '#dc2626', color: '#ffffff', fontWeight: 700 }
                                        : {}
                                    }
                                    onClick={() => handleFastCheckout(v.id)}
                                  >
                                    {t.overdueAlert ? 'Check-out ngay' : 'Trả thẻ & Ra về'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    title="Đổi sang thẻ RFID khác nếu thẻ cũ quét không được"
                                    onClick={() => {
                                      setSwapRowId(v.id);
                                      setSwapCardInput('');
                                    }}
                                  >
                                    Đổi thẻ
                                  </button>
                                  {hasCompanions && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      title="Trả thẻ & Check-out cả khách chính và toàn bộ người đi cùng"
                                      onClick={() => handleGroupCheckout(v)}
                                    >
                                      Cả đoàn ({v.companions.length + 1})
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>

                          {/* COLLAPSIBLE COMPANION DRAWER ("v" TOGGLE) */}
                          {hasCompanions && isExpanded && (
                            <tr className="companion-sub-row">
                              <td colSpan={7} style={{ padding: 0 }}>
                                <div className="companion-sub-box">
                                  <div
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 700,
                                      color: '#334155',
                                      marginBottom: 8,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                    }}
                                  >
                                    <span>Nhân sự đi cùng đoàn của {v.full_name} ({v.companions.length} người)</span>
                                  </div>
                                  <table className="data-table" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ width: 38 }}>#</th>
                                        <th>Họ tên người đi cùng</th>
                                        <th>CMND/CCCD</th>
                                        <th>Thẻ NFC</th>
                                        <th>Giờ vào / Ra cổng</th>
                                        <th>Ở trong CTy / Trạng thái</th>
                                        <th style={{ textAlign: 'right' }}>Thao tác</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {v.companions.map((c, cIdx) => {
                                        const ct = c._timing || evaluateVisitorTiming(c, nowMs);
                                        return (
                                          <tr key={c.id || cIdx}>
                                            <td style={{ color: 'var(--text-muted)' }}>{cIdx + 1}</td>
                                            <td style={{ fontWeight: 700, color: 'var(--jet)' }}>{c.full_name}</td>
                                            <td style={{ fontFamily: 'var(--font-mono)' }}>{c.cccd_number || '—'}</td>
                                            <td>
                                              {c.card_number ? (
                                                renderCardCell(c.card_number, c.card_display_name, 'badge badge-gold')
                                              ) : (
                                                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Đi cùng đoàn</span>
                                              )}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                              Vào {formatDateTimeCompact(c.checkin_time, nowMs)}
                                              {c.gate_last_out_time ? ` · Ra ${formatDateTimeCompact(c.gate_last_out_time, nowMs)}` : ''}
                                            </td>
                                            <td>
                                              <span className={`visitor-duration-pill ${ct.overdueAlert ? 'warn' : ''}`}>
                                                {ct.elapsedLabel}
                                              </span>
                                              {ct.overdueAlert && (
                                                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#dc2626' }}>
                                                  Quá 15p · Yêu cầu Check-out
                                                </span>
                                              )}
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                              <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                onClick={() => handleFastCheckout(c.id)}
                                              >
                                                Trả thẻ &amp; Ra về
                                              </button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
                </div>
              </div>

              {/* NỬA DƯỚI: CHỜ CẤP THẺ */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div
                  style={{
                    padding: '7px 16px',
                    background: pendingAppointments.length > 0 ? '#fffbeb' : '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: pendingAppointments.length > 0 ? '#b45309' : '#0f172a' }}>
                      Khách hẹn chờ cấp thẻ
                    </span>
                    <span className={`badge ${pendingAppointments.length > 0 ? 'badge-gold' : ''}`}>
                      {pendingAppointments.length}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Đặt trỏ chuột vào ô &amp; quẹt thẻ NFC để cấp ngay khi khách đến
                  </span>
                </div>
                <div className="table-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  <table className="data-table" key="table-pending">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
                      <tr>
                        <th style={{ width: 46 }}>#</th>
                        <th>Khách hẹn &amp; Định danh</th>
                        <th>Công ty &amp; Nội dung</th>
                        <th>Phòng ban / Người liên hệ</th>
                        <th>Khung giờ hẹn</th>
                        <th>Trạng thái</th>
                        <th style={{ textAlign: 'right' }}>Quẹt thẻ cấp ngay</th>
                      </tr>
                    </thead>
                    <tbody>
                  {pendingAppointments.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Hiện không có khách hẹn trước nào đang chờ cấp thẻ.
                      </td>
                    </tr>
                  ) : (
                    pendingAppointments
                      .filter((apt) => {
                        if (!visitorSearch.trim()) return true;
                        const q = visitorSearch.toLowerCase();
                        return `${apt.full_name || ''} ${apt.cccd_number || ''} ${apt.company || ''} ${apt.department || ''} ${apt.host_person || ''}`
                          .toLowerCase()
                          .includes(q);
                      })
                      .map((apt, idx) => (
                        <tr key={apt.id || idx} style={{ background: '#fffdf5' }}>
                          <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td>
                            <div style={{ fontWeight: 700, color: '#111111' }}>{apt.full_name}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              CCCD: {apt.cccd_number || '—'}
                              {apt.phone ? ` · ${apt.phone}` : ''}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{apt.company || '—'}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{apt.purpose || '—'}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{apt.department || '—'}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                              Gặp: {apt.host_person || '—'} {apt.host_phone ? `(${apt.host_phone})` : ''}
                            </div>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                            <div>Từ: {String(apt.checkin_time || '').slice(0, 16)}</div>
                            <div>Đến: {String(apt.expected_checkout_time || '').slice(0, 16) || '—'}</div>
                          </td>
                          <td>
                            <span className="badge badge-gold">PENDING · Chờ thẻ</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="text"
                                className="v-input"
                                style={{ width: 155, height: 32, fontSize: 12 }}
                                placeholder="Đặt trỏ chuột & quẹt thẻ..."
                                value={assignCardMap[apt.id] || ''}
                                onChange={(e) => setAssignCardMap((p) => ({ ...p, [apt.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAssignPendingCard(apt);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={assigningId === apt.id}
                                onClick={() => handleAssignPendingCard(apt)}
                              >
                                {assigningId === apt.id ? 'Đang nạp...' : 'Cấp thẻ'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="table-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <table className="data-table" key="table-history">
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8fafc' }}>
                  <tr>
                    <th style={{ width: 58 }}>#</th>
                    <th>Khách hàng &amp; Định danh</th>
                    <th>Công ty</th>
                    <th>Thẻ NFC</th>
                    <th>Phòng ban / Người liên hệ</th>
                    <th>Giờ vào</th>
                    <th>Giờ ra thực tế</th>
                    <th>Thời gian lưu lại</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedHistoryVisitors.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)' }}>
                        Chưa có lịch sử khách ra vào khớp tìm kiếm.
                      </td>
                    </tr>
                  ) : (
                    groupedHistoryVisitors.map((v, idx) => {
                      const hasComp = v.companions && v.companions.length > 0;
                      const isExp = Boolean(expandedGroups[`hist_${v.id}`]);
                      const status = v.status || v.Status || 'CHECKED_OUT';
                      const ht = evaluateVisitorTiming(v, nowMs);

                      return (
                        <React.Fragment key={`act_${v.id || idx}_${idx}`}>
                          <tr>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {hasComp && (
                                  <button
                                    type="button"
                                    className={`visitor-expand-btn ${isExp ? 'open' : ''}`}
                                    onClick={() => toggleGroupExpand(`hist_${v.id}`)}
                                    title={`Xem ${v.companions.length} người đi cùng`}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                )}
                                <span style={{ color: 'var(--text-muted)' }}>{idx + 1}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 700 }}>{v.full_name}</span>
                                {hasComp && (
                                  <span
                                    className="badge"
                                    style={{ background: '#e0f2fe', color: '#0369a1', fontSize: 10.5, cursor: 'pointer' }}
                                    onClick={() => toggleGroupExpand(`hist_${v.id}`)}
                                  >
                                    +{v.companions.length} đi cùng
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {v.cccd_number || `ID: ${v.id}`}
                              </div>
                            </td>
                            <td>{v.company || '—'}</td>
                            <td>
                              {renderCardCell(v.card_number, v.card_display_name, 'badge badge-dark')}
                            </td>
                            <td>
                              {v.department || '—'} {v.host_person ? `· ${v.host_person}` : ''}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                              {String(v.checkin_time || '').slice(0, 19) || '—'}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                              {String(v.checkout_time || v.gate_last_out_time || '—').slice(0, 19)}
                            </td>
                            <td>
                              <span className="visitor-duration-pill">
                                {v.duration_str && v.duration_str !== '--' ? v.duration_str : ht.elapsedLabel}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${status === 'ACTIVE' ? 'badge-gold' : 'badge-green'}`}>
                                {status === 'ACTIVE' ? 'Đang ở trong' : 'Đã trả thẻ'}
                              </span>
                            </td>
                          </tr>
                          {hasComp && isExp && (
                            <tr className="companion-sub-row">
                              <td colSpan={9} style={{ padding: 0 }}>
                                <div className="companion-sub-box">
                                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: '#334155' }}>
                                    Nhân sự đi cùng ({v.companions.length})
                                  </div>
                                  <table className="data-table" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
                                    <thead>
                                      <tr>
                                        <th>Họ tên</th>
                                        <th>CCCD</th>
                                        <th>Mã thẻ</th>
                                        <th>Giờ vào</th>
                                        <th>Giờ ra</th>
                                        <th>Thời lượng</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {v.companions.map((c, ci) => (
                                        <tr key={c.id || ci}>
                                          <td style={{ fontWeight: 600 }}>{c.full_name}</td>
                                          <td style={{ fontFamily: 'var(--font-mono)' }}>{c.cccd_number || '—'}</td>
                                          <td>{c.card_number || 'Đi cùng đoàn'}</td>
                                          <td style={{ fontFamily: 'var(--font-mono)' }}>{String(c.checkin_time || '').slice(0, 19)}</td>
                                          <td style={{ fontFamily: 'var(--font-mono)' }}>{String(c.checkout_time || '—').slice(0, 19)}</td>
                                          <td>{c.duration_str || '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
