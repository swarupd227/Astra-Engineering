/**
 * PM2 ecosystem config for the DevX 2.0 server on EC2.
 *
 * Why this exists:
 *   The 502 RCA showed a process that crashed at module-load time was being
 *   silently restarted by PM2 1600+ times, producing a permanent nginx 502
 *   upstream with no obvious symptom in `pm2 list` (status read "online" for
 *   a fraction of a second between crashes). The settings below force PM2
 *   to give up after a small number of fast crashes and mark the process
 *   `errored`, making this failure mode self-evident in `pm2 list` instead
 *   of producing a silent infinite loop.
 *
 * Usage on the EC2 host:
 *   pm2 delete devx 2>/dev/null || true
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 *
 *   # If startup hooks are not yet installed:
 *   pm2 startup systemd -u ec2-user --hp /home/ec2-user
 */

module.exports = {
  apps: [
    {
      name: 'devx',
      cwd: '/opt/devx',
      script: 'dist/index.cjs',
      exec_mode: 'fork',
      instances: 1,

      // Crash-loop guardrails:
      // - max_restarts caps how many times PM2 will retry before declaring
      //   the process errored.
      // - min_uptime says "anything that exits in <10s of starting counts as
      //   a fast crash". Module-load throws (like the import.meta.url bug)
      //   exit in milliseconds, so they hit this trip-wire instantly.
      // - restart_delay backs off slightly between attempts so logs are
      //   readable instead of being a continuous stream.
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      exp_backoff_restart_delay: 200,

      // Treat the process as healthy only after it has stayed up for 30s.
      listen_timeout: 30000,
      kill_timeout: 5000,

      // Hard memory ceiling: if the bundle leaks past 1.5GB, recycle.
      max_memory_restart: '1500M',

      env: {
        NODE_ENV: 'production',
        // Anchors filesystem-relative reads (specs/, recorded-scripts/, etc.)
        // to the install dir. See server/utils/module-paths.ts and the 502 RCA.
        DEVX_REPO_ROOT: '/opt/devx',
      },

      out_file: '/home/ec2-user/.pm2/logs/devx-out.log',
      error_file: '/home/ec2-user/.pm2/logs/devx-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
