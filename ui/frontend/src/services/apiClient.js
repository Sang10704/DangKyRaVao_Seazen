export async function apiFetch(path, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(path, {
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    return {
      status: 0,
      ok: false,
      data: {
        success: false,
        error: isTimeout
          ? 'Hết thời gian chờ phản hồi từ máy chủ (15 giây). Vui lòng thử lại.'
          : 'Không thể kết nối tới máy chủ SeaZen VMS.',
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
