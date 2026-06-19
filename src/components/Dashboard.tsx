import React, { useState } from 'react';
import { isPlayerVacant } from '../game/gameState';
import { SSOLoginPanel } from '../shared/auth/SSOLoginPanel';
import { Icons } from './Icons';

interface DashboardProps {
  online: boolean;
  currentUser: any;
  games: any[];
  errorMsg: string | null;
  setErrorMsg: (msg: string | null) => void;
  onRefresh: (query: string) => void;
  onSync: (gameId: string) => void;
  onDelete: (gameId: string) => void;
  onOnlineToggle: () => void;
  onSSOLogin: () => void;
  onLogout: () => void;
  localName: string;
  onLocalNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCreateGame: (name: string, maxPlayers: number, distance: number) => Promise<void>;
  onJoinGame: (code: string) => Promise<void>;
  getHubUrl: () => string;
}

export const Dashboard: React.FC<DashboardProps> = ({
  online,
  currentUser,
  games,
  errorMsg,
  setErrorMsg,
  onRefresh,
  onSync,
  onDelete,
  onOnlineToggle,
  onSSOLogin,
  onLogout,
  localName,
  onLocalNameChange,
  onCreateGame,
  onJoinGame,
  getHubUrl
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [newGamePlayers, setNewGamePlayers] = useState(4);
  const [newGameDistance, setNewGameDistance] = useState(1000);
  const [joinInviteCode, setJoinInviteCode] = useState('');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateGame(newGameName, newGamePlayers, newGameDistance)
      .then(() => setNewGameName(''));
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInviteCode.trim()) return;
    onJoinGame(joinInviteCode.trim().toUpperCase())
      .then(() => setJoinInviteCode(''));
  };

  return (
    <div className="dashboard-grid">
      {/* Lobbies List */}
      <div className="glass-panel cyan">
        <h2 className="text-neon-cyan" style={{ fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Icons.Grid /> ACTIVE NET LOBBIES
        </h2>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
          <input 
            type="text" 
            className="form-control" 
            style={{ flexGrow: '1' }} 
            placeholder="Search by name or invite code..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button className="btn outline-cyan" onClick={() => onRefresh(searchQuery)}>Refresh</button>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          {games.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
              <p>No active gridways detected. Spin up a new lobby!</p>
            </div>
          ) : (
            <table className="games-list-table">
              <thead>
                <tr>
                  <th>Lobby Name</th>
                  <th>Invite Code</th>
                  <th>Slots</th>
                  <th>Track Length</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const totalSlots = g.gameState?.players?.filter((p: any) => !isPlayerVacant(p, g.gameState.status)).length || 0;
                  return (
                    <tr key={g.id}>
                      <td className="font-mono text-neon-cyan">{g.name}</td>
                      <td className="font-mono" style={{ letterSpacing: '1px' }}>{g.inviteCode}</td>
                      <td className="font-mono">{totalSlots} / {g.gameState?.maxPlayers || 4}</td>
                      <td className="font-mono">{g.gameState?.targetDistance || 1000}m</td>
                      <td>
                        <span className={`badge ${g.gameState?.status === 'active' ? 'cyan' : g.gameState?.status === 'completed' ? 'green' : 'pink'}`}>
                          {g.gameState?.status || 'setup'}
                        </span>
                      </td>
                      <td style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="btn outline-cyan" 
                          style={{ padding: '6px 12px', fontSize: '0.75rem' }} 
                          onClick={() => onSync(g.id)}
                        >
                          Sync
                        </button>
                        {((g.ownerEmail === 'runner@local' && !online) || (g.ownerEmail === currentUser?.email && online)) && (
                          <button 
                            className="btn outline-pink" 
                            style={{ padding: '6px 12px', fontSize: '0.75rem' }} 
                            onClick={() => onDelete(g.id)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Setup Panel */}
      <div className="glass-panel">
        {online && !currentUser ? (
          <SSOLoginPanel
            title="GRIDLOCK NEON"
            subtitle="Gridway Runner Node"
            authError={errorMsg || ''}
            buttonText="DOCK COMMAND CONSOLE"
            isGooglePolling={false}
            playOnline={online}
            onPlayOnlineChange={onOnlineToggle}
            onLoginClick={onSSOLogin}
            onCancelGooglePoll={() => {}}
            themeColor="#00f0ff"
            icon={
              <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
            }
            containerClassName="sso-dashboard-container"
            cardClassName="sso-dashboard-card"
            buttonClassName="btn primary-cyan"
          />
        ) : (
          <>
            <h2 className="text-neon-pink" style={{ fontSize: '1.2rem', marginBottom: '20px' }}>SPIN GRIDWAY</h2>
            
            {/* Create Lobby */}
            <form onSubmit={handleCreateSubmit} className="session-setup-form" style={{ marginBottom: '30px' }}>
              <div className="form-group">
                <label>LOBBY NAME</label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="e.g. Viper Runner Gridway" 
                  value={newGameName}
                  onChange={e => setNewGameName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>MAX PLAYERS</label>
                <select 
                  className="form-control" 
                  value={newGamePlayers}
                  onChange={e => setNewGamePlayers(Number(e.target.value))}
                >
                  <option value="2">2 Players</option>
                  <option value="4">4 Players</option>
                  <option value="8">8 Players</option>
                </select>
              </div>
              <div className="form-group">
                <label>TRACK LENGTH</label>
                <select 
                  className="form-control" 
                  value={newGameDistance}
                  onChange={e => setNewGameDistance(Number(e.target.value))}
                >
                  <option value="500">500 meters (Sprint)</option>
                  <option value="1000">1000 meters (Standard)</option>
                  <option value="2000">2000 meters (Survival Yeti)</option>
                </select>
              </div>
              <button 
                type="submit" 
                className="btn primary-cyan" 
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={online && !currentUser}
              >
                Launch Lobby
              </button>
              {online && !currentUser && (
                <span className="text-neon-pink font-mono" style={{ fontSize: '0.75rem', textAlign: 'center' }}>
                  * SSO authentication required to spin online gridways.
                </span>
              )}
            </form>

            {/* Join Lobby by code */}
            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '20px 0' }} />
            <h2 className="text-neon-cyan" style={{ fontSize: '1.1rem', marginBottom: '15px' }}>DOCK INTO GRIDWAY</h2>
            <form onSubmit={handleJoinSubmit} className="session-setup-form">
              <div className="form-group">
                <label>INVITE CODE / LOBBY ID</label>
                <input 
                  type="text" 
                  className="form-control font-mono" 
                  style={{ textTransform: 'uppercase', letterSpacing: '1px' }}
                  placeholder="CODE (e.g. A4FB)" 
                  value={joinInviteCode}
                  onChange={e => setJoinInviteCode(e.target.value)}
                />
              </div>
              <button 
                type="submit" 
                className="btn outline-cyan" 
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={online && !currentUser}
              >
                Request Grid Access
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
