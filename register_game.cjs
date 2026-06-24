const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = '/servers/cloud/hub.db';
console.log(`Connecting to Hub database at ${dbPath}...`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to Hub database:', err.message);
    process.exit(1);
  }
  console.log('Connected successfully.');
});

db.serialize(() => {
  // 1. Register Gridlock Neon Application
  const appId = 'gridlock-neon';
  const isProd = process.env.DEPLOY_ENV === 'production';
  const devUrl = 'http://localhost:28005';
  const prodUrl = 'https://gridlock.kbs-cloud.com';

  db.get('SELECT id, prod_url FROM apps WHERE id = ?', [appId], (err, row) => {
    if (err) {
      console.error('Error querying apps table:', err.message);
      process.exit(1);
    }

    if (row) {
      console.log(`Application "${appId}" is already registered in the Hub. Updating URLs...`);
      const now = new Date().toISOString();
      if (isProd) {
        db.run('UPDATE apps SET dev_url = ?, prod_url = ?, updated_at = ? WHERE id = ?', [devUrl, prodUrl, now, appId], (updErr) => {
          if (updErr) console.error('Failed to update app URLs:', updErr.message);
          else console.log(`Application "${appId}" URLs updated for production.`);
        });
      } else {
        db.run('UPDATE apps SET dev_url = ?, updated_at = ? WHERE id = ?', [devUrl, now, appId], (updErr) => {
          if (updErr) console.error('Failed to update app URLs:', updErr.message);
          else console.log(`Application "${appId}" URLs updated for dev/testing.`);
        });
      }
    } else {
      console.log(`Registering application "${appId}"...`);
      const now = new Date().toISOString();
      const appData = {
        id: appId,
        title: "Gridlock Neon",
        developer: "KBS Cloud Games",
        publisher: "KBS Cloud",
        release_date: "June 2026",
        description: "Dodge shifting obstacles and collect memory shards in sync with the beat on an infinite synthwave perspective grid.",
        full_description: "Welcome to Gridlock Neon, a rhythm-based cyberpunk runner. Slide between lanes, jump over laser barriers, and slide under high obstructions. Sync your actions with the arpeggiator synth beats to boost your score, and deploy real-time sabotages to glitch your opponents off the track.",
        tags: JSON.stringify(["Rhythm", "Runner", "Multiplayer", "Synthwave"]),
        features: JSON.stringify([
          "Real-time procedural audio synthesizer",
          "Perspective visualizer grid and retro slicing sun",
          "SSO multiplayer presence tracking",
          "Real-time sabotage versus mechanics"
        ]),
        system_requirements: JSON.stringify({
          os: "Ubuntu 22.04+, Windows 10/11, macOS 12+",
          cpu: "Intel Core i5 / AMD Ryzen 5 or better",
          memory: "4 GB RAM",
          graphics: "Integrated Graphics",
          storage: "100 MB available space"
        }),
        prod_url: isProd ? prodUrl : null,
        dev_url: devUrl,
        github_url: "https://github.com/kbs-cloud/gridlock-neon",
        download_url: "https://github.com/kbs-cloud/gridlock-neon/releases",
        cover_image: "/gridlock_neon_cover.png",
        icon: "🏍️",
        is_online: 1,
        is_multiplayer: 1,
        app_token: "gridlock_neon_token_dev_777",
        created_at: now,
        updated_at: now
      };

      const fields = Object.keys(appData);
      const placeholders = fields.map(() => '?').join(', ');
      const sql = `INSERT INTO apps (${fields.join(', ')}) VALUES (${placeholders})`;
      
      db.run(sql, Object.values(appData), (insErr) => {
        if (insErr) {
          console.error('Failed to register application:', insErr.message);
          process.exit(1);
        }
        console.log(`Application "${appId}" registered successfully.`);
      });
    }
  });

  // 2. Register Achievements
  const achievements = [
    {
      id: 'gridlock_neon_survivor',
      app_id: appId,
      title: "Neon Survivor",
      description: "Completed a run of 1000m or more on the grid.",
      icon: "🏁",
      xp_value: 100,
      hidden: 0
    },
    {
      id: 'gridlock_neon_perfect',
      app_id: appId,
      title: "Perfect Rhythm",
      description: "Completed a run with full shields and no collisions.",
      icon: "💎",
      xp_value: 250,
      hidden: 0
    },
    {
      id: 'gridlock_neon_collector',
      app_id: appId,
      title: "Shard Collector",
      description: "Collected 50 or more memory shards in a single run.",
      icon: "⚡",
      xp_value: 150,
      hidden: 0
    }
  ];

  achievements.forEach((ach) => {
    db.get('SELECT id FROM achievements WHERE id = ?', [ach.id], (err, row) => {
      if (err) {
        console.error(`Error querying achievements for ${ach.id}:`, err.message);
        return;
      }

      if (row) {
        console.log(`Achievement "${ach.id}" is already registered.`);
      } else {
        console.log(`Registering achievement "${ach.id}"...`);
        const now = new Date().toISOString();
        db.run(
          'INSERT INTO achievements (id, app_id, title, description, icon, xp_value, hidden, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [ach.id, ach.app_id, ach.title, ach.description, ach.icon, ach.xp_value, ach.hidden, now],
          (insErr) => {
            if (insErr) {
              console.error(`Failed to register achievement "${ach.id}":`, insErr.message);
            } else {
              console.log(`Achievement "${ach.id}" registered successfully.`);
            }
          }
        );
      }
    });
  });
});
