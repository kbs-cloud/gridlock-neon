import React, { useState, useEffect, useRef } from 'react';
import { gameService } from '../services';
import { isPlayerVacant } from '../game/gameState';
import type { GameState, Player } from '../game/gameState';
import { SeededRandom } from '../game/SeededRandom';
import { generateTrack } from '../game/trackGenerator';
import type { TrackElement } from '../game/trackGenerator';
import { WebAudioSequencer } from '../game/WebAudioSequencer';
import { Icons } from './Icons';

interface GameCanvasProps {
  activeGameId: string;
  gameState: GameState;
  onGameStateSync: (nextState: GameState) => void;
  currentUser: any;
  online: boolean;
  isHost: boolean;
  onLeaveGrid: () => void;
  onResetLobby: () => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  activeGameId,
  gameState,
  onGameStateSync,
  currentUser,
  online,
  isHost,
  onLeaveGrid,
  onResetLobby
}) => {
  // Game running state
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [shield, setShield] = useState(3);
  const [score, setScore] = useState(0);
  const [distance, setDistance] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [streak, setStreak] = useState(0);
  const [sabotages, setSabotages] = useState(0); // 0 to 5 for sabotage charge

  const [jumpActive, setJumpActive] = useState(false);
  const [slideActive, setSlideActive] = useState(false);

  // References
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioSequencerRef = useRef<WebAudioSequencer | null>(null);
  const gameStateRef = useRef<GameState>(gameState);
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

  // Keep gameStateRef in sync
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const myEmail = currentUser?.email || 'runner@local';
  const myPlayer = gameState.players.find(p => p.assignedEmail === myEmail || (online ? false : p.id === 'player_1'));
  const myId = myPlayer?.id || 'player_1';

  // Trigger game session launch when component mounts if active
  useEffect(() => {
    if (gameState.status === 'active' && !isPlayingRef.current && myPlayer && !myPlayer.isDead && !myPlayer.isFinished) {
      launchGameSession();
    }
    return () => {
      stopGameSession();
    };
  }, []);

  // Listen for remote sabotages
  useEffect(() => {
    if (isPlayingRef.current && myPlayer && myPlayer.sabotagesReceived && myPlayer.sabotagesReceived.length > 0) {
      myPlayer.sabotagesReceived.forEach(sab => {
        triggerSabotageEffect(sab);
      });
      myPlayer.sabotagesReceived = [];
    }
  }, [gameState, isPlaying]);

  const launchGameSession = () => {
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
    trackElementsRef.current = generateTrack(gameStateRef.current.seed, gameStateRef.current.targetDistance);

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
  };

  const triggerSabotageEffect = (type: string) => {
    if (audioSequencerRef.current) {
      audioSequencerRef.current.playSabotage();
    }
    screenGlitchRef.current = 24; // trigger heavy screen glitching visual for 24 frames
    floatersRef.current.push({
      x: 400,
      y: 150,
      text: "SABOTAGE GLITCH ACTIVATED!",
      color: '#ff007f',
      life: 60
    });
  };

  const checkRhythmSync = (): boolean => {
    const nowTime = audioSequencerRef.current ? (audioSequencerRef.current as any).audioCtx?.currentTime || 0 : 0;
    if (lastBeatTimeRef.current > 0) {
      const bpm = 120;
      const secondsPerBeat = 60.0 / bpm;
      const diff = Math.abs(nowTime - lastBeatTimeRef.current);
      const diffNext = Math.abs(nowTime - (lastBeatTimeRef.current + secondsPerBeat));
      if (diff < 0.12 || diffNext < 0.12) {
        return true;
      }
    }
    return false;
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

  const performMoveLeft = () => {
    if (!isPlayingRef.current) return;
    const rhythmSync = checkRhythmSync();
    if (playerLaneRef.current > 0) {
      playerLaneRef.current--;
      if (audioSequencerRef.current) audioSequencerRef.current.playSlide();
      triggerRhythmActionFeedback(rhythmSync);
    }
  };

  const performMoveRight = () => {
    if (!isPlayingRef.current) return;
    const rhythmSync = checkRhythmSync();
    if (playerLaneRef.current < 2) {
      playerLaneRef.current++;
      if (audioSequencerRef.current) audioSequencerRef.current.playSlide();
      triggerRhythmActionFeedback(rhythmSync);
    }
  };

  const performJump = () => {
    if (!isPlayingRef.current) return;
    const rhythmSync = checkRhythmSync();
    if (playerJumpTimerRef.current <= 0 && playerSlideTimerRef.current <= 0) {
      playerJumpTimerRef.current = 25;
      setJumpActive(true);
      if (audioSequencerRef.current) audioSequencerRef.current.playJump();
      triggerRhythmActionFeedback(rhythmSync);
    }
  };

  const performSlide = () => {
    if (!isPlayingRef.current) return;
    const rhythmSync = checkRhythmSync();
    if (playerSlideTimerRef.current <= 0 && playerJumpTimerRef.current <= 0) {
      playerSlideTimerRef.current = 25;
      setSlideActive(true);
      if (audioSequencerRef.current) audioSequencerRef.current.playSlide();
      triggerRhythmActionFeedback(rhythmSync);
    }
  };

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPlayingRef.current) return;
      const key = e.key.toLowerCase();
      if (key === 'a' || e.key === 'ArrowLeft') {
        performMoveLeft();
      } else if (key === 'd' || e.key === 'ArrowRight') {
        performMoveRight();
      } else if (key === 'w' || e.key === 'ArrowUp') {
        performJump();
      } else if (key === 's' || e.key === 'ArrowDown') {
        performSlide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Post updates to server periodically during play
  useEffect(() => {
    if (!isPlaying || !activeGameId) return;
    const interval = setInterval(() => {
      gameService.performGameAction(activeGameId, {
        type: 'update_progress',
        playerId: myId,
        progress: { score, shield, distance }
      }, myId).then((res: any) => {
        if (res.success && res.gameState) {
          onGameStateSync(res.gameState);
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
    const maxDist = gameStateRef.current.targetDistance || 1000;

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
      if (shield > 0 && localDist < maxDist) {
        localDist += 0.25;
        setDistance(Math.round(localDist));
      }

      // Check if finished
      if (localDist >= maxDist) {
        stopGameSession();
        gameService.performGameAction(activeGameId, { type: 'player_finished', playerId: myId }, myId)
          .then(res => { if (res.success && res.gameState) onGameStateSync(res.gameState); });
        return;
      }

      // Check if dead
      if (shield <= 0) {
        stopGameSession();
        gameService.performGameAction(activeGameId, { type: 'player_died', playerId: myId }, myId)
          .then(res => { if (res.success && res.gameState) onGameStateSync(res.gameState); });
        return;
      }

      // Perform AI simulation client-side (Only host does this)
      if (isHost && gameStateRef.current) {
        gameStateRef.current.players.forEach(p => {
          if (p.isAi && !p.isDead && !p.isFinished) {
            const aiDist = p.distance + 0.24;
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
                  if (Math.random() > 0.85) {
                    aiShield--;
                    if (aiShield <= 0) aiDead = true;
                  }
                }
              }
            });

            if (aiDist >= maxDist) aiFinished = true;

            // Post AI progress
            gameService.performGameAction(activeGameId, {
              type: 'update_progress',
              playerId: p.id,
              progress: { score: aiScore, shield: aiShield, distance: aiDist }
            }, p.id).then(res => { if (res.success && res.gameState) onGameStateSync(res.gameState); });
          }
        });
      }

      // --- RENDERING PIPELINE ---
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
      
      let bassMultiplier = 1.0;
      if (audioSequencerRef.current) {
        const frequencies = audioSequencerRef.current.getAnalyserData();
        if (frequencies.length > 0) {
          const bassSum = frequencies[0] + frequencies[1] + frequencies[2];
          bassMultiplier = 1.0 + (bassSum / 768) * 0.15;
        }
      }

      const sunRadius = 90 * bassMultiplier;
      const sunGrad = ctx.createLinearGradient(sunX, sunY - sunRadius, sunX, sunY + sunRadius);
      sunGrad.addColorStop(0, '#ff5e00');
      sunGrad.addColorStop(0.6, '#ff007f');
      sunGrad.addColorStop(1, '#aa3bff');

      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius, Math.PI, 0);
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

      // Mountains
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
      const scrollOffset = (localDist * 4) % 10;

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

      // Scroll horizontal grid lines down
      ctx.strokeStyle = 'rgba(170, 59, 255, 0.35)';
      ctx.lineWidth = 1;
      const horizLineCount = 10;
      for (let i = 0; i < horizLineCount; i++) {
        const progress = ((i + scrollOffset / 10) % horizLineCount) / horizLineCount;
        const y = horizonY + (height - horizonY) * Math.pow(progress, 2.5);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Track Elements
      const renderElements = trackElementsRef.current.filter(el => el.dist > localDist && el.dist < localDist + 90 && !el.collected);
      
      renderElements.forEach(el => {
        const relDist = el.dist - localDist;
        const progress = 1.0 - (relDist / 90.0);
        const z = Math.pow(progress, 3);
        const y = horizonY + (height - horizonY) * z;
        
        const leftXHorizon = width * 0.25;
        const rightXHorizon = width * 0.75;
        const roadWidthHorizon = rightXHorizon - leftXHorizon;
        
        const roadWidthBottom = width * 1.5;
        const leftXBottom = -width * 0.25;
        
        const currentRoadWidth = roadWidthHorizon + (roadWidthBottom - roadWidthHorizon) * z;
        const currentLeftX = leftXHorizon + (leftXBottom - leftXHorizon) * z;
        
        const currentLaneWidth = currentRoadWidth / 3;
        const x = currentLeftX + el.lane * currentLaneWidth + currentLaneWidth / 2;
        
        const baseSize = el.type === 'note' ? 12 : 36;
        const size = baseSize * z;
        
        if (el.type === 'note') {
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
          
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(x, y - size * 0.6);
          ctx.lineTo(x + size * 0.4, y);
          ctx.lineTo(x, y + size * 0.6);
          ctx.lineTo(x - size * 0.4, y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.strokeStyle = '#ff007f';
          ctx.fillStyle = 'rgba(255, 0, 127, 0.1)';
          ctx.lineWidth = 2;
          
          if (el.type === 'jump_obstacle') {
            ctx.beginPath();
            ctx.rect(x - size * 1.2, y - size * 0.6, size * 2.4, size * 0.6);
            ctx.fill();
            ctx.stroke();
          } else if (el.type === 'duck_obstacle') {
            ctx.beginPath();
            ctx.rect(x - size * 1.2, y - size * 2.0, size * 2.4, size * 0.8);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.rect(x - size * 1.1, y - size * 1.6, size * 2.2, size * 1.6);
            ctx.fill();
            ctx.stroke();
          }
        }

        // Collision Check
        if (relDist < 1.2) {
          if (el.lane === playerLaneRef.current) {
            if (el.type === 'note') {
              el.collected = true;
              if (audioSequencerRef.current) audioSequencerRef.current.playCollect();
              setScore(s => s + 100);
              setStreak(st => {
                const nextSt = st + 1;
                if (nextSt % 10 === 0) setMultiplier(m => m + 1);
                return nextSt;
              });
              setSabotages(sab => Math.min(5, sab + 1));
              
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
              let avoided = false;
              if (el.type === 'jump_obstacle' && playerJumpTimerRef.current > 0) avoided = true;
              if (el.type === 'duck_obstacle' && playerSlideTimerRef.current > 0) avoided = true;
              
              if (!avoided) {
                el.collected = true;
                if (audioSequencerRef.current) audioSequencerRef.current.playCollision();
                setShield(sh => Math.max(0, sh - 1));
                setStreak(0);
                setMultiplier(1);
                screenGlitchRef.current = 12;
                
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

      // Update Player Physics
      if (playerJumpTimerRef.current > 0) {
        const progress = (25 - playerJumpTimerRef.current) / 25;
        playerYOffsetRef.current = Math.sin(progress * Math.PI) * 55;
        playerJumpTimerRef.current--;
        if (playerJumpTimerRef.current <= 0) setJumpActive(false);
      } else {
        playerYOffsetRef.current = 0;
      }

      if (playerSlideTimerRef.current > 0) {
        playerSlideTimerRef.current--;
        if (playerSlideTimerRef.current <= 0) setSlideActive(false);
      }

      playerVisualXRef.current += (playerLaneRef.current - playerVisualXRef.current) * 0.22;
      
      const pXBottom = -width * 0.25;
      const pRoadWidthBottom = width * 1.5;
      const pLaneWidth = pRoadWidthBottom / 3;
      const playerX = pXBottom + playerVisualXRef.current * pLaneWidth + pLaneWidth / 2;
      const playerY = height * 0.85 - playerYOffsetRef.current;

      // Draw Lightcycle Tail Trail
      const tailXHorizon = width / 2;
      const tailYHorizon = horizonY;
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.45)';
      ctx.lineWidth = 4 * bassMultiplier;
      ctx.beginPath();
      ctx.moveTo(playerX, playerY + 5);
      ctx.lineTo(tailXHorizon, tailYHorizon);
      ctx.stroke();

      // Draw Player Cycle
      ctx.save();
      ctx.translate(playerX, playerY);
      const cycleScale = playerSlideTimerRef.current > 0 ? 0.55 : 1.0;
      ctx.scale(1.0, cycleScale);

      ctx.shadowBlur = 15;
      ctx.shadowColor = '#00ffff';
      ctx.strokeStyle = '#00ffff';
      ctx.fillStyle = '#020108';
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      ctx.ellipse(-14, 0, 8, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-14, -6);
      ctx.lineTo(8, -12);
      ctx.lineTo(18, 0);
      ctx.lineTo(6, 6);
      ctx.lineTo(-14, 6);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(14, 2, 6, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(6, -10);
      ctx.lineTo(10, -3);
      ctx.lineTo(0, -3);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Particles & Floaters
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.life--;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      });
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      floatersRef.current.forEach(f => {
        f.y -= 0.6;
        f.life--;
        ctx.fillStyle = f.color;
        ctx.font = 'bold 13px "Share Tech Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
      });
      floatersRef.current = floatersRef.current.filter(f => f.life > 0);

      ctx.restore();

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, shield]);

  const deployGlitchSabotage = async (targetId: string) => {
    if (sabotages < 5) return;
    try {
      await gameService.performGameAction(activeGameId, {
        type: 'sabotage',
        playerId: myId,
        targetPlayerId: targetId,
        sabotageType: 'glitch'
      }, myId);
      setSabotages(0);
    } catch (e) {
      console.error(e);
    }
  };

  const varColor = (varName: string, fallback: string): string => {
    if (typeof window === 'undefined') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  };

  return (
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
              const isMe = p.assignedEmail === myEmail || (online ? false : p.id === 'player_1');
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
                  <button className="btn primary-cyan" onClick={onResetLobby}>Return to Lobby</button>
                ) : (
                  <span className="font-mono" style={{ color: '#94a3b8' }}>Waiting for host to reset Gridway...</span>
                )}
                <button className="btn outline-pink" onClick={onLeaveGrid}>Exit Grid</button>
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

        {/* Mobile HUD & Controls */}
        <div className="mobile-gameplay-ui">
          <div className="mobile-hud glass-panel">
            <div className="mobile-hud-row">
              <div className="mobile-hud-metric">
                <span className="metric-label font-mono">SHIELDS</span>
                <div className="mobile-shield-bar">
                  {[1, 2, 3].map(sIdx => {
                    const active = (isPlaying ? shield : (myPlayer?.shield ?? 3)) >= sIdx;
                    return (
                      <div 
                        key={sIdx} 
                        className={`shield-segment ${active ? 'active' : ''}`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="mobile-hud-metric text-right">
                <span className="metric-label font-mono">COMBO</span>
                <span className="metric-value pink font-mono">{isPlaying ? streak : 0}</span>
              </div>

              <div className="mobile-hud-metric text-right">
                <span className="metric-label font-mono">SCORE</span>
                <span className="metric-value cyan font-mono">{isPlaying ? score : myPlayer?.score ?? 0}</span>
              </div>
            </div>

            <div className="mobile-hud-row bottom-row">
              <div className="mobile-hud-metric">
                <span className="metric-label font-mono">SABOTAGE</span>
                <div className="mobile-sabotage-bar">
                  {[1, 2, 3, 4, 5].map(sIdx => {
                    const active = sabotages >= sIdx;
                    return (
                      <div 
                        key={sIdx} 
                        className={`sabotage-segment ${active ? 'active' : ''}`}
                      />
                    );
                  })}
                </div>
              </div>
              
              {gameState.players
                .filter(p => !isPlayerVacant(p, gameState.status) && p.id !== myPlayer?.id && !p.isDead && !p.isFinished)
                .length > 0 && (
                  <div className="mobile-sabotage-targets">
                    {gameState.players
                      .filter(p => !isPlayerVacant(p, gameState.status) && p.id !== myPlayer?.id && !p.isDead && !p.isFinished)
                      .map(p => (
                        <button 
                          key={p.id}
                          className="btn outline-pink mobile-sabotage-btn"
                          disabled={sabotages < 5}
                          onClick={() => deployGlitchSabotage(p.id)}
                        >
                          GLITCH {p.name.split(' ')[0].toUpperCase()}
                        </button>
                      ))}
                  </div>
              )}
            </div>
          </div>

          {/* Virtual Controls */}
          <div className="mobile-controls">
            <div className="mobile-control-section movement-keys">
              <button 
                className="btn virtual-btn arrow-btn left-btn"
                onTouchStart={(e) => { e.preventDefault(); performMoveLeft(); }}
                onClick={performMoveLeft}
              >
                ◀
              </button>
              <button 
                className="btn virtual-btn arrow-btn right-btn"
                onTouchStart={(e) => { e.preventDefault(); performMoveRight(); }}
                onClick={performMoveRight}
              >
                ▶
              </button>
            </div>

            <div className="mobile-control-section action-keys">
              <button 
                className="btn virtual-btn action-btn jump-btn"
                onTouchStart={(e) => { e.preventDefault(); performJump(); }}
                onClick={performJump}
              >
                JUMP
              </button>
              <button 
                className="btn virtual-btn action-btn slide-btn"
                onTouchStart={(e) => { e.preventDefault(); performSlide(); }}
                onClick={performSlide}
              >
                SLIDE
              </button>
            </div>
          </div>
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
  );
};
