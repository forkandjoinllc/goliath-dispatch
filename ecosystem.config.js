/**
 * PM2 process definition for running the Next.js server on a Forge box.
 *
 * PM2 rather than a Forge Daemon (Supervisor) on purpose: `pm2 reload` runs as
 * the `forge` user with no sudo, so the deploy script can restart the app
 * without a passwordless-sudo rule. `reload` also brings the new process up
 * before retiring the old one, so a deploy does not drop in-flight requests.
 */
module.exports = {
  apps: [
    {
      name: 'goliath-dispatch',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port ' + (process.env.PORT || 3000),
      cwd: __dirname,
      instances: process.env.PM2_INSTANCES || 2,
      exec_mode: 'cluster',
      max_memory_restart: '640M',
      // Next reads .env itself; PM2 only needs to know which mode to run in.
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      out_file: 'storage/logs/pm2-out.log',
      error_file: 'storage/logs/pm2-error.log',
      merge_logs: true,
      time: true,
      // A crash loop should back off rather than hammer the box.
      exp_backoff_restart_delay: 200,
      kill_timeout: 8000,
      listen_timeout: 15000,
    },
  ],
}
