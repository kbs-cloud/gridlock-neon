import React, { useState, useEffect } from 'react';
import { authService, gameService } from './services';
import { isOnlineMode } from './services/api';
import { startSSOBackgroundCheck, getAuthServerUrl } from './shared/auth/sso-helper';
import { isPlayerVacant } from './game/gameState';
import type { GameState } from './game/gameState';

// Components
import { Icons } from './components/Icons';
import { Dashboard } from './components/Dashboard';
import { LobbyRoom } from './components/LobbyRoom';
import { GameCanvas } from './components/GameCanvas';

function getHubUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:19000';
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:19000';
  }
  return `${proto}//kbs-cloud.com`;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [online, setOnline] = useState<boolean>(isOnlineMode());
  const [games, setGames] = useState<any[]>([]);
  
  // Active game session
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connectedPlayers, setConnectedPlayers] = useState<string[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  
  // UI states
  const [localName, setLocalName] = useState(localStorage.getItem('gridlock_display_name') || 'Runner');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch session and games
  useEffect(() => {
    let active = true;
    let cleanupBackgroundCheck: (() => void) | null = null;

    authService.initCSRF().then(() => {
      authService.checkSession().then((user: any) => {
        if (!active) return;
        if (user) {
          setCurrentUser(user);
        } else if (online) {
          cleanupBackgroundCheck = startSSOBackgroundCheck({
            clientId: 'gridlock-neon',
            onSuccess: async () => {
              const uData = await authService.checkSession();
              if (uData && active) {
                setCurrentUser(uData);
                setErrorMsg(null);
              }
            }
          });
        }
      });
    });

    return () => {
      active = false;
      if (cleanupBackgroundCheck) {
        cleanupBackgroundCheck();
      }
    };
  }, [online]);

  useEffect(() => {
    loadGamesList();
  }, [online, currentUser]);

  // Polling loops
  useEffect(() => {
    if (!activeGameId) return;

    // Fast polling during gameplay (1s)
    // Slower polling during lobby setup (2s)
    const inGameplay = gameState?.status === 'active';
    const intervalTime = inGameplay ? 1000 : 2000;
    
    const poll = setInterval(() => {
      refreshActiveGame();
    }, intervalTime);

    return () => clearInterval(poll);
  }, [activeGameId, gameState?.status]);

  const loadGamesList = async (searchQuery: string = '') => {
    try {
      const res = await gameService.listGames(searchQuery);
      if (res.success && res.games) {
        setGames(res.games);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleOnlineToggle = () => {
    const nextVal = !online;
    localStorage.setItem('gridlock_play_online', nextVal ? 'true' : 'false');
    setOnline(nextVal);
    setActiveGameId(null);
    setGameState(null);
  };

  const handleLocalNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.trim().substring(0, 15);
    setLocalName(val);
    localStorage.setItem('gridlock_display_name', val || 'Runner');
  };

  const handleSSOLogin = () => {
    const source = 'iframe';
    const client_id = 'gridlock-neon';
    const redirect_uri = `${window.location.origin}/api/auth/callback?source=iframe`;
    const ssoUrl = `${getAuthServerUrl()}/api/auth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&source=${source}`;
    
    // Open SSO Login Popup
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    
    const popup = window.open(
      ssoUrl,
      'KBS SSO Authentication',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    
    const messageListener = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SSO_LOGIN_SUCCESS') {
        window.removeEventListener('message', messageListener);
        popup?.close();
        authService.checkSession().then((user: any) => {
          if (user) {
            setCurrentUser(user);
            setErrorMsg(null);
          }
        });
      }
    };
    
    window.addEventListener('message', messageListener);
  };

  const handleLogout = async () => {
    await authService.logoutUser();
    setCurrentUser(null);
    setActiveGameId(null);
    setGameState(null);
    window.location.href = `${getAuthServerUrl()}/api/auth/logout?redirect_uri=${encodeURIComponent(window.location.origin)}`;
  };

  const createNewGame = async (name: string, maxPlayers: number, distance: number) => {
    setErrorMsg(null);
    try {
      const res = await gameService.createGame(name.trim(), maxPlayers, distance);
      if (res.success && res.gameId) {
        setActiveGameId(res.gameId);
        refreshActiveGame(res.gameId);
      } else {
        setErrorMsg(res.error || 'Failed to create game.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Creation failed.');
    }
  };

  const joinGameByCode = async (inviteCode: string) => {
    setErrorMsg(null);
    try {
      const res = await gameService.joinGame(inviteCode);
      if (res.success) {
        setActiveGameId(inviteCode);
        refreshActiveGame(inviteCode);
      } else {
        setErrorMsg(res.error || 'Join request failed.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to join game.');
    }
  };

  const refreshActiveGame = async (targetGameId?: string) => {
    const id = targetGameId || activeGameId;
    if (!id) return;
    try {
      const res = await gameService.getGame(id);
      if (res.success && res.game) {
        const nextState = res.game.gameState as GameState;
        setGameState(nextState);
        setConnectedPlayers(res.connectedPlayers || []);
        
        // In online mode, fetch join requests if host
        const myEmail = currentUser?.email || 'runner@local';
        const isHost = nextState.players[0]?.assignedEmail === myEmail || nextState.players[0]?.assignedEmail === 'runner@local';
        if (online && isHost) {
          const reqs = await gameService.fetchJoinRequests(id);
          if (reqs.success) {
            setJoinRequests(reqs.requests || []);
          }
        }
      }
    } catch (e) {
      console.error('Failed to poll game state:', e);
    }
  };

  const assignPlayerSlot = async (playerId: string, isAi: boolean, isLocal: boolean, name?: string) => {
    if (!activeGameId) return;
    try {
      const assignOptions: any = { isAi, isLocal };
      if (name) assignOptions.name = name;
      await gameService.assignSlot(activeGameId, playerId, assignOptions);
      refreshActiveGame();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAcceptRequest = async (playerId: string, request: any) => {
    if (!activeGameId) return;
    try {
      await gameService.assignSlot(activeGameId, playerId, {
        email: request.email,
        name: request.display_name,
        isAi: false,
        isLocal: false,
        joinRequestId: request.id
      });
      refreshActiveGame();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRejectRequest = async (joinRequestId: number) => {
    if (!activeGameId) return;
    try {
      await gameService.rejectJoin(activeGameId, joinRequestId);
      refreshActiveGame();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartLobby = async () => {
    if (!activeGameId) return;
    try {
      // In local mode, auto fill empty non-host slots with AI so the game is populated
      if (!online && gameState) {
        for (let i = 1; i < gameState.players.length; i++) {
          const p = gameState.players[i];
          if (isPlayerVacant(p, 'setup')) {
            await gameService.assignSlot(activeGameId, p.id, { isAi: true, isLocal: true, name: `AI Viper ${i}` });
          }
        }
      }
      await gameService.performGameAction(activeGameId, { type: 'start' }, 'player_1');
      refreshActiveGame();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetLobby = async () => {
    if (!activeGameId) return;
    try {
      await gameService.performGameAction(activeGameId, { type: 'reset' }, 'player_1');
      refreshActiveGame();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteGame = async (id: string) => {
    try {
      await gameService.deleteGame(id);
      loadGamesList();
      if (activeGameId === id) {
        setActiveGameId(null);
        setGameState(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSyncGame = (gameId: string) => {
    setActiveGameId(gameId);
    refreshActiveGame(gameId);
  };

  const handleLeaveLobby = () => {
    setActiveGameId(null);
    setGameState(null);
  };

  const handleGameStateSync = (nextState: GameState) => {
    setGameState(nextState);
  };

  const myEmail = currentUser?.email || 'runner@local';
  const isHost = gameState?.players[0]?.assignedEmail === myEmail || gameState?.players[0]?.assignedEmail === 'runner@local';
  const inGameplay = !!(gameState && (gameState.status === 'active' || gameState.status === 'completed'));

  return (
    <div className="app-container">
      <header className={inGameplay ? 'compact' : ''}>
        <div>
          <h1>Gridlock Neon</h1>
          {!inGameplay && <p className="tagline">Synthwave Rhythm Runner & Cyber-Highway Racer</p>}
        </div>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          {/* Navigation Controls */}
          {!activeGameId ? (
            <a 
              href={getHubUrl()} 
              className="btn outline-cyan" 
              style={{ padding: '8px 14px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
            >
              <Icons.Grid /> HUB CATALOG
            </a>
          ) : (
            <button 
              className="btn outline-pink" 
              style={{ padding: '8px 14px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={() => {
                if (confirm("Disconnect from the gridway session and return to Net Lobbies?")) {
                  setActiveGameId(null);
                  setGameState(null);
                }
              }}
            >
              <Icons.Home /> LEAVE GRID
            </button>
          )}

          {/* Online vs Offline Switch */}
          {!inGameplay && (
            <div 
              className={`switch-container ${online ? 'active' : ''}`}
              onClick={handleOnlineToggle}
            >
              <span className="font-mono" style={{ fontSize: '0.85rem' }}>{online ? 'ONLINE (SSO)' : 'OFFLINE'}</span>
              <div className="switch-toggle"></div>
            </div>
          )}
          
          {/* Profile Section */}
          {!inGameplay && (
            online ? (
              currentUser ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="badge cyan font-mono">{currentUser.displayName}</span>
                  <button className="btn outline-pink" style={{ padding: '6px 12px' }} onClick={handleLogout}>Logout</button>
                </div>
              ) : (
                <button className="btn primary-cyan" onClick={handleSSOLogin}>SSO Login</button>
              )
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="font-mono text-neon-cyan" style={{ fontSize: '0.9rem' }}>RUNNER PROFILE:</span>
                <input 
                  type="text" 
                  className="form-control" 
                  style={{ padding: '5px 10px', width: '130px', fontSize: '0.85rem' }} 
                  value={localName}
                  onChange={handleLocalNameChange}
                />
              </div>
            )
          )}
        </div>
      </header>

      {errorMsg && (
        <div className="glass-panel pink" style={{ padding: '12px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="text-neon-pink font-mono" style={{ fontSize: '0.9rem' }}>WARNING: {errorMsg}</span>
          <button className="btn outline-pink" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setErrorMsg(null)}>Dismiss</button>
        </div>
      )}

      {!activeGameId ? (
        /* MAIN DASHBOARD SCREEN */
        <Dashboard
          online={online}
          currentUser={currentUser}
          games={games}
          errorMsg={errorMsg}
          setErrorMsg={setErrorMsg}
          onRefresh={loadGamesList}
          onSync={handleSyncGame}
          onDelete={handleDeleteGame}
          onOnlineToggle={handleOnlineToggle}
          onSSOLogin={handleSSOLogin}
          onLogout={handleLogout}
          localName={localName}
          onLocalNameChange={handleLocalNameChange}
          onCreateGame={createNewGame}
          onJoinGame={joinGameByCode}
          getHubUrl={getHubUrl}
        />
      ) : (
        /* LOBBY ROOM OR GAMEPLAY VIEW */
        <div style={{ flexGrow: '1', display: 'flex', flexDirection: 'column' }}>
          {!gameState && (
            <div className="glass-panel cyan" style={{ textAlign: 'center', padding: '40px', maxWidth: '600px', margin: '40px auto' }}>
              <h2 className="text-neon-cyan font-mono" style={{ fontSize: '1.4rem', marginBottom: '20px' }}>
                CONNECTING TO THE GRID...
              </h2>
              <div style={{ margin: '30px 0' }}>
                <div style={{
                  width: '50px',
                  height: '50px',
                  border: '3px solid rgba(0, 255, 255, 0.1)',
                  borderTopColor: 'var(--neon-cyan)',
                  borderRadius: '50%',
                  margin: '0 auto 20px',
                  animation: 'spin 1s linear infinite'
                }} />
                <span className="font-mono text-neon-pink" style={{ letterSpacing: '1px' }}>ESTABLISHING SECURE PROTOCOLS</span>
              </div>
              <p className="font-mono" style={{ color: '#64748b', fontSize: '0.9rem' }}>Lobby Access ID: {activeGameId}</p>
              <button 
                className="btn outline-pink" 
                style={{ marginTop: '20px', padding: '8px 16px', fontSize: '0.8rem' }} 
                onClick={handleLeaveLobby}
              >
                Abort Link
              </button>
            </div>
          )}

          {/* LOBBY SETUP SCREEN */}
          {gameState && gameState.status === 'setup' && (
            <LobbyRoom
              gameState={gameState}
              activeGameId={activeGameId}
              isHost={isHost}
              online={online}
              joinRequests={joinRequests}
              assignPlayerSlot={assignPlayerSlot}
              handleAcceptRequest={handleAcceptRequest}
              handleRejectRequest={handleRejectRequest}
              handleStartLobby={handleStartLobby}
              onLeaveLobby={handleLeaveLobby}
            />
          )}

          {/* ACTIVE GAMEPLAY RUNNER VIEW */}
          {gameState && (gameState.status === 'active' || gameState.status === 'completed') && (
            <GameCanvas
              activeGameId={activeGameId}
              gameState={gameState}
              onGameStateSync={handleGameStateSync}
              currentUser={currentUser}
              online={online}
              isHost={isHost}
              onLeaveGrid={handleLeaveLobby}
              onResetLobby={handleResetLobby}
            />
          )}
        </div>
      )}
    </div>
  );
}
