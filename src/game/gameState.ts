// Shared Game Engine State Machine for Gridlock Neon

export interface Player {
  id: string;
  name: string;
  assignedEmail: string | null;
  score: number;
  shield: number; // 0 to 3
  distance: number; // 0 to 1000m (reaches targetDistance)
  isDead: boolean;
  isFinished: boolean;
  isHost: boolean;
  isAi?: boolean;
  isLocal?: boolean;
  sabotagesReceived: string[]; // List of pending sabotages (e.g. 'glitch') to trigger client-side
}

export interface GameState {
  gameId: string;
  name: string;
  status: 'setup' | 'active' | 'completed';
  players: Player[];
  seed: number; // Random seed for track layout generation
  maxPlayers: number;
  targetDistance: number; // Race length in meters
  updatedAt: string;
}

// Simple ID generator
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Retro name generator
const NEON_PREFIXES = ["Viper", "Specter", "Glitch", "Vector", "Apex", "Razor", "Cyber", "Neon", "Chrome", "Retro", "Laser", "Synth"];
const NEON_NOUNS = ["Runner", "Rider", "Cycle", "Driver", "Gridder", "Tracker", "Glider", "Chaser", "Drifter", "Speeder", "Racer"];

export function generateRandomGameName(): string {
  const p = NEON_PREFIXES[Math.floor(Math.random() * NEON_PREFIXES.length)];
  const n = NEON_NOUNS[Math.floor(Math.random() * NEON_NOUNS.length)];
  return `${p} ${n} Gridway`;
}

export function isPlayerVacant(player: Player, status?: string): boolean {
  if (status && status !== 'setup') return false;
  return !player.isHost && !player.isAi && player.assignedEmail === null && player.name.startsWith('Apprentice ');
}

export function initializeGame(options: {
  name?: string;
  maxPlayers?: number;
  targetDistance?: number;
  hostName: string;
  hostEmail: string | null;
}): GameState {
  const gameId = generateId();
  const name = options.name?.trim() || generateRandomGameName();
  const maxPlayers = options.maxPlayers || 4;
  const targetDistance = options.targetDistance || 1000;
  const seed = Math.floor(Math.random() * 1000000);

  const host: Player = {
    id: 'player_1',
    name: options.hostName,
    assignedEmail: options.hostEmail,
    score: 0,
    shield: 3,
    distance: 0,
    isDead: false,
    isFinished: false,
    isHost: true,
    isLocal: true,
    sabotagesReceived: []
  };

  const players: Player[] = [host];
  for (let i = 2; i <= maxPlayers; i++) {
    players.push({
      id: `player_${i}`,
      name: `Apprentice ${i}`,
      assignedEmail: null,
      score: 0,
      shield: 3,
      distance: 0,
      isDead: false,
      isFinished: false,
      isHost: false,
      isLocal: true,
      sabotagesReceived: []
    });
  }

  return {
    gameId,
    name,
    status: 'setup',
    players,
    seed,
    maxPlayers,
    targetDistance,
    updatedAt: new Date().toISOString()
  };
}

export function executeAction(
  state: GameState,
  action: {
    type: 'start' | 'update_progress' | 'sabotage' | 'player_died' | 'player_finished' | 'reset';
    playerId: string;
    progress?: {
      score: number;
      shield: number;
      distance: number;
    };
    targetPlayerId?: string;
    sabotageType?: string;
  }
): GameState {
  // Deep copy state to prevent mutation side-effects
  const nextState: GameState = JSON.parse(JSON.stringify(state));
  nextState.updatedAt = new Date().toISOString();

  if (action.type === 'start') {
    if (nextState.status !== 'setup') {
      throw new Error('Game session has already started.');
    }
    nextState.status = 'active';
    // Clear AI coordinates and set them
    nextState.players.forEach(p => {
      p.score = 0;
      p.shield = 3;
      p.distance = 0;
      p.isDead = false;
      p.isFinished = false;
      p.sabotagesReceived = [];
    });
    return nextState;
  }

  if (action.type === 'reset') {
    nextState.status = 'setup';
    nextState.players.forEach(p => {
      p.score = 0;
      p.shield = 3;
      p.distance = 0;
      p.isDead = false;
      p.isFinished = false;
      p.sabotagesReceived = [];
    });
    return nextState;
  }

  // Find acting player
  const player = nextState.players.find(p => p.id === action.playerId);
  if (!player) {
    throw new Error(`Player slot ${action.playerId} not found.`);
  }

  if (nextState.status !== 'active') {
    // If game already finished, allow final updates but do not change core statuses
    if (action.type === 'update_progress' && action.progress) {
      player.score = action.progress.score;
      player.shield = action.progress.shield;
      player.distance = action.progress.distance;
    }
    return nextState;
  }

  if (action.type === 'update_progress' && action.progress) {
    player.score = action.progress.score;
    player.shield = action.progress.shield;
    player.distance = Math.min(action.progress.distance, nextState.targetDistance);

    if (player.shield <= 0 && !player.isDead) {
      player.isDead = true;
    }
    if (player.distance >= nextState.targetDistance && !player.isFinished) {
      player.isFinished = true;
    }

    // Check if game is completed
    const activePlayers = nextState.players.filter(p => !isPlayerVacant(p, nextState.status));
    const allDone = activePlayers.every(p => p.isDead || p.isFinished);
    if (allDone) {
      nextState.status = 'completed';
    }
  }

  else if (action.type === 'player_died') {
    player.isDead = true;
    
    // Check if game is completed
    const activePlayers = nextState.players.filter(p => !isPlayerVacant(p, nextState.status));
    const allDone = activePlayers.every(p => p.isDead || p.isFinished);
    if (allDone) {
      nextState.status = 'completed';
    }
  }

  else if (action.type === 'player_finished') {
    player.isFinished = true;
    player.distance = nextState.targetDistance;

    // Check if game is completed
    const activePlayers = nextState.players.filter(p => !isPlayerVacant(p, nextState.status));
    const allDone = activePlayers.every(p => p.isDead || p.isFinished);
    if (allDone) {
      nextState.status = 'completed';
    }
  }

  else if (action.type === 'sabotage') {
    if (!action.targetPlayerId) {
      throw new Error('Sabotage targetPlayerId is required.');
    }
    const targetPlayer = nextState.players.find(p => p.id === action.targetPlayerId);
    if (!targetPlayer) {
      throw new Error(`Sabotage target ${action.targetPlayerId} not found.`);
    }
    const sabType = action.sabotageType || 'glitch';
    targetPlayer.sabotagesReceived.push(sabType);
  }

  return nextState;
}
