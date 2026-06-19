import React from 'react';
import { isPlayerVacant } from '../game/gameState';
import type { GameState } from '../game/gameState';
import { Icons } from './Icons';

interface LobbyRoomProps {
  gameState: GameState;
  activeGameId: string;
  isHost: boolean;
  online: boolean;
  joinRequests: any[];
  assignPlayerSlot: (playerId: string, isAi: boolean, isLocal: boolean, name?: string) => Promise<void>;
  handleAcceptRequest: (playerId: string, request: any) => Promise<void>;
  handleRejectRequest: (joinRequestId: number) => Promise<void>;
  handleStartLobby: () => Promise<void>;
  onLeaveLobby: () => void;
}

export const LobbyRoom: React.FC<LobbyRoomProps> = ({
  gameState,
  activeGameId,
  isHost,
  online,
  joinRequests,
  assignPlayerSlot,
  handleAcceptRequest,
  handleRejectRequest,
  handleStartLobby,
  onLeaveLobby
}) => {
  return (
    <div className="lobby-layout">
      {/* Player list and slot allocations */}
      <div className="glass-panel cyan">
        <h2 className="text-neon-cyan" style={{ fontSize: '1.3rem', marginBottom: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>GRID ACCESS AUTHORIZATIONS</span>
          <span className="font-mono" style={{ fontSize: '0.9rem', color: '#94a3b8' }}>CODE: {gameState.seed ? activeGameId : '...'}</span>
        </h2>
        
        <div className="lobby-slots">
          {gameState.players.map((p, idx) => {
            const vacant = isPlayerVacant(p, gameState.status);
            return (
              <div className={`slot-row ${vacant ? '' : 'active'}`} key={p.id}>
                <div className="slot-player-info">
                  <div className={`slot-avatar ${idx === 0 ? 'host' : p.isAi ? 'ai' : 'member'}`}>
                    {p.isAi ? 'AI' : (idx + 1)}
                  </div>
                  <div>
                    <span className="font-mono" style={{ fontSize: '1rem', color: vacant ? '#475569' : '#f8fafc' }}>
                      {vacant ? '[VACANT ACCESS PORT]' : p.name}
                    </span>
                    {!vacant && p.assignedEmail && (
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }} className="font-mono">
                        {p.assignedEmail}
                      </div>
                    )}
                  </div>
                </div>

                {isHost && (
                  <div className="slot-actions">
                    {vacant ? (
                      <button 
                        className="btn outline-cyan" 
                        style={{ padding: '4px 10px', fontSize: '0.75rem' }} 
                        onClick={() => assignPlayerSlot(p.id, true, true, `AI Speeder ${idx + 1}`)}
                      >
                        Insert AI
                      </button>
                    ) : (
                      idx > 0 && (
                        <button 
                          className="btn outline-pink" 
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }} 
                          onClick={() => assignPlayerSlot(p.id, false, true)}
                        >
                          Clear Port
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: '30px', display: 'flex', gap: '15px' }}>
          <button className="btn outline-pink" onClick={onLeaveLobby}>
            Back to Terminal
          </button>
          {isHost ? (
            <button className="btn primary-cyan" onClick={handleStartLobby}>
              Ignite Laser Grid
            </button>
          ) : (
            <span className="font-mono text-neon-pink" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center' }}>
              WAITING FOR HOST TO IGNITE GRIDWAY...
            </span>
          )}
        </div>
      </div>

      {/* Lobby Configuration & Join Requests */}
      <div className="glass-panel">
        <h2 className="text-neon-pink" style={{ fontSize: '1.2rem', marginBottom: '20px' }}>GRIDWAY SEED LOGISTICS</h2>
        <div className="font-mono" style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.9rem', marginBottom: '30px' }}>
          <div>TRACK PATTERN SEED: <span className="text-neon-cyan">{gameState.seed}</span></div>
          <div>TRACK COMPLETION GOAL: <span className="text-neon-cyan">{gameState.targetDistance} meters</span></div>
          <div>LOBBY HOSTING STATUS: <span className="text-neon-pink">{online ? 'SSO MULTIPLAYER' : 'OFFLINE SINGLE/LOCAL'}</span></div>
        </div>

        {online && isHost && (
          <div>
            <h2 className="text-neon-cyan" style={{ fontSize: '1.1rem', marginBottom: '15px' }}>PENDING DOCK REQUESTS</h2>
            {joinRequests.length === 0 ? (
              <div className="font-mono" style={{ color: '#64748b', fontSize: '0.85rem' }}>No pending pilots detected in orbit.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {joinRequests.map(r => (
                  <div className="slot-row active" style={{ padding: '10px 15px' }} key={r.id}>
                    <div className="font-mono" style={{ fontSize: '0.85rem' }}>
                      <div>{r.display_name}</div>
                      <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{r.email}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {gameState.players.some(p => isPlayerVacant(p, 'setup')) ? (
                        <button 
                          className="btn primary-cyan" 
                          style={{ padding: '4px 8px', fontSize: '0.7rem' }}
                          onClick={() => {
                            const nextSlot = gameState.players.find(p => isPlayerVacant(p, 'setup'))?.id || '';
                            if (nextSlot) handleAcceptRequest(nextSlot, r);
                          }}
                        >
                          Dock
                        </button>
                      ) : (
                        <span className="text-neon-pink font-mono" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}>Lobby Full</span>
                      )}
                      <button 
                        className="btn outline-pink" 
                        style={{ padding: '4px 8px', fontSize: '0.7rem' }}
                        onClick={() => handleRejectRequest(r.id)}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
