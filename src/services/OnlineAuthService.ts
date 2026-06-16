// Online Authentication Service for Gridlock Neon
import { apiFetch } from './api';

export class OnlineAuthService {
  public async initCSRF(): Promise<void> {
    try {
      const res = await apiFetch('/api/csrf-init');
      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          localStorage.setItem('gridlock_csrf_token', data.csrfToken);
        }
      }
    } catch (e) {
      console.error('Failed to initialize CSRF:', e);
    }
  }

  public async checkSession(): Promise<any | null> {
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          return data.user;
        }
      }
    } catch (e) {
      console.error('Failed to check session:', e);
    }
    return null;
  }

  public async logoutUser(): Promise<void> {
    try {
      await apiFetch('/api/logout', { method: 'POST' });
    } catch (e) {
      console.error('Failed to logout:', e);
    }
  }

  public async pollAuth(token: string): Promise<any> {
    const res = await apiFetch(`/api/auth/poll?token=${encodeURIComponent(token)}`);
    if (res.ok) {
      return res.json();
    }
    throw new Error('OAuth poll failed.');
  }
}
