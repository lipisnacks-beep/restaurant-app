'use client';
/**
 * Small client-side fetch wrapper that always sends credentials (the httpOnly
 * session cookie) and parses JSON. Returns { data, error, status }.
 *
 * `cache: 'no-store'` is set on every request so the browser never serves a
 * stale cached copy — the chef portal polls every few seconds and MUST see
 * freshly accepted/claimed orders immediately, not a cached snapshot from
 * a moment ago.
 */
export async function api<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: string; status: number; ok: boolean }> {
  try {
    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let payload: any = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      payload = await res.json();
    } else {
      payload = { text: await res.text() };
    }
    if (!res.ok) {
      return { error: payload?.error || `Request failed (${res.status})`, status: res.status, ok: false };
    }
    return { data: payload as T, status: res.status, ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Network error', status: 0, ok: false };
  }
}
