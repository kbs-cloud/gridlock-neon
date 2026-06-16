// CSRF and Fetch Utility for Gridlock Neon

export function isOnlineMode(): boolean {
  return localStorage.getItem('gridlock_play_online') !== 'false';
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const getCookie = (name: string): string | null => {
    if (typeof document === 'undefined') return null;
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  };

  const cookieToken = getCookie('csrf_token') || '';
  const csrfToken = cookieToken || localStorage.getItem('gridlock_csrf_token') || '';
  const sessionId = localStorage.getItem('gridlock_session_id') || '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    ...(options.headers as Record<string, string>)
  };

  if (sessionId) {
    headers['X-Session-ID'] = sessionId;
  }

  return fetch(url, {
    credentials: 'include',
    ...options,
    headers
  });
}
