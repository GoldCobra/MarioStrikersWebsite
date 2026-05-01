// PM2 process manager config for the Mario Strikers API backend.
//
// Usage:
//   pm2 start deploy/ecosystem.config.js    ← first start
//   pm2 reload msc-api                      ← zero-downtime reload after update
//   pm2 save                                ← persist across reboots
//   pm2 startup                             ← auto-start on server boot
//
// Run from the project root (/var/www/msc or wherever you uploaded the project).

module.exports = {
  apps: [
    {
      name: "msc-api",
      script: "src/index.js",
      cwd: "./backend",        // relative to project root; .env must live in ./backend/
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production"
      },
      // Redirect stdout/stderr to log files next to this config
      out_file: "./deploy/logs/api-out.log",
      error_file: "./deploy/logs/api-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};
