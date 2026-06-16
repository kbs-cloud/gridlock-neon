// Online Game Service for Gridlock Neon
import { apiFetch } from './api';

export class OnlineGameService {
  public async listGames(search?: string): Promise<any> {
    const url = search ? `/api/games?search=${encodeURIComponent(search)}` : '/api/games';
    const res = await apiFetch(url);
    if (res.ok) return res.json();
    throw new Error('Failed to list games.');
  }

  public async getGame(id: string): Promise<any> {
    const res = await apiFetch(`/api/games/${id}`);
    if (res.ok) return res.json();
    throw new Error('Failed to load game.');
  }

  public async fetchJoinRequests(gameId: string): Promise<any> {
    const res = await apiFetch(`/api/games/${gameId}/join-requests`);
    if (res.ok) return res.json();
    throw new Error('Failed to fetch join requests.');
  }

  public async createGame(name: string, maxPlayers: number, targetDistance: number): Promise<any> {
    const res = await apiFetch('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        name,
        setupOptions: { maxPlayers, targetDistance }
      })
    });
    if (res.ok) return res.json();
    throw new Error('Failed to create game.');
  }

  public async joinGame(gameId: string): Promise<any> {
    const res = await apiFetch(`/api/games/${gameId}/join`, { method: 'POST' });
    if (res.ok) return res.json();
    throw new Error('Failed to join game.');
  }

  public async assignSlot(gameId: string, playerId: string, assignOptions: any): Promise<any> {
    const res = await apiFetch(`/api/games/${gameId}/assign-slot`, {
      method: 'POST',
      body: JSON.stringify({
        playerId,
        ...assignOptions
      })
    });
    if (res.ok) return res.json();
    throw new Error('Failed to assign slot.');
  }

  public async performGameAction(gameId: string, action: any, playerId: string): Promise<any> {
    const res = await apiFetch(`/api/games/${gameId}/action`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        playerId
      })
    });
    if (res.ok) return res.json();
    throw new Error('Action failed.');
  }

  public async rejectJoin(gameId: string, joinRequestId: number): Promise<any> {
    const res = await apiFetch(`/api/games/${gameId}/reject-join`, {
      method: 'POST',
      body: JSON.stringify({ joinRequestId })
    });
    if (res.ok) return res.json();
    throw new Error('Failed to reject join request.');
  }

  public async deleteGame(gameId: string): Promise<any> {
    const res = await apiFetch(`/api/games/${gameId}`, { method: 'DELETE' });
    if (res.ok) return res.json();
    throw new Error('Failed to delete game.');
  }
}
