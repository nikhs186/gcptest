module.exports = {
  apps: [
    {
      name: "lisi-api",
      script: "lib/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
