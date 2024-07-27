module.exports = {
  apps: [
    {
      name: 'worker-1',
      script: 'PORT=4000 npm run start:prod',
    },
    {
      name: 'worker-1',
      script: 'PORT=4001 npm run start:prod',
    },
  ],
};
