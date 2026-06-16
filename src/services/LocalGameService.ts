// Offline Game Service for Gridlock Neon
import type { GameState } from '../game/gameState';
import { initializeGame, executeAction } from '../game/gameState';

function generateUUID(): string {
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

interface StoredGame {
  id: string;
  inviteCode: string;
  ownerEmail: string | null;
  name: string;
  gameState: string; // JSON string
  created_at: string;
  updated_at: string;
}

export class LocalGameService {
  private getStoredGames(): StoredGame[] {
    const stored = localStorage.getItem('gridlock_local_games');
    if (!stored) return [];
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse local games:', e);
      return [];
    }
  }

  private saveStoredGames(games: StoredGame[]) {
    localStorage.setItem('gridlock_local_games', JSON.stringify(games));
  }

  public async listGames(search?: string): Promise<{ success: boolean; games?: any[]; error?: string }> {
    let list = this.getStoredGames();
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(g => g.name.toLowerCase().includes(q) || g.inviteCode.toLowerCase().includes(q));
    }
    const games = list.map(g => ({
      id: g.id,
      inviteCode: g.inviteCode,
      ownerEmail: g.ownerEmail,
      name: g.name,
      gameState: JSON.parse(g.gameState)
    }));
    return { success: true, games };
  }

  public async getGame(id: string): Promise<{ success: boolean; game?: any; connectedPlayers?: string[]; error?: string }> {
    const list = this.getStoredGames();
    const found = list.find(g => g.id === id || g.inviteCode === id);
    if (!found) {
      return { success: false, error: 'Gridlock session not found.' };
    }
    let state: GameState;
    try {
      state = JSON.parse(found.gameState);
    } catch (e) {
      return { success: false, error: 'Corrupt local game state.' };
    }
    return {
      success: true,
      game: {
        id: found.id,
        inviteCode: found.inviteCode,
        ownerEmail: found.ownerEmail,
        name: found.name,
        gameState: state
      },
      connectedPlayers: ['runner@local']
    };
  }

  public async fetchJoinRequests(_gameId: string): Promise<{ success: boolean; requests: any[]; error?: string }> {
    return { success: true, requests: [] };
  }

  public async createGame(name: string, maxPlayers: number, targetDistance: number): Promise<{ success: boolean; gameId?: string; inviteCode?: string; name?: string; error?: string }> {
    const hostName = localStorage.getItem('gridlock_display_name') || 'Runner';
    let state: GameState;
    try {
      state = initializeGame({
        name: name.trim(),
        hostName,
        hostEmail: 'runner@local',
        maxPlayers,
        targetDistance
      });
    } catch (e) {
      return { success: false, error: 'Failed to initialize gridway.' };
    }

    // Set slots local
    state.players = state.players.map((p, idx) => {
      if (idx === 0) {
        return { ...p, isLocal: true, assignedEmail: 'runner@local' };
      }
      return { ...p, isLocal: true };
    });

    const now = new Date().toISOString();
    const gameId = generateUUID();
    const inviteCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const newGame: StoredGame = {
      id: gameId,
      inviteCode,
      ownerEmail: 'runner@local',
      name: name.trim(),
      gameState: JSON.stringify(state),
      created_at: now,
      updated_at: now
    };

    const list = this.getStoredGames();
    list.unshift(newGame);
    this.saveStoredGames(list);

    return {
      success: true,
      gameId,
      inviteCode,
      name: name.trim()
    };
  }

  public async joinGame(_gameId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return { success: true, message: 'Joined local lobby.' };
  }

  public async assignSlot(gameId: string, playerId: string, assignOptions: any): Promise<{ success: boolean; error?: string }> {
    const res = await this.getGame(gameId);
    if (!res.success || !res.game) {
      return { success: false, error: res.error || 'Game not found.' };
    }
    const state = res.game.gameState;
    const player = state.players.find((p: any) => p.id === playerId);
    if (!player) return { success: false, error: 'Player slot not found.' };

    if (assignOptions.email) {
      player.assignedEmail = assignOptions.email;
      player.isLocal = false;
      player.isAi = false;
    } else if (assignOptions.isAi) {
      player.isAi = true;
      player.isLocal = true;
      player.assignedEmail = null;
    } else if (assignOptions.isLocal) {
      player.isAi = false;
      player.isLocal = true;
      player.assignedEmail = null;
    }
    if (assignOptions.name) {
      player.name = assignOptions.name;
    }

    await this.updateStoredGameState(gameId, state);
    return { success: true };
  }

  public async performGameAction(gameId: string, action: any, playerId: string): Promise<{ success: boolean; gameState?: GameState; error?: string }> {
    const res = await this.getGame(gameId);
    if (!res.success || !res.game) {
      return { success: false, error: res.error || 'Game not found.' };
    }
    const state = res.game.gameState;
    let nextState: GameState;
    try {
      nextState = executeAction(state, { ...action, playerId });
    } catch (e: any) {
      return { success: false, error: e.message || 'Action failed.' };
    }

    await this.updateStoredGameState(gameId, nextState);

    // If game completed, update local stats
    if (nextState.status === 'completed' && state.status !== 'completed') {
      const hostName = localStorage.getItem('gridlock_display_name') || 'Runner';
      const key = `gridlock_offline_stats_${hostName}`;
      let stats = { gamesPlayed: 0, gamesWon: 0 };
      try {
        const stored = localStorage.getItem(key);
        if (stored) stats = JSON.parse(stored);
      } catch (e) {}

      stats.gamesPlayed += 1;
      
      const hostPlayer = nextState.players.find((p: any) => p.id === 'player_1');
      const sorted = [...nextState.players].sort((a: any, b: any) => b.score - a.score);
      const won = sorted[0] && sorted[0].id === hostPlayer?.id;
      if (won) stats.gamesWon += 1;

      localStorage.setItem(key, JSON.stringify(stats));
    }

    return { success: true, gameState: nextState };
  }

  public async rejectJoin(_gameId: string, _joinRequestId: number): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  public async deleteGame(gameId: string): Promise<{ success: boolean; error?: string }> {
    let list = this.getStoredGames();
    list = list.filter(g => g.id !== gameId);
    this.saveStoredGames(list);
    return { success: true };
  }

  private async updateStoredGameState(id: string, state: GameState): Promise<void> {
    const list = this.getStoredGames();
    const idx = list.findIndex(g => g.id === id);
    if (idx !== -1) {
      list[idx].gameState = JSON.stringify(state);
      list[idx].updated_at = new Date().toISOString();
      this.saveStoredGames(list);
    }
  }
}
