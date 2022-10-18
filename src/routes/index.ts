import * as express from 'express';
import * as tokens from './routes';

export const register = (app: express.Application) => {
  // define a route handler for the default home page
  app.get('/', (req, res) => {
    res.send('OK');
  });

  app.get('/healthCheck', (req, res) => {
    res.send('OK');
  });

  tokens.register(app);
};
