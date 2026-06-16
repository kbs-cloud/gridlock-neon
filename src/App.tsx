import React, { useState, useEffect, useRef } from 'react';
import { authService, gameService } from './services';
import { isOnlineMode } from './services/api';
import { WebAudioSequencer } from './game/WebAudioSequencer';
import { isPlayerVacant } from './game/gameState';
import type { GameState, Player } from './game/gameState';

// SVG Icons
const Icons = {
  Grid: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect>
      <rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>
    </svg>
  ),
  User: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>
    </svg>
  ),
  Users: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
  ),
  Volume: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    </svg>
  ),
  Info: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  ),
  Zap: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
    </svg>
  )
};

// Procedural obstacle/note generator helper using seeded random
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  public next(): number {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
}

interface TrackElement {
  dist: number; // distance in meters
  lane: number; // 0 (left), 1 (center), 2 (right)
  type: 'obstacle' | 'jump_obstacle' | 'duck_obstacle' | 'note';
  collected?: boolean;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [online, setOnline] = useState<boolean>(isOnlineMode());
  const [games, setGames] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Active game session
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [connectedPlayers, setConnectedPlayers] = useState<string[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [myJoinStatus, setMyJoinStatus] = useState<string | null>(null);
  
  // Input forms
  const [newGameName, setNewGameName] = useState('');
  const [newGamePlayers, setNewGamePlayers] = useState(4);
  const [newGameDistance, setNewGameDistance] = useState(1000);
  const [joinInviteCode, setJoinInviteCode] = useState('');
  
  // Game running state
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [shield, setShield] = useState(3);
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [streak, setStreak] = useState(0);
  const [sabotages, setSabotages] = useState(0); // 0 to 5 for sabotage charge
  
  // Keyboard keys active
  const [jumpActive, setJumpActive] = useState(false);
  const [slideActive, setSlideActive] = useState(false);
  
  // UI states
  const [activeTab, setActiveTab] = useState<'lobby' | 'instructions' | 'leaderboard'>('lobby');
  const [localName, setLocalName] = useState(localStorage.getItem('gridlock_display_name') || 'Runner');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioSequencerRef = useRef<WebAudioSequencer | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  
  // Track Elements
  const trackElementsRef = useRef<TrackElement[]>([]);
  
  // Client coordinates for animations
  const playerLaneRef = useRef<number>(1); // 0, 1, 2
  const playerVisualXRef = useRef<number>(1); // lerped lane index
  const playerYOffsetRef = useRef<number>(0); // height offset for jump
  const playerSlideTimerRef = useRef<number>(0);
  const playerJumpTimerRef = useRef<number>(0);
  
  // Particles & Floating Scores
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number; color: string; life: number }>>([]);
  const floatersRef = useRef<Array<{ x: number; y: number; text: string; color: string; life: number }>>([]);
  const screenGlitchRef = useRef<number>(0); // screen glitch duration frames
  const lastBeatTimeRef = useRef<number>(0); // AudioContext.currentTime of last beat

  // Fetch session and games
  useEffect(() => {
    authService.initCSRF().then(() => {
      authService.checkSession().then((user: any) => {
        if (user) {
          setCurrentUser(user);
        }
      });
    });
  }, [online]);

  useEffect(() => {
    loadGamesList();
  }, [online, currentUser]);

  // Polling loops
  useEffect(() => {
    if (!activeGameId) return;

    // Fast polling during gameplay (1s)
    // Slower polling during lobby setup (2s)
    const intervalTime = isPlaying ? 1000 : 2000;
    
    const poll = setInterval(() => {
      refreshActiveGame();
    }, intervalTime);

    return () => clearInterval(poll);
  }, [activeGameId, isPlaying]);

  const loadGamesList = async () => {
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
    setIsPlaying(false);
    if (audioSequencerRef.current) {
      audioSequencerRef.current.stop();
    }
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
    const getAuthServerUrl = () => {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:20001';
      }
      return 'https://auth.kbs-cloud.com';
    };
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
    setIsPlaying(false);
  };

  const createNewGame = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await gameService.createGame(newGameName, newGamePlayers, newGameDistance);
      if (res.success && res.gameId) {
        setActiveGameId(res.gameId);
        setNewGameName('');
        refreshActiveGame(res.gameId);
      } else {
        setErrorMsg(res.error || 'Failed to create game.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Creation failed.');
    }
  };

  const joinGameByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!joinInviteCode.trim()) return;
    try {
      const res = await gameService.joinGame(joinInviteCode.trim().toUpperCase());
      if (res.success) {
        setActiveGameId(joinInviteCode.trim().toUpperCase());
        setJoinInviteCode('');
        refreshActiveGame(joinInviteCode.trim().toUpperCase());
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
        gameStateRef.current = nextState;
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

        // If game is active and we are not playing, but we are supposed to be, trigger launch
        const me = nextState.players.find(p => p.assignedEmail === myEmail || (online ? false : p.id === 'player_1'));
        if (nextState.status === 'active' && !isPlayingRef.current && me && !me.isDead && !me.isFinished) {
          launchGameSession();
        }

        // If game is reset / setup and we are playing, stop
        if (nextState.status === 'setup' && isPlayingRef.current) {
          stopGameSession();
        }

        // Handle remote sabotages received
        if (isPlayingRef.current && me && me.sabotagesReceived && me.sabotagesReceived.length > 0) {
          me.sabotagesReceived.forEach(sab => {
            triggerSabotageEffect(sab);
          });
          // Clear sabotages on server
          // In simple polling, let's process it client-side and post a clear or just process once
          // To prevent repeating, we clear the array locally and we'll post an update action
          me.sabotagesReceived = [];
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

  // --- GAME SESSION LAUNCH & ENGINE ---

  const generateTrack = (seed: number, targetDist: number): TrackElement[] => {
    const list: TrackElement[] = [];
    const rand = new SeededRandom(seed);
    
    // Spawn elements every 35-50 meters
    let curDist = 60;
    while (curDist < targetDist - 30) {
      const val = rand.next();
      const lane = Math.floor(rand.next() * 3);
      
      if (val < 0.25) {
        list.push({ dist: curDist, lane, type: 'note' });
      } else if (val < 0.5) {
        list.push({ dist: curDist, lane, type: 'obstacle' });
      } else if (val < 0.7) {
        list.push({ dist: curDist, lane, type: 'jump_obstacle' });
      } else if (val < 0.85) {
        list.push({ dist: curDist, lane, type: 'duck_obstacle' });
      } else {
        // Double note
        list.push({ dist: curDist, lane, type: 'note' });
        list.push({ dist: curDist, lane: (lane + 1) % 3, type: 'note' });
      }
      curDist += Math.floor(rand.next() * 15) + 35;
    }
    return list;
  };

  const launchGameSession = () => {
    if (!gameState) return;
    
    setIsPlaying(true);
    isPlayingRef.current = true;
    
    // Reset play metrics
    setShield(3);
    setScore(0);
    setDistance(0);
    setMultiplier(1);
    setStreak(0);
    setSabotages(0);
    
    playerLaneRef.current = 1;
    playerVisualXRef.current = 1;
    playerYOffsetRef.current = 0;
    playerJumpTimerRef.current = 0;
    playerSlideTimerRef.current = 0;
    particlesRef.current = [];
    floatersRef.current = [];
    screenGlitchRef.current = 0;

    // Generate tracks
    trackElementsRef.current = generateTrack(gameState.seed, gameState.targetDistance);

    // Start audio context sequencer
    if (!audioSequencerRef.current) {
      audioSequencerRef.current = new WebAudioSequencer();
    }
    audioSequencerRef.current.setVolume(volume);
    audioSequencerRef.current.start(handleSequencerBeat);
  };

  const stopGameSession = () => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (audioSequencerRef.current) {
      audioSequencerRef.current.stop();
    }
  };

  const handleSequencerBeat = (beatCount: number, time: number) => {
    lastBeatTimeRef.current = time;
    // visual pulse triggered via render loop querying lastBeatTimeRef
  };

  const triggerSabotageEffect = (type: string) => {
    if (audioSequencerRef.current) {
      audioSequencerRef.current.playSabotage();
    }
    
    screenGlitchRef.current = 24; // trigger heavy screen glitching visual for 24 frames
    
    // Add floating text
    floatersRef.current.push({
      x: 400,
      y: 150,
      text: "SABOTAGE GLITCH ACTIVATED!",
      color: '#ff007f',
      life: 60
    });
  };

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPlayingRef.current) return;
      
      const key = e.key.toLowerCase();
      const nowTime = audioSequencerRef.current ? (audioSequencerRef.current as any).audioCtx?.currentTime || 0 : 0;
      
      // Determine if action is rhythmic (within 120ms of a beat)
      let rhythmSync = false;
      if (lastBeatTimeRef.current > 0) {
        const bpm = 120;
        const secondsPerBeat = 60.0 / bpm;
        const diff = Math.abs(nowTime - lastBeatTimeRef.current);
        const diffNext = Math.abs(nowTime - (lastBeatTimeRef.current + secondsPerBeat));
        if (diff < 0.12 || diffNext < 0.12) {
          rhythmSync = true;
        }
      }

      if (key === 'a' || e.key === 'ArrowLeft') {
        // Move Left
        if (playerLaneRef.current > 0) {
          playerLaneRef.current--;
          if (audioSequencerRef.current) audioSequencerRef.current.playSlide();
          triggerRhythmActionFeedback(rhythmSync);
        }
      } else if (key === 'd' || e.key === 'ArrowRight') {
        // Move Right
        if (playerLaneRef.current < 2) {
          playerLaneRef.current++;
          if (audioSequencerRef.current) audioSequencerRef.current.playSlide();
          triggerRhythmActionFeedback(rhythmSync);
        }
      } else if (key === 'w' || e.key === 'ArrowUp') {
        // Jump
        if (playerJumpTimerRef.current <= 0 && playerSlideTimerRef.current <= 0) {
          playerJumpTimerRef.current = 25; // 25 frames
          setJumpActive(true);
          if (audioSequencerRef.current) audioSequencerRef.current.playJump();
          triggerRhythmActionFeedback(rhythmSync);
        }
      } else if (key === 's' || e.key === 'ArrowDown') {
        // Slide / Duck
        if (playerSlideTimerRef.current <= 0 && playerJumpTimerRef.current <= 0) {
          playerSlideTimerRef.current = 25;
          setSlideActive(true);
          if (audioSequencerRef.current) audioSequencerRef.current.playSlide();
          triggerRhythmActionFeedback(rhythmSync);
        }
      }
    };

    const triggerRhythmActionFeedback = (isSync: boolean) => {
      if (isSync) {
        setScore(s => s + 50);
        floatersRef.current.push({
          x: 400 + (Math.random() * 80 - 40),
          y: 200,
          text: "PERFECT BEAT! +50",
          color: '#00ffff',
          life: 40
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Post updates to server periodically during play
  useEffect(() => {
    if (!isPlaying || !activeGameId || !gameState) return;

    const myId = gameState.players.find(p => p.assignedEmail === (currentUser?.email || 'runner@local') || (online ? false : p.id === 'player_1'))?.id || 'player_1';

    const interval = setInterval(() => {
      gameService.performGameAction(activeGameId, {
        type: 'update_progress',
        playerId: myId,
        progress: { score, shield, distance }
      }, myId).then((res: any) => {
        if (res.success && res.gameState) {
          setGameState(res.gameState);
          gameStateRef.current = res.gameState;
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, score, shield, distance, activeGameId]);

  // Game tick / animation loop
  useEffect(() => {
    if (!isPlaying) return;

    let frameId: number;
    let localDist = 0;
    const maxDist = gameState?.targetDistance || 1000;
    const myId = gameState?.players.find(p => p.assignedEmail === (currentUser?.email || 'runner@local') || (online ? false : p.id === 'player_1'))?.id || 'player_1';

    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        frameId = requestAnimationFrame(tick);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      
      // Update local distance scroll speed
      // 0.25 meters per frame (approx 15 meters per second at 60fps)
      if (shield > 0 && localDist < maxDist) {
        localDist += 0.25;
        setDistance(Math.round(localDist));
      }

      // Check if finished
      if (localDist >= maxDist) {
        stopGameSession();
        gameService.performGameAction(activeGameId!, { type: 'player_finished', playerId: myId }, myId);
        refreshActiveGame();
        return;
      }

      // Check if dead
      if (shield <= 0) {
        stopGameSession();
        gameService.performGameAction(activeGameId!, { type: 'player_died', playerId: myId }, myId);
        refreshActiveGame();
        return;
      }

      // Perform AI simulation client-side for slots marked AI (Only host does this)
      const myEmail = currentUser?.email || 'runner@local';
      const isHost = gameStateRef.current?.players[0]?.assignedEmail === myEmail || gameStateRef.current?.players[0]?.assignedEmail === 'runner@local';
      if (isHost && gameStateRef.current) {
        gameStateRef.current.players.forEach(p => {
          if (p.isAi && !p.isDead && !p.isFinished) {
            // Simple AI driver: moves at steady pace, 80% chance avoiding obstacles, collects notes
            const aiDist = p.distance + 0.24; // slightly slower or same
            let aiScore = p.score;
            let aiShield = p.shield;
            let aiDead = p.isDead;
            let aiFinished = p.isFinished;

            // Generate AI collisions
            trackElementsRef.current.forEach(el => {
              if (Math.abs(el.dist - aiDist) < 0.25) {
                if (el.type === 'note') {
                  aiScore += 100;
                } else {
                  // Obstacle hit calculation
                  if (Math.random() > 0.85) {
                    aiShield--;
                    if (aiShield <= 0) aiDead = true;
                  }
                }
              }
            });

            if (aiDist >= maxDist) aiFinished = true;

            // Post AI progress
            gameService.performGameAction(activeGameId!, {
              type: 'update_progress',
              playerId: p.id,
              progress: { score: aiScore, shield: aiShield, distance: aiDist }
            }, p.id);
          }
        });
      }

      // --- RENDERING PIPELINE ---

      // Glitch shake
      ctx.save();
      if (screenGlitchRef.current > 0) {
        const shakeX = Math.random() * 20 - 10;
        const shakeY = Math.random() * 20 - 10;
        ctx.translate(shakeX, shakeY);
        screenGlitchRef.current--;
      }

      // Background Clear
      ctx.fillStyle = '#020108';
      ctx.fillRect(0, 0, width, height);

      // Draw Horizon Sliced Sun
      const horizonY = height * 0.45;
      const sunX = width / 2;
      const sunY = horizonY - 10;
      
      // Get analyser data to pulse sun
      let bassMultiplier = 1.0;
      if (audioSequencerRef.current) {
        const frequencies = audioSequencerRef.current.getAnalyserData();
        if (frequencies.length > 0) {
          const bassSum = frequencies[0] + frequencies[1] + frequencies[2];
          bassMultiplier = 1.0 + (bassSum / 768) * 0.15; // pulse up to 15%
        }
      }

      const sunRadius = 90 * bassMultiplier;
      const sunGrad = ctx.createLinearGradient(sunX, sunY - sunRadius, sunX, sunY + sunRadius);
      sunGrad.addColorStop(0, '#ff5e00');
      sunGrad.addColorStop(0.6, '#ff007f');
      sunGrad.addColorStop(1, '#aa3bff');

      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius, Math.PI, 0); // half circle above horizon
      ctx.fillStyle = sunGrad;
      ctx.fill();

      // Slices for Sun
      ctx.fillStyle = '#020108';
      const sliceCount = 8;
      for (let i = 0; i < sliceCount; i++) {
        const sliceY = sunY - sunRadius * (i / sliceCount);
        const sliceHeight = 1.5 + (i * 0.8);
        ctx.fillRect(sunX - sunRadius - 10, sliceY, sunRadius * 2 + 20, sliceHeight);
      }

      // Mountains (Purple outline)
      ctx.strokeStyle = '#4e148c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(120, horizonY - 40);
      ctx.lineTo(240, horizonY);
      ctx.lineTo(320, horizonY - 60);
      ctx.lineTo(400, horizonY - 20);
      ctx.lineTo(480, horizonY - 50);
      ctx.lineTo(580, horizonY);
      ctx.lineTo(680, horizonY - 30);
      ctx.lineTo(width, horizonY);
      ctx.stroke();

      // Draw Perspective Grid Lines
      const laneWidth = width / 3;
      
      // Scroll offset for horizontal lines
      // Calculate scroll offset based on localDist
      const scrollOffset = (localDist * 4) % 10; // speeds up scrolling

      ctx.strokeStyle = 'rgba(170, 59, 255, 0.4)';
      ctx.lineWidth = 1.5;
      
      // Dotted lane separators
      ctx.setLineDash([5, 15]);
      ctx.beginPath();
      ctx.moveTo(width * 0.33, horizonY);
      ctx.lineTo(0, height);
      ctx.moveTo(width * 0.66, horizonY);
      ctx.lineTo(width, height);
      ctx.stroke();
      ctx.setLineDash([]); // Reset line dash

      // Road side borders
      ctx.strokeStyle = varColor('--neon-cyan', '#00ffff');
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(width * 0.15, horizonY);
      ctx.lineTo(-50, height);
      ctx.moveTo(width * 0.85, horizonY);
      ctx.lineTo(width + 50, height);
      ctx.stroke();

      // Scroll horizontal grid lines down the screen
      ctx.strokeStyle = 'rgba(170, 59, 255, 0.35)';
      ctx.lineWidth = 1;
      const horizLineCount = 10;
      for (let i = 0; i < horizLineCount; i++) {
        const progress = ((i + scrollOffset / 10) % horizLineCount) / horizLineCount;
        // Exponential y position maps to 3D perspective
        const y = horizonY + (height - horizonY) * Math.pow(progress, 2.5);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Track Elements (Obstacles & Notes flying from horizon)
      // View range 120m ahead
      const renderElements = trackElementsRef.current.filter(el => el.dist > localDist && el.dist < localDist + 90 && !el.collected);
      
      renderElements.forEach(el => {
        const relDist = el.dist - localDist;
        const progress = 1.0 - (relDist / 90.0); // 0 at horizon, 1 at screen
        
        // Z mapping (perspective projection)
        const z = Math.pow(progress, 3); // accelerate size as it approaches
        
        const y = horizonY + (height - horizonY) * z;
        
        // Lane center x coordinate
        // Map lanes [0, 1, 2] to left, center, right coordinates
        // At horizon: narrow width. At bottom: full canvas width.
        const leftXHorizon = width * 0.25;
        const rightXHorizon = width * 0.75;
        const roadWidthHorizon = rightXHorizon - leftXHorizon;
        
        const roadWidthBottom = width * 1.5;
        const leftXBottom = -width * 0.25;
        
        const currentRoadWidth = roadWidthHorizon + (roadWidthBottom - roadWidthHorizon) * z;
        const currentLeftX = leftXHorizon + (leftXBottom - leftXHorizon) * z;
        
        const currentLaneWidth = currentRoadWidth / 3;
        const x = currentLeftX + el.lane * currentLaneWidth + currentLaneWidth / 2;
        
        // Calculate size based on distance
        const baseSize = el.type === 'note' ? 12 : 36;
        const size = baseSize * z;
        
        if (el.type === 'note') {
          // Draw diamond shard (Neon Cyan)
          ctx.strokeStyle = '#00ffff';
          ctx.fillStyle = 'rgba(0, 255, 255, 0.15)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y - size * 1.5);
          ctx.lineTo(x + size, y);
          ctx.lineTo(x, y + size * 1.5);
          ctx.lineTo(x - size, y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          
          // Small inner core
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(x, y - size * 0.6);
          ctx.lineTo(x + size * 0.4, y);
          ctx.lineTo(x, y + size * 0.6);
          ctx.lineTo(x - size * 0.4, y);
          ctx.closePath();
          ctx.fill();
        } else {
          // Draw Obstacle (Neon Pink wireframe blocks)
          ctx.strokeStyle = '#ff007f';
          ctx.fillStyle = 'rgba(255, 0, 127, 0.1)';
          ctx.lineWidth = 2;
          
          if (el.type === 'jump_obstacle') {
            // Draw low obstacle (requires jump)
            ctx.beginPath();
            ctx.rect(x - size * 1.2, y - size * 0.6, size * 2.4, size * 0.6);
            ctx.fill();
            ctx.stroke();
          } else if (el.type === 'duck_obstacle') {
            // Draw floating obstacle (requires slide/duck)
            ctx.beginPath();
            ctx.rect(x - size * 1.2, y - size * 2.0, size * 2.4, size * 0.8);
            ctx.fill();
            ctx.stroke();
          } else {
            // Standard lane block
            ctx.beginPath();
            ctx.rect(x - size * 1.1, y - size * 1.6, size * 2.2, size * 1.6);
            ctx.fill();
            ctx.stroke();
          }
        }

        // --- COLLISION CHECKING ---
        // Player position is z = 0.85
        if (relDist < 1.2) {
          // Target hit check!
          if (el.lane === playerLaneRef.current) {
            if (el.type === 'note') {
              // Shard Collected!
              el.collected = true;
              if (audioSequencerRef.current) audioSequencerRef.current.playCollect();
              setScore(s => s + 100);
              setStreak(st => {
                const nextSt = st + 1;
                if (nextSt % 10 === 0) setMultiplier(m => m + 1);
                return nextSt;
              });
              setSabotages(sab => Math.min(5, sab + 1));
              
              // Spark particle burst
              for (let pIdx = 0; pIdx < 12; pIdx++) {
                particlesRef.current.push({
                  x: width / 2,
                  y: height * 0.8,
                  vx: Math.random() * 8 - 4,
                  vy: Math.random() * 8 - 6,
                  color: '#00ffff',
                  life: 25 + Math.random() * 20
                });
              }
              
              floatersRef.current.push({
                x: x,
                y: y - 20,
                text: "+100 SHARD",
                color: '#00ffff',
                life: 30
              });
            } else {
              // Obstacle Collision!
              // Check if player avoided it using moves
              let avoided = false;
              if (el.type === 'jump_obstacle' && playerJumpTimerRef.current > 0) avoided = true;
              if (el.type === 'duck_obstacle' && playerSlideTimerRef.current > 0) avoided = true;
              
              if (!avoided) {
                el.collected = true; // prevent re-hits
                if (audioSequencerRef.current) audioSequencerRef.current.playCollision();
                setShield(sh => Math.max(0, sh - 1));
                setStreak(0);
                setMultiplier(1);
                screenGlitchRef.current = 12; // trigger screen shake
                
                // Exploding pink sparks
                for (let pIdx = 0; pIdx < 20; pIdx++) {
                  particlesRef.current.push({
                    x: width / 2,
                    y: height * 0.8,
                    vx: Math.random() * 12 - 6,
                    vy: Math.random() * 10 - 7,
                    color: '#ff007f',
                    life: 30 + Math.random() * 20
                  });
                }
                
                floatersRef.current.push({
                  x: x,
                  y: y - 20,
                  text: "SHIELD DEPLOYMENT FAIL",
                  color: '#ff007f',
                  life: 45
                });
              }
            }
          }
        }
      });

      // --- PLAYER RENDERING ---
      // Update physics for Jump & Slide
      if (playerJumpTimerRef.current > 0) {
        // Jump height parabolic arc
        // total frames = 25
        const progress = (25 - playerJumpTimerRef.current) / 25;
        playerYOffsetRef.current = Math.sin(progress * Math.PI) * 55; // jump up to 55px
        playerJumpTimerRef.current--;
        if (playerJumpTimerRef.current <= 0) setJumpActive(false);
      } else {
        playerYOffsetRef.current = 0;
      }

      if (playerSlideTimerRef.current > 0) {
        playerSlideTimerRef.current--;
        if (playerSlideTimerRef.current <= 0) setSlideActive(false);
      }

      // Smoothly interpolate player X lane switching
      const targetVisualX = playerLaneRef.current;
      playerVisualXRef.current += (targetVisualX - playerVisualXRef.current) * 0.22;
      
      const pXBottom = -width * 0.25;
      const pRoadWidthBottom = width * 1.5;
      const pLaneWidth = pRoadWidthBottom / 3;
      const playerX = pXBottom + playerVisualXRef.current * pLaneWidth + pLaneWidth / 2;
      const playerY = height * 0.85 - playerYOffsetRef.current;

      // Draw lightcycle tail trail grid lines (cyan/magenta beams receding to horizon)
      const tailXHorizon = width / 2;
      const tailYHorizon = horizonY;
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.45)';
      ctx.lineWidth = 4 * bassMultiplier;
      ctx.beginPath();
      ctx.moveTo(playerX, playerY + 5);
      ctx.lineTo(tailXHorizon, tailYHorizon);
      ctx.stroke();

      // Draw Player Cycle (sleek vector wireframe lightcycle)
      ctx.save();
      ctx.translate(playerX, playerY);
      
      const cycleScale = playerSlideTimerRef.current > 0 ? 0.55 : 1.0; // squash if sliding
      ctx.scale(1.0, cycleScale);

      // Lightcycle body glow shadow
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#00ffff';
      ctx.strokeStyle = '#00ffff';
      ctx.fillStyle = '#020108';
      ctx.lineWidth = 2.5;

      // Draw rear wheel
      ctx.beginPath();
      ctx.ellipse(-14, 0, 8, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();

      // Cycle frame
      ctx.beginPath();
      ctx.moveTo(-14, -6);
      ctx.lineTo(8, -12); // nose/canopy
      ctx.lineTo(18, 0); // front fork
      ctx.lineTo(6, 6);
      ctx.lineTo(-14, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();

      // Front wheel
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(14, 2, 6, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      
      // Canopy highlight cyan
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(6, -10);
      ctx.lineTo(10, -3);
      ctx.lineTo(0, -3);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // --- PARTICLES & FLOATERS PIPELINE ---
      // Update & render particles
      particlesRef.current.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15; // gravity
        p.life--;
        
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      });
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      // Update & render floating labels
      floatersRef.current.forEach((f, idx) => {
        f.y -= 0.6; // rise
        f.life--;
        
        ctx.fillStyle = f.color;
        ctx.font = 'bold 13px "Share Tech Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
      });
      floatersRef.current = floatersRef.current.filter(f => f.life > 0);

      ctx.restore(); // restore from shake translation

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, shield]);

  const deployGlitchSabotage = async (targetId: string) => {
    if (sabotages < 5 || !activeGameId) return;
    const myId = gameState?.players.find(p => p.assignedEmail === (currentUser?.email || 'runner@local') || (online ? false : p.id === 'player_1'))?.id || 'player_1';
    try {
      await gameService.performGameAction(activeGameId, {
        type: 'sabotage',
        playerId: myId,
        targetPlayerId: targetId,
        sabotageType: 'glitch'
      }, myId);
      setSabotages(0); // consume charge
      refreshActiveGame();
    } catch (e) {
      console.error(e);
    }
  };

  // Helper function to extract CSS variable color values safely
  const varColor = (varName: string, fallback: string): string => {
    if (typeof window === 'undefined') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  };

  const myEmail = currentUser?.email || 'runner@local';
  const myPlayer = gameState?.players.find(p => p.assignedEmail === myEmail || (online ? false : p.id === 'player_1'));
  const isHost = gameState?.players[0]?.assignedEmail === myEmail || gameState?.players[0]?.assignedEmail === 'runner@local';

  return (
    <div className="app-container">
      <header>
        <div>
          <h1>Gridlock Neon</h1>
          <p className="tagline">Synthwave Rhythm Runner & Cyber-Highway Racer</p>
        </div>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          {/* Online vs Offline Switch */}
          <div 
            className={`switch-container ${online ? 'active' : ''}`}
            onClick={handleOnlineToggle}
          >
            <span className="font-mono" style={{ fontSize: '0.85rem' }}>{online ? 'ONLINE (SSO)' : 'OFFLINE'}</span>
            <div className="switch-toggle"></div>
          </div>
          
          {/* Profile Section */}
          {online ? (
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
              <button className="btn outline-cyan" onClick={loadGamesList}>Refresh</button>
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
                              onClick={() => {
                                setActiveGameId(g.id);
                                refreshActiveGame(g.id);
                              }}
                            >
                              Sync
                            </button>
                            {((g.ownerEmail === 'runner@local' && !online) || (g.ownerEmail === currentUser?.email && online)) && (
                              <button 
                                className="btn outline-pink" 
                                style={{ padding: '6px 12px', fontSize: '0.75rem' }} 
                                onClick={() => handleDeleteGame(g.id)}
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
            <h2 className="text-neon-pink" style={{ fontSize: '1.2rem', marginBottom: '20px' }}>SPIN GRIDWAY</h2>
            
            {/* Create Lobby */}
            <form onSubmit={createNewGame} className="session-setup-form" style={{ marginBottom: '30px' }}>
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
            <form onSubmit={joinGameByCode} className="session-setup-form">
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
          </div>
        </div>
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
                onClick={() => { setActiveGameId(null); setGameState(null); }}
              >
                Abort Link
              </button>
            </div>
          )}

          {/* LOBBY SETUP SCREEN */}
          {gameState && gameState.status === 'setup' && (
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
                  <button className="btn outline-pink" onClick={() => { setActiveGameId(null); setGameState(null); }}>
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
          )}

          {/* ACTIVE GAMEPLAY RUNNER VIEW */}
          {gameState && (gameState.status === 'active' || gameState.status === 'completed') && (
            <div className="game-screen">
              {/* Left Side: Leaderboards & Connection List */}
              <div className="glass-panel cyan sidebar-panel">
                <h3 className="text-neon-cyan" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icons.Users /> GRID LEADERBOARD
                </h3>
                <div className="leaderboard-list">
                  {gameState.players
                    .filter(p => !isPlayerVacant(p, gameState.status))
                    .sort((a, b) => b.score - a.score)
                    .map((p, idx) => {
                      const isMe = p.assignedEmail === (currentUser?.email || 'runner@local') || (online ? false : p.id === 'player_1');
                      return (
                        <div 
                          className={`leaderboard-item ${p.isDead ? 'dead' : ''} ${p.isFinished ? 'finished' : ''} ${isMe ? 'me' : ''}`}
                          key={p.id}
                        >
                          <div>
                            <span style={{ marginRight: '8px', color: '#64748b' }}>{idx + 1}</span>
                            <span className="font-mono">{p.name}</span>
                            {p.isAi && <span style={{ fontSize: '0.65rem', marginLeft: '6px' }} className="badge pink">AI</span>}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div>{p.score} PTS</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{Math.round(p.distance)}m</div>
                          </div>
                        </div>
                      );
                    })}
                </div>

                <div style={{ marginTop: 'auto' }}>
                  <div className="font-mono" style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Icons.Info /> Active presence updates synced via multiplayer polling loops.
                  </div>
                </div>
              </div>

              {/* Center Screen: The Highway Canvas */}
              <div className="game-screen-center">
                {/* Visual Canvas container */}
                <div className="canvas-container">
                  <canvas ref={canvasRef} width="800" height="450" />
                  
                  {/* Overlay states */}
                  {gameState.status === 'completed' && (
                    <div className="canvas-overlay-text text-neon-cyan" style={{ width: '100%', pointerEvents: 'auto' }}>
                      <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }} className="text-neon-cyan">GRIDWAY RUN TERMINATED</h1>
                      
                      <div className="font-mono" style={{ margin: '20px 0', fontSize: '1.2rem' }}>
                        {(() => {
                          const winner = [...gameState.players]
                            .filter(p => !isPlayerVacant(p, gameState.status))
                            .sort((a, b) => b.score - a.score)[0];
                          return (
                            <div>
                              WINNING DRIVER: <span className="text-neon-pink">{winner ? winner.name : 'Unknown'}</span> ({winner ? winner.score : 0} PTS)
                            </div>
                          );
                        })()}
                      </div>
                      
                      <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '20px' }}>
                        {isHost ? (
                          <button className="btn primary-cyan" onClick={handleResetLobby}>Return to Lobby</button>
                        ) : (
                          <span className="font-mono" style={{ color: '#94a3b8' }}>Waiting for host to reset Gridway...</span>
                        )}
                        <button className="btn outline-pink" onClick={() => { setActiveGameId(null); setGameState(null); }}>Exit Grid</button>
                      </div>
                    </div>
                  )}

                  {!isPlaying && gameState.status === 'active' && myPlayer?.isDead && (
                    <div className="canvas-overlay-text text-neon-pink">
                      <h1 style={{ fontSize: '3rem', margin: '0 0 10px 0' }} className="text-neon-pink">CYCLE DESTROYED</h1>
                      <p className="font-mono" style={{ fontSize: '1.1rem', color: '#94a3b8', margin: '0 0 20px 0' }}>Shields depleted at {Math.round(distance)} meters.</p>
                      <span className="font-mono text-neon-cyan" style={{ fontSize: '0.9rem' }}>Spectating active pilots...</span>
                    </div>
                  )}

                  {!isPlaying && gameState.status === 'active' && myPlayer?.isFinished && (
                    <div className="canvas-overlay-text text-neon-cyan">
                      <h1 style={{ fontSize: '3rem', margin: '0 0 10px 0' }} className="text-neon-cyan">GATEWAY REACHED</h1>
                      <p className="font-mono" style={{ fontSize: '1.1rem', color: '#94a3b8', margin: '0 0 20px 0' }}>Finished track in {score} points.</p>
                      <span className="font-mono text-neon-pink" style={{ fontSize: '0.9rem' }}>Spectating remaining pilots...</span>
                    </div>
                  )}
                </div>

                {/* Progress bar tracks */}
                <div className="progress-tracks">
                  <div className="font-mono" style={{ fontSize: '0.8rem', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px', marginBottom: '6px' }}>
                    TRACK PROGRESS (GOAL: {gameState.targetDistance}m)
                  </div>
                  {gameState.players
                    .filter(p => !isPlayerVacant(p, gameState.status))
                    .map(p => {
                      const fillPct = Math.min(100, (p.distance / gameState.targetDistance) * 100);
                      return (
                        <div className="progress-track-row" key={p.id}>
                          <span className="track-name font-mono">{p.name}</span>
                          <div className="track-line">
                            <div className="track-fill" style={{ width: `${fillPct}%` }}></div>
                            <div 
                              className={`track-dot ${p.isDead ? 'dead' : ''} ${p.isFinished ? 'finished' : ''}`}
                              style={{ left: `${fillPct}%` }}
                            ></div>
                          </div>
                          <span className="font-mono" style={{ width: '45px', textAlign: 'right', fontSize: '0.8rem' }}>{Math.round(p.distance)}m</span>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Right Side: Local Player Statistics & Controls */}
              <div className="glass-panel sidebar-panel">
                <h3 className="text-neon-pink" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icons.User /> METRICS COCKPIT
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }} className="font-mono">
                  {/* Shields indicator */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '6px' }}>SHIELD INTEGRITY</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[1, 2, 3].map(sIdx => {
                        const active = (isPlaying ? shield : (myPlayer?.shield ?? 3)) >= sIdx;
                        return (
                          <div 
                            key={sIdx} 
                            style={{ 
                              flexGrow: '1', 
                              height: '10px', 
                              background: active ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.05)',
                              boxShadow: active ? '0 0 10px var(--neon-cyan)' : 'none',
                              borderRadius: '2px',
                              transition: 'all 0.2s'
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Multiplier / Score */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>MULTIPLIER</div>
                      <div className="text-neon-cyan" style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>x{isPlaying ? multiplier : 1}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>BEAT COMBO</div>
                      <div className="text-neon-pink" style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{isPlaying ? streak : 0}</div>
                    </div>
                  </div>

                  {/* Volume Dial */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Icons.Volume /> SYNTH VOLUME</span>
                      <span>{Math.round(volume * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.05" 
                      value={volume}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setVolume(val);
                        if (audioSequencerRef.current) {
                          audioSequencerRef.current.setVolume(val);
                        }
                      }}
                      style={{ width: '100%', accentColor: 'var(--neon-cyan)' }}
                    />
                  </div>

                  {/* Sabotage weapons deck (Versus only) */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '6px' }}>GLITCH SABOTAGE CHARGE</div>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
                      {[1, 2, 3, 4, 5].map(sIdx => {
                        const active = sabotages >= sIdx;
                        return (
                          <div 
                            key={sIdx} 
                            style={{ 
                              flexGrow: '1', 
                              height: '8px', 
                              background: active ? 'var(--neon-pink)' : 'rgba(255,255,255,0.03)',
                              boxShadow: active ? '0 0 8px var(--neon-pink)' : 'none',
                              borderRadius: '1px'
                            }}
                          />
                        );
                      })}
                    </div>
                    
                    {/* Sabotage targets selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {gameState.players
                        .filter(p => !isPlayerVacant(p, gameState.status) && p.id !== myPlayer?.id && !p.isDead && !p.isFinished)
                        .map(p => (
                          <button 
                            key={p.id}
                            className="btn outline-pink"
                            style={{ padding: '6px 10px', fontSize: '0.7rem', justifyContent: 'center' }}
                            disabled={sabotages < 5}
                            onClick={() => deployGlitchSabotage(p.id)}
                          >
                            <Icons.Zap /> GLITCH {p.name.toUpperCase()}
                          </button>
                        ))}
                      {gameState.players.filter(p => !isPlayerVacant(p, gameState.status) && p.id !== myPlayer?.id && !p.isDead && !p.isFinished).length === 0 && (
                        <div style={{ color: '#64748b', fontSize: '0.75rem', textAlign: 'center' }}>No active targets in lane.</div>
                      )}
                    </div>
                  </div>

                  {/* Control instructions */}
                  <div style={{ fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '15px' }}>
                    <div style={{ marginBottom: '4px' }}>CONTROLS:</div>
                    <div>• MOVE: A / D or Left / Right Arrows</div>
                    <div>• JUMP: W or Up Arrow</div>
                    <div>• SLIDE/DUCK: S or Down Arrow</div>
                    <div style={{ marginTop: '8px', color: 'var(--neon-cyan)' }}>* Action matching the beat of the arpeggio gives perfect points!</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
