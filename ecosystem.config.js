module.exports = {
  apps: [
    {
      name: 'worker-1',
      script: 'start:prod',
      env_production: {
        PORT: 4000,
      },
    },
    {
      name: 'worker-1',
      script: 'start:prod',
      env_production: {
        PORT: 4001,
      },
    },
  ],
};
