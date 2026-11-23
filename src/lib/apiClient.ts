'use client';

/**
 * Key for the per-tab identity token in sessionStorage. Each browser tab that
 * logs into a portal stores its own token here, so two chefs logging in on the
 * same browser (different tabs) don't clobber each other's identity.
 *
 * The matching httpOnly cookie (rms_chef_session etc.) is still set too — it
 * gates the server-component route guard (requireChef etc.) — but for data
 * requests this Bearer token is what resolves the actual signed-in user, so
 * each tab stays tied to the chef who signed in on it.
 */
export const SESSION_TOKEN_KEY = 'rms_tab_token';
export const SESSION_USER_KEY = 'rms_tab_user';

/** Read this tab's identity token (or null if this tab never logged in). */
export function getTabToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(SESSION_TOKEN_KEY); } catch { return null; }
}

/** Read this tab's signed-in user object (or null). */
export function getTabUser<T = any>(): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

/** Store this tab's identity after a successful login. */
export function setTabIdentity(token: string, user: any): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  } catch { /* ignore quota / privacy errors */ }
}

/** Clear this tab's identity (logout from this tab only). */
export function clearTabIdentity(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
  } catch { /* ignore */ }
}

/**
 * Small client-side fetch wrapper that always sends credentials (the httpOnly
 * session cookie) and, when this tab has a per-tab identity token, attaches it
 * as `Authorization: Bearer ...`. Returns { data, error, status, ok }.
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
    const token = getTabToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      cache: 'no-store',
      headers,
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

