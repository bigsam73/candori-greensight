module.exports = {
  apps: [{
    name: "candori-greensight",
    script: "server/app.js",
    node_args: "--max-old-space-size=4096",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "2G",
    env: {
      NODE_ENV: "production",
      PORT: 3001,
    },
    // 로그 설정
    log_file: "logs/combined.log",
    out_file: "logs/out.log",
    error_file: "logs/error.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    // 자동 재시작 설정
    exp_backoff_restart_delay: 1000,
    max_restarts: 50,
    restart_delay: 3000,
  }],
};
