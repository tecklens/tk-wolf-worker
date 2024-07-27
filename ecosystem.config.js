module.exports = {
  apps: [
    {
      name: 'worker-1',
      script: 'npm run start:prod',
      env_production: {
        NODE_PORT: '4000',
      },
    },
    {
      name: 'worker-1',
      script: 'npm run start:prod',
      env_production: {
        NODE_PORT: '4001',
      },
    },
  ],
};
