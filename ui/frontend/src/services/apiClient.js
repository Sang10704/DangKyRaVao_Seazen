export async function apiFetch(path, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const { headers: customHeaders, signal: customSignal, timeoutMs: _ignored, ...restOptions } = options;
  try {
    const res = await fetch(path, {
      ...restOptions,
      credentials: 'include',
      signal: customSignal || (controller ? controller.signal : undefined),
      headers: {
        'Content-Type': 'application/json',
        ...(customHeaders || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (
      res.status === 401 &&
      typeof window !== 'undefined' &&
      !String(path).includes('/api/auth/login') &&
      !String(path).includes('/api/auth/me')
    ) {
      window.dispatchEvent(new CustomEvent('seazen:unauthorized'));
    }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    const secs = Math.round(timeoutMs / 1000);
    return {
      status: 0,
      ok: false,
      data: {
        success: false,
        error: isTimeout
          ? `Hết thời gian chờ phản hồi từ máy chủ (${secs} giây). Vui lòng thử lại.`
          : 'Không thể kết nối tới máy chủ SeaZen VMS.',
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
