# 🏍️ Gridlock Neon

Gridlock Neon is a rhythm-based cyberpunk runner game integrated with the KBS Cloud platform. Players steer a lightcycle on an infinite synthwave perspective grid, dodging barriers and collecting shards to synth beats.

## 🕹️ Game Overview

* **Genre**: Rhythm-based Cyber-Runner
* **Visuals**: Synthwave grid expanding to a neon horizon, neon pink obstacles, glowing blue collectible notes, grid pulse matching sound bass.

## ⚙️ Core Loops
1. **Lanes**: Dodge shifting hurdles by sliding between 3 lanes on a grid.
2. **Beats**: Slide/jump in sync with background music beats.
3. **Collect**: Collect memory shards to power up shields and multiply scores.

## 🛠️ Technical Stack
- **Frontend**: React, TypeScript, Vite
- **Renderer**: HTML5 Canvas with custom perspective projection
- **Audio**: Web Audio API with real-time synthesizer and rhythm beat detection
- **Backend**: Express, SQLite (for presence, scoreboards, and multiplayer)

## 🚀 Getting Started

### Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```

### Production Deployment
Run the deployment script to compile the frontend, install production node modules, configure the systemd service, and register the app in the KBS Cloud Hub catalog:
```bash
./deploy.sh
```

## 📄 License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
