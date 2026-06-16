// Gridlock Neon Backend Service (Express + SQLite)
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
} catch (e) {
  console.warn('Failed to load local environment file:', e.message);
}

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const { initializeGame, executeAction, isPlayerVacant, generateRandomGameName } = require('./src/game/dist/gameState.js');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.BACKEND_PORT || 29005;

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'gridlock_neon.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log(`Connected to ${dbPath} SQLite database.`);
  }
});

// Setup database tables
db.serialize(() => {
  db.run("PRAGMA journal_mode=WAL");
  
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      display_name TEXT,
      password_hash TEXT,
      is_google_linked INTEGER DEFAULT 0,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      created_at TEXT
    )
  `);

  // Sessions table
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      email TEXT,
      expires_at TEXT,
      csrf_token TEXT
    )
  `);

  // Games table
  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      invite_code TEXT UNIQUE,
      owner_email TEXT,
      name TEXT,
      game_state TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  // Join requests table
  db.run(`
    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT,
      email TEXT,
      display_name TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT
    )
  `);
  console.log('Database tables verified/created successfully.');
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());
app.use(cors({
  origin: true,
  credentials: true
}));

// In-memory presence tracker
const activePresence = new Map(); // gameId -> Map(email -> timestamp)

// In-memory pending auth requests for Electron browser-based polling
const pendingAuths = new Map();

// Periodic cleanup of expired tokens (> 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pendingAuths.entries()) {
    if (now - data.createdAt > 5 * 60 * 1000) {
      pendingAuths.delete(token);
    }
  }
}, 60000);

function updatePresence(gameId, email) {
  if (!activePresence.has(gameId)) {
    activePresence.set(gameId, new Map());
  }
  activePresence.get(gameId).set(email, Date.now());
}

function getPresence(gameId) {
  if (!activePresence.has(gameId)) return [];
  const now = Date.now();
  const list = [];
  for (const [email, ts] of activePresence.get(gameId).entries()) {
    if (now - ts < 10000) { // 10s timeout
      list.push(email);
    }
  }
  return list;
}

// CSRF Initialisation
app.get('/api/csrf-init', (req, res) => {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false,
    path: '/',
    sameSite: 'lax',
    secure: (req.secure || req.headers['x-forwarded-proto'] === 'https') && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1'
  });
  res.status(200).json({ success: true, csrfToken });
});

// CSRF Validation Middleware
function validateCSRF(req, res, next) {
  if (req.headers['x-session-id']) {
    return next();
  }
  const cookieToken = req.cookies['csrf_token'];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    console.warn('CSRF validation failed.');
    return res.status(403).json({ error: 'CSRF token validation failed.' });
  }
  next();
}

// Session User Retrieval Helper
function getSessionUser(req, callback) {
  const headerSessionId = req.headers['x-session-id'];
  const cookieSessionId = req.cookies['session_id'];

  if (!headerSessionId && !cookieSessionId) {
    return callback(null, null);
  }

  const now = new Date().toISOString();

  const querySession = (sid, next) => {
    db.get(
      `SELECT u.email, u.display_name, u.is_google_linked, u.games_played, u.games_won, u.password_hash 
       FROM sessions s 
       JOIN users u ON s.email = u.email 
       WHERE s.id = ? AND s.expires_at > ?`,
      [sid, now],
      (err, row) => {
        if (err || !row) return next(null);
        next({
          email: row.email,
          displayName: row.display_name,
          isGoogleLinked: row.is_google_linked === 1,
          hasPassword: row.password_hash !== null && row.password_hash !== undefined,
          stats: { gamesPlayed: row.games_played, gamesWon: row.games_won }
        });
      }
    );
  };

  if (headerSessionId) {
    querySession(headerSessionId, (user) => {
      if (user) {
        return callback(null, user);
      }
      if (cookieSessionId) {
        querySession(cookieSessionId, (cookieUser) => {
          callback(null, cookieUser);
        });
      } else {
        callback(null, null);
      }
    });
  } else {
    querySession(cookieSessionId, (user) => {
      callback(null, user);
    });
  }
}

// --- AUTHENTICATION ENDPOINTS ---

app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  const stateParams = new URLSearchParams(state || '');
  const isElectron = stateParams.get('source') === 'electron';
  const token = stateParams.get('token') || '';
  const isIframe = req.query.source === 'iframe';

  try {
    const authServerUrl = process.env.AUTH_SERVER_URL || 'http://localhost:20001';
    const tokenRes = await fetch(`${authServerUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_id: 'gridlock-neon' })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.success) {
      throw new Error(tokenData.error || 'Failed to exchange auth token.');
    }

    const { email, displayName } = tokenData.user;
    const finalDisplayName = displayName || email.split('@')[0];

    db.get('SELECT email FROM users WHERE email = ?', [email], (err, user) => {
      const finalizeLogin = () => {
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const csrfToken = crypto.randomBytes(24).toString('hex');

        db.run(
          'INSERT INTO sessions (id, email, expires_at, csrf_token) VALUES (?, ?, ?, ?)',
          [sessionId, email, expiresAt, csrfToken],
          (sessionErr) => {
            if (sessionErr) {
              if (isElectron && token) {
                pendingAuths.set(token, { error: 'session_fail', createdAt: Date.now() });
                return renderAuthResponseHtml(res, 'Session Error', 'SESSION DEPLOYMENT FAILURE', 'Failed to generate user session.', false);
              }
              if (isIframe) {
                return res.status(500).send('Session generation failed.');
              }
              return res.redirect('/?error=session_fail');
            }

            res.cookie('session_id', sessionId, {
              httpOnly: true,
              path: '/',
              sameSite: 'lax',
              secure: (req.secure || req.headers['x-forwarded-proto'] === 'https') && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1',
              maxAge: 24 * 60 * 60 * 1000
            });

            res.cookie('csrf_token', csrfToken, {
              httpOnly: false,
              path: '/',
              sameSite: 'lax',
              secure: (req.secure || req.headers['x-forwarded-proto'] === 'https') && req.hostname !== 'localhost' && req.hostname !== '127.0.0.1',
              maxAge: 24 * 60 * 60 * 1000
            });

            if (isElectron && token) {
              pendingAuths.set(token, { sessionId, createdAt: Date.now() });
              return renderAuthResponseHtml(res, 'Authenticated', 'PROTOCOL ESTABLISHED', 'Authenticated successfully. You can close this tab now.', true);
            }

            if (isIframe) {
              return res.send(`
                <!DOCTYPE html>
                <html>
                  <body>
                    <script>
                      if (window.opener) {
                        window.opener.postMessage({ type: 'SSO_LOGIN_SUCCESS' }, window.location.origin);
                      } else {
                        window.parent.postMessage({ type: 'SSO_LOGIN_SUCCESS' }, window.location.origin);
                      }
                    </script>
                  </body>
                </html>
              `);
            }

            res.redirect('/');
          }
        );
      };

      if (user) {
        db.run('UPDATE users SET display_name = ? WHERE email = ?', [finalDisplayName, email], () => {
          finalizeLogin();
        });
      } else {
        const now = new Date().toISOString();
        db.run(
          'INSERT INTO users (email, display_name, password_hash, is_google_linked, created_at) VALUES (?, ?, NULL, 0, ?)',
          [email, finalDisplayName, now],
          () => {
            finalizeLogin();
          }
        );
      }
    });
  } catch (error) {
    console.error('SSO callback exchange failed:', error);
    if (isElectron && token) {
      pendingAuths.set(token, { error: 'oauth_failed', createdAt: Date.now() });
      return renderAuthResponseHtml(res, 'Auth Error', 'AUTHENTICATION FAILURE', 'Failed to link SSO session.', false);
    }
    if (isIframe) {
      return res.status(500).send('SSO exchange failed.');
    }
    res.redirect('/?error=sso_failed');
  }
});

app.get('/api/me', (req, res) => {
  getSessionUser(req, (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Unauthorized.' });
    res.status(200).json({ success: true, user });
  });
});

app.post('/api/logout', (req, res) => {
  const sessionId = req.cookies['session_id'] || req.headers['x-session-id'];
  if (sessionId) {
    db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
  }
  res.clearCookie('session_id');
  res.clearCookie('csrf_token');
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/auth/google/config', (req, res) => {
  res.status(200).json({ enabled: true });
});

app.get('/api/auth/poll', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Missing token parameter.' });
  }

  const auth = pendingAuths.get(token);
  if (!auth) {
    return res.status(200).json({ status: 'pending' });
  }

  if (auth.error) {
    pendingAuths.delete(token);
    return res.status(200).json({ status: 'error', error: auth.error });
  }

  pendingAuths.delete(token);
  return res.status(200).json({ status: 'success', sessionId: auth.sessionId });
});

function renderAuthResponseHtml(res, title, header, message, isSuccess) {
  const primaryColor = isSuccess ? '#39ff14' : '#ff007f';
  const shadowColor = isSuccess ? 'rgba(57, 255, 20, 0.2)' : 'rgba(255, 0, 127, 0.2)';
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
        <style>
          body {
            background-color: #05030d;
            color: ${primaryColor};
            font-family: 'Share Tech Mono', monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          .container {
            border: 1px solid ${primaryColor};
            padding: 40px;
            background: rgba(0,0,0,0.85);
            box-shadow: 0 0 30px ${shadowColor};
            border-radius: 4px;
            max-width: 450px;
          }
          h1 {
            color: #00ffff;
            font-size: 24px;
            margin-bottom: 20px;
          }
          p {
            font-size: 15px;
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${header}</h1>
          <p>${message}</p>
        </div>
      </body>
    </html>
  `);
}

const HUB_API_URL = process.env.HUB_API_URL || 'http://localhost:20000';
const HUB_APP_TOKEN = process.env.HUB_APP_TOKEN || 'gridlock_neon_token_dev_777';

async function unlockHubAchievement(email, achievementId) {
  try {
    const res = await fetch(`${HUB_API_URL}/api/games-api/achievements/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': HUB_APP_TOKEN
      },
      body: JSON.stringify({ email, achievementId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      console.log(`Unlocked achievement ${achievementId} for ${email} in Hub.`);
    }
  } catch (err) {
    console.error(`Failed to connect to Hub achievements API:`, err.message);
  }
}

app.post('/api/stats', validateCSRF, (req, res) => {
  const { won } = req.body;
  getSessionUser(req, (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Unauthorized.' });

    const wonInc = won ? 1 : 0;
    db.run(
      'UPDATE users SET games_played = games_played + 1, games_won = games_won + ? WHERE email = ?',
      [wonInc, user.email],
      (updErr) => {
        if (updErr) return res.status(500).json({ error: 'Failed to update stats.' });
        
        db.get('SELECT games_played, games_won FROM users WHERE email = ?', [user.email], (selErr, row) => {
          if (selErr || !row) return res.status(200).json({ success: true });

          res.status(200).json({
            success: true,
            stats: { gamesPlayed: row.games_played, gamesWon: row.games_won }
          });
        });
      }
    );
  });
});

// --- GAMES API ENDPOINTS ---

app.get('/api/games', (req, res) => {
  getSessionUser(req, (err, user) => {
    const guestName = req.headers['x-guest-name'] || null;
    const effectiveEmail = user ? user.email : guestName;

    if (!effectiveEmail) return res.status(401).json({ error: 'Authentication required.' });

    db.all(
      'SELECT id, invite_code, owner_email, name, game_state, created_at, updated_at FROM games WHERE owner_email = ? OR game_state LIKE ? ORDER BY updated_at DESC',
      [effectiveEmail, `%"assignedEmail":"${effectiveEmail}"%`],
      (queryErr, rows) => {
        if (queryErr) return res.status(500).json({ error: 'Database query failed.' });

        const gamesList = rows.map(row => {
          let parsedState = {};
          try { parsedState = JSON.parse(row.game_state); } catch (e) {}
          return {
            id: row.id,
            inviteCode: row.invite_code,
            ownerEmail: row.owner_email,
            name: row.name,
            gameState: parsedState,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        });

        res.status(200).json({ success: true, games: gamesList, totalCount: gamesList.length });
      }
    );
  });
});

app.post('/api/games', validateCSRF, (req, res) => {
  getSessionUser(req, (err, user) => {
    const guestName = req.headers['x-guest-name'] || null;
    const effectiveEmail = user ? user.email : guestName;

    if (!effectiveEmail) return res.status(401).json({ error: 'Authentication required.' });

    const { name, setupOptions } = req.body;
    let gameName = name ? name.trim() : '';
    if (!gameName) {
      gameName = generateRandomGameName();
    }

    const maxPlayers = setupOptions?.maxPlayers || 4;
    const targetDistance = setupOptions?.targetDistance || 1000;

    const initialOptions = {
      name: gameName,
      hostName: user ? (user.displayName || effectiveEmail.split('@')[0]) : effectiveEmail,
      hostEmail: effectiveEmail,
      maxPlayers,
      targetDistance
    };

    let gameState;
    try {
      gameState = initializeGame(initialOptions);
    } catch (initErr) {
      console.error(initErr);
      return res.status(500).json({ error: 'Game initialization failed.' });
    }

    const gameId = gameState.gameId;
    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 char code
    const now = new Date().toISOString();
    const gameStateStr = JSON.stringify(gameState);

    db.run(
      'INSERT INTO games (id, invite_code, owner_email, name, game_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [gameId, inviteCode, effectiveEmail, gameName, gameStateStr, now, now],
      (insErr) => {
        if (insErr) {
          console.error(insErr.message);
          return res.status(500).json({ error: 'Failed to create game.' });
        }
        res.status(201).json({ success: true, gameId, inviteCode, name: gameName });
      }
    );
  });
});

app.get('/api/games/:id', (req, res) => {
  getSessionUser(req, (err, user) => {
    const gameId = req.params.id;
    const guestName = req.headers['x-guest-name'] || null;
    const presenceEmail = user ? user.email : guestName;

    db.get('SELECT * FROM games WHERE id = ? OR invite_code = ?', [gameId, gameId], (queryErr, row) => {
      if (queryErr || !row) return res.status(404).json({ error: 'Game not found.' });

      let parsedState = {};
      try { parsedState = JSON.parse(row.game_state); } catch (e) {}

      if (presenceEmail) {
        updatePresence(row.id, presenceEmail);
      }

      res.status(200).json({
        success: true,
        connectedPlayers: getPresence(row.id),
        game: {
          id: row.id,
          inviteCode: row.invite_code,
          ownerEmail: row.owner_email,
          name: row.name,
          gameState: parsedState,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }
      });
    });
  });
});

app.delete('/api/games/:id', validateCSRF, (req, res) => {
  getSessionUser(req, (err, user) => {
    const gameId = req.params.id;
    db.run('DELETE FROM games WHERE id = ?', [gameId], (delErr) => {
      if (delErr) return res.status(500).json({ error: 'Delete failed.' });
      res.status(200).json({ success: true, message: 'Game deleted.' });
    });
  });
});

app.post('/api/games/:id/presence', validateCSRF, (req, res) => {
  const gameId = req.params.id;
  getSessionUser(req, (err, user) => {
    const guestName = req.headers['x-guest-name'] || null;
    const presenceEmail = user ? user.email : guestName;

    if (presenceEmail) {
      updatePresence(gameId, presenceEmail);
    }
    res.status(200).json({ success: true, connectedPlayers: getPresence(gameId) });
  });
});

// Join requests
app.post('/api/games/:gameId/join', validateCSRF, (req, res) => {
  const { gameId } = req.params;
  getSessionUser(req, (err, user) => {
    const guestName = req.headers['x-guest-name'] || null;
    const email = user ? user.email : guestName;

    if (!email) return res.status(401).json({ error: 'Identification required.' });

    const displayName = user ? (user.displayName || email.split('@')[0]) : email;
    const now = new Date().toISOString();

    db.get('SELECT id FROM join_requests WHERE game_id = ? AND email = ?', [gameId, email], (findErr, row) => {
      if (row) return res.status(200).json({ success: true, message: 'Request already submitted.' });

      db.run(
        'INSERT INTO join_requests (game_id, email, display_name, status, created_at) VALUES (?, ?, ?, "pending", ?)',
        [gameId, email, displayName, now],
        function (insErr) {
          if (insErr) return res.status(500).json({ error: 'Failed to request join.' });
          res.status(200).json({ success: true, joinId: this.lastID, message: 'Request submitted.' });
        }
      );
    });
  });
});

app.get('/api/games/:gameId/join-requests', (req, res) => {
  const { gameId } = req.params;
  db.all('SELECT id, email, display_name, status, created_at FROM join_requests WHERE game_id = ? AND status = "pending"', [gameId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    res.status(200).json({ success: true, requests: rows });
  });
});

app.get('/api/games/:gameId/my-join-status', (req, res) => {
  const { gameId } = req.params;
  getSessionUser(req, (err, user) => {
    const guestName = req.headers['x-guest-name'] || null;
    const email = user ? user.email : guestName;

    if (!email) return res.status(200).json({ success: true, status: null });

    db.get('SELECT id, status FROM join_requests WHERE game_id = ? AND email = ?', [gameId, email], (findErr, row) => {
      if (findErr) return res.status(500).json({ error: 'Database error.' });
      if (!row) return res.status(200).json({ success: true, status: null });
      res.status(200).json({ success: true, status: row.status, joinId: row.id });
    });
  });
});

app.post('/api/games/:gameId/assign-slot', validateCSRF, (req, res) => {
  const { gameId } = req.params;
  const { playerId, email, joinRequestId, isAi, isLocal, name } = req.body;

  if (!playerId) return res.status(400).json({ error: 'playerId required.' });

  db.get('SELECT game_state FROM games WHERE id = ?', [gameId], (err, game) => {
    if (err || !game) return res.status(404).json({ error: 'Game not found.' });

    let state;
    try { state = JSON.parse(game.game_state); } catch (e) {
      return res.status(500).json({ error: 'State corrupt.' });
    }

    const player = state.players.find(p => p.id === playerId);
    if (!player) return res.status(404).json({ error: 'Player slot not found.' });

    if (isAi) {
      player.isAi = true;
      player.assignedEmail = `ai_${playerId}@gridlock.ai`;
      player.name = name || `AI Gridder`;
      player.isLocal = false;
    } else {
      player.isAi = false;
      const useLocal = isLocal !== undefined ? !!isLocal : !email;
      if (useLocal) {
        player.assignedEmail = null;
        player.isLocal = true;
        player.name = name || `Apprentice ${playerId.split('_')[1]}`;
      } else {
        player.assignedEmail = email ? email.trim().toLowerCase() : null;
        player.isLocal = false;
        player.name = name || (email ? email.trim().split('@')[0] : `Apprentice ${playerId.split('_')[1]}`);
      }
    }

    const stateStr = JSON.stringify(state);
    db.run('UPDATE games SET game_state = ?, updated_at = ? WHERE id = ?', [stateStr, new Date().toISOString(), gameId], (updErr) => {
      if (updErr) return res.status(500).json({ error: 'Update failed.' });

      const targetEmail = player.assignedEmail;
      if (targetEmail && joinRequestId) {
        db.run('UPDATE join_requests SET status = "accepted" WHERE id = ?', [joinRequestId]);
      } else if (targetEmail) {
        db.run('UPDATE join_requests SET status = "accepted" WHERE game_id = ? AND email = ?', [gameId, targetEmail]);
      }
      res.status(200).json({ success: true, message: 'Slot assigned.' });
    });
  });
});

app.post('/api/games/:gameId/reject-join', validateCSRF, (req, res) => {
  const { gameId } = req.params;
  const { joinRequestId } = req.body;
  if (!joinRequestId) return res.status(400).json({ error: 'joinRequestId required.' });

  db.run('UPDATE join_requests SET status = "rejected" WHERE id = ? AND game_id = ?', [joinRequestId, gameId], function(err) {
    if (err) return res.status(500).json({ error: 'Failed to reject.' });
    res.status(200).json({ success: true, message: 'Join request rejected.' });
  });
});

// Dispatch game action
app.post('/api/games/:id/action', validateCSRF, (req, res) => {
  const gameId = req.params.id;
  const { action, playerId } = req.body;

  if (!action || !playerId) return res.status(400).json({ error: 'Action and playerId required.' });

  getSessionUser(req, (err, user) => {
    const guestName = req.headers['x-guest-name'] || null;
    const email = user ? user.email : guestName;
    const normalizedEmail = email ? email.trim().toLowerCase() : null;

    db.get('SELECT owner_email, game_state FROM games WHERE id = ?', [gameId], (dbErr, game) => {
      if (dbErr || !game) return res.status(404).json({ error: 'Game not found.' });

      let state;
      try { state = JSON.parse(game.game_state); } catch (e) {
        return res.status(500).json({ error: 'Corrupt game state.' });
      }

      const player = state.players.find(p => p.id === playerId);
      if (!player) return res.status(404).json({ error: 'Player slot not found.' });

      const isOwner = !game.owner_email || (normalizedEmail && game.owner_email.trim().toLowerCase() === normalizedEmail);
      const isAssigned = normalizedEmail && player.assignedEmail && player.assignedEmail.trim().toLowerCase() === normalizedEmail;
      const isAuthorized = isAssigned || (player.isLocal && isOwner);

      if (action.type === 'start' || action.type === 'reset') {
        if (!isOwner) {
          return res.status(403).json({ error: 'Only the game host can modify session status.' });
        }
      } else {
        if (!isAuthorized) {
          return res.status(403).json({ error: 'Unauthorized action for this player slot.' });
        }
      }

      // Execute action in state machine
      let nextState;
      try {
        nextState = executeAction(state, action);
      } catch (errExec) {
        return res.status(400).json({ error: errExec.message || 'Action failed.' });
      }

      const nextStateStr = JSON.stringify(nextState);

      db.run('UPDATE games SET game_state = ?, updated_at = ? WHERE id = ?', [nextStateStr, new Date().toISOString(), gameId], (updErr) => {
        if (updErr) return res.status(500).json({ error: 'Failed to update database game state.' });
        
        // If completed, trigger achievements check
        if (nextState.status === 'completed' && state.status !== 'completed') {
          nextState.players.forEach(p => {
            if (p.assignedEmail) {
              // 1. Neon Survivor: reached 1000m or targetDistance
              if (p.distance >= nextState.targetDistance) {
                unlockHubAchievement(p.assignedEmail, 'gridlock_neon_survivor');
              }
              // 2. Perfect Rhythm: full shields and score > 2000 (meaning no collisions)
              if (p.shield === 3 && p.score >= 2000) {
                unlockHubAchievement(p.assignedEmail, 'gridlock_neon_perfect');
              }
              // 3. Memory Shard Collector: score >= 5000 (each note is e.g. 100 points, so collected 50 shards)
              if (p.score >= 5000) {
                unlockHubAchievement(p.assignedEmail, 'gridlock_neon_collector');
              }
            }
          });
        }

        res.status(200).json({ success: true, gameState: nextState });
      });
    });
  });
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Gridlock Neon backend listening on port ${PORT}`);
});

if (process.env.FRONTEND_PORT && String(process.env.FRONTEND_PORT) !== String(PORT)) {
  const frontendApp = express();
  const http = require('http');

  // Proxy API requests to the backend server
  frontendApp.all('/api/*splat', (req, res) => {
    const connector = http.request({
      host: 'localhost',
      port: PORT,
      path: req.originalUrl,
      method: req.method,
      headers: req.headers
    }, (connectorRes) => {
      res.writeHead(connectorRes.statusCode, connectorRes.headers);
      connectorRes.pipe(res);
    });

    req.pipe(connector);

    connector.on('error', (err) => {
      console.error('Gridlock Neon frontend proxy error:', err);
      res.status(502).send('Bad Gateway');
    });
  });

  frontendApp.use(express.static(path.join(__dirname, 'dist')));
  frontendApp.get('*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
  frontendApp.listen(process.env.FRONTEND_PORT, () => {
    console.log(`Gridlock Neon static frontend server running on port ${process.env.FRONTEND_PORT}`);
  });
}
