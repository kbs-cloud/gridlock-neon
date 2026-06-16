#!/bin/bash
# Exit on error
set -e

DEPLOY_DIR="/servers/gridlock-neon"
REPO_DIR="/home/gemini/repos/kbs-cloud/gridlock-neon"

# Find Node.js path (default to NVM directory if not in current PATH)
NODE_EXEC=$(which node || echo "/home/gemini/.nvm/versions/node/v24.16.0/bin/node")
NODE_BIN=$(dirname "$NODE_EXEC")

echo "=== Starting Gridlock Neon Deployment ==="
echo "Node binary directory: $NODE_BIN"

# Ensure NVM node directory is at the front of PATH so npm works correctly
export PATH="$NODE_BIN:$PATH"

# Default fallback environment variables
BACKEND_PORT=20005
FRONTEND_PORT=19005
DATABASE_PATH="$DEPLOY_DIR/gridlock_neon.db"
AUTH_SERVER_URL="http://localhost:20001"
HUB_API_URL="http://localhost:20000"
HUB_APP_TOKEN="gridlock_neon_token_dev_777"

# Load local .env from project root if it exists
if [ -f "$REPO_DIR/.env" ]; then
    echo "Loading variables from local .env..."
    # Export vars, filtering out comments and blank lines
    export $(grep -v '^#' "$REPO_DIR/.env" | grep -v '^\s*$' | xargs)
fi

# Override with central /projects/environments/gridlock-neon.env if present
if [ -f "/projects/environments/gridlock-neon.env" ]; then
    echo "Loading variables from central gridlock-neon.env..."
    export $(grep -v '^#' "/projects/environments/gridlock-neon.env" | grep -v '^\s*$' | xargs)
fi

# Print loaded environment (safe variables only)
echo "Target Configuration:"
echo "  FRONTEND_PORT: $FRONTEND_PORT"
echo "  BACKEND_PORT:  $BACKEND_PORT"
echo "  AUTH_SERVER_URL: $AUTH_SERVER_URL"
echo "  HUB_API_URL:    $HUB_API_URL"

# Build the project
echo "Building project in $REPO_DIR..."
cd "$REPO_DIR"
npm run build

# Prepare deploy folder
echo "Preparing deploy folder at $DEPLOY_DIR..."
if [ ! -d "$DEPLOY_DIR" ]; then
    sudo mkdir -p "$DEPLOY_DIR"
    sudo chown -R gemini:gemini "$DEPLOY_DIR"
fi

# Copy built files and package files
echo "Copying files to $DEPLOY_DIR..."
mkdir -p "$DEPLOY_DIR/src/game/dist"
mkdir -p "$DEPLOY_DIR/dist"

cp -R dist/* "$DEPLOY_DIR/dist/"
cp -R src/game/dist/* "$DEPLOY_DIR/src/game/dist/"
cp server.cjs "$DEPLOY_DIR/"
cp package.json package-lock.json "$DEPLOY_DIR/"
cp register_game.cjs "$DEPLOY_DIR/"

# Copy symlink or actual .env file to the deploy folder
if [ -f "$REPO_DIR/.env" ]; then
    cp -L "$REPO_DIR/.env" "$DEPLOY_DIR/.env"
fi

# Preserve SQLite database if it exists in repo but not in deploy dir
if [ -f "$REPO_DIR/gridlock_neon.db" ] && [ ! -f "$DEPLOY_DIR/gridlock_neon.db" ]; then
    echo "Copying existing database to $DEPLOY_DIR..."
    cp "$REPO_DIR/gridlock_neon.db" "$DEPLOY_DIR/gridlock_neon.db"
fi

# Install production dependencies
echo "Installing production node modules in $DEPLOY_DIR..."
cd "$DEPLOY_DIR"
npm ci --omit=dev

# Write systemd service file
echo "Configuring systemd service..."
SERVICE_FILE="/etc/systemd/system/gridlock-neon.service"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Gridlock Neon Game Service
After=network.target

[Service]
Type=simple
User=gemini
WorkingDirectory=$DEPLOY_DIR
ExecStart=$NODE_BIN/node server.cjs
Restart=always
Environment=NODE_ENV=production BACKEND_PORT=$BACKEND_PORT FRONTEND_PORT=$FRONTEND_PORT DATABASE_PATH=$DATABASE_PATH AUTH_SERVER_URL=$AUTH_SERVER_URL HUB_API_URL=$HUB_API_URL HUB_APP_TOKEN=$HUB_APP_TOKEN
Environment="PATH=$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target
EOF

# Reload and restart service
echo "Reloading systemd and restarting gridlock-neon service..."
sudo systemctl daemon-reload
sudo systemctl enable gridlock-neon
sudo systemctl restart gridlock-neon

# Run the database registration utility
echo "Registering application and achievements in the Hub catalog..."
node register_game.cjs

echo "=== Deployment Finished Successfully ==="
