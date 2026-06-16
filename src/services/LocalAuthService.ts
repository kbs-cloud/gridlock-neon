// Offline Authentication Service for Gridlock Neon

export class LocalAuthService {
  public async initCSRF(): Promise<void> {
    // No-op offline
  }

  public async checkSession(): Promise<any | null> {
    return this.getLocalUser();
  }

  public async logoutUser(): Promise<void> {
    // No-op offline
  }

  public async pollAuth(_token: string): Promise<any> {
    return { status: 'error', error: 'OAuth not supported offline.' };
  }

  public async recordGameStats(won: boolean): Promise<void> {
    const displayName = localStorage.getItem('gridlock_display_name') || 'Runner';
    const key = `gridlock_offline_stats_${displayName}`;
    let stats = { gamesPlayed: 0, gamesWon: 0 };
    try {
      const stored = localStorage.getItem(key);
      if (stored) stats = JSON.parse(stored);
    } catch (e) {
      // ignore
    }

    stats.gamesPlayed += 1;
    if (won) stats.gamesWon += 1;

    localStorage.setItem(key, JSON.stringify(stats));
  }

  private getLocalUser(): any {
    const displayName = localStorage.getItem('gridlock_display_name') || 'Runner';
    let stats = { gamesPlayed: 0, gamesWon: 0 };
    try {
      const storedStats = localStorage.getItem(`gridlock_offline_stats_${displayName}`);
      if (storedStats) {
        stats = JSON.parse(storedStats);
      }
    } catch (e) {
      console.error('Failed to parse offline stats:', e);
    }

    return {
      email: 'runner@local',
      displayName,
      stats
    };
  }
}
