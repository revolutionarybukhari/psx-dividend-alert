// PM2 ecosystem manifest. Named ".cjs" because the rest of the repo is ESM
// and PM2 reads this file synchronously with require().
//
//   pm2 start ecosystem.config.cjs
//   pm2 save                         # persist across reboots
//   pm2 logs psx-dividend-alert
//
// Logs land in ./logs/. Set NODE_ENV=production to disable pretty-printed
// pino output (we want JSON in long-running deployments so log shippers can
// parse it).

module.exports = {
  apps: [
    {
      name: 'psx-dividend-alert',
      script: 'src/index.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5_000,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
