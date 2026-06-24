#!/bin/bash
# Exit on error
set -e

REPO_DIR="/home/gemini/repos/kbs-cloud/gridlock-neon"
APP_NAME="gridlock-neon"
DEFAULT_OFFSET=5  # Offset in the port ranges

# Determine if we are deploying production or test
DEPLOY_ENV="testing"
if [ "$1" == "prod" ] || [ "$DEPLOY_TYPE" == "prod" ] || [ "$DEPLOY_ENV" == "production" ]; then
    DEPLOY_ENV="production"
fi

echo "=== Starting Gridlock Neon Deployment ($DEPLOY_ENV) ==="

# Find Node.js path (default to NVM directory if not in current PATH)
NODE_EXEC=$(which node || echo "/home/gemini/.nvm/versions/node/v24.16.0/bin/node")
NODE_BIN=$(dirname "$NODE_EXEC")
export PATH="$NODE_BIN:$PATH"

# Build the project
echo "Building project in $REPO_DIR..."
cd "$REPO_DIR"
npm run build

# Assign ports and directories based on environment
if [ "$DEPLOY_ENV" == "production" ]; then
    DEPLOY_DIR="/servers/$APP_NAME"
    FRONTEND_PORT=$((19000 + DEFAULT_OFFSET))
    BACKEND_PORT=$((20000 + DEFAULT_OFFSET))
    SERVICE_NAME="$APP_NAME"
    SERVICE_DESC="Gridlock Neon Production Service"
else
    DEPLOY_DIR="/servers/dev/$APP_NAME"
    FRONTEND_PORT=$((28000 + DEFAULT_OFFSET))
    BACKEND_PORT=$((29000 + DEFAULT_OFFSET))
    SERVICE_NAME="$APP_NAME-dev"
    SERVICE_DESC="Gridlock Neon Dev/Testing Service"
fi

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
echo "Configuring systemd service ($SERVICE_NAME)..."
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=$SERVICE_DESC
After=network.target

[Service]
Type=simple
User=gemini
WorkingDirectory=$DEPLOY_DIR
ExecStart=$NODE_BIN/node server.cjs
Restart=always
Environment=NODE_ENV=production BACKEND_PORT=$BACKEND_PORT FRONTEND_PORT=$FRONTEND_PORT DATABASE_PATH=$DEPLOY_DIR/gridlock_neon.db AUTH_SERVER_URL=http://localhost:20001 HUB_API_URL=http://localhost:20000 HUB_APP_TOKEN=gridlock_neon_token_dev_777
Environment="PATH=$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[Install]
WantedBy=multi-user.target
EOF

# Reload and restart service
echo "Reloading systemd and restarting $SERVICE_NAME service..."
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Run the database registration utility
echo "Registering application and achievements in the Hub catalog..."
DEPLOY_ENV=$DEPLOY_ENV node register_game.cjs

# Handle Git Tagging
if [ "$DEPLOY_ENV" == "production" ]; then
    echo "Creating release tags..."
    cd "$REPO_DIR"
    TAG_NAME="prod-$APP_NAME-v$(date +%Y%m%d-%H%M%S)"
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "Creating git tag $TAG_NAME..."
        git tag "$TAG_NAME"
        # Push tag, catch errors gracefully
        git push origin "$TAG_NAME" >/dev/null 2>&1 || echo "Warning: Could not push git tag to remote."
    fi
else
    echo "Skipping git tagging for test/dev deployment."
fi

echo "=== Deployment Finished Successfully ($DEPLOY_ENV) ==="
