import { logger } from './helpers/logger';
import * as process from 'process';
import createApp from './app';

const init = async () => {
  const port = process.env.PORT || '3000';
  const app = createApp();
  app.listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });
};

init().then(() => {
  logger.info('Server started successfully');
}).catch((err) => {
  logger.error('Error starting server', err);
  process.exit(1);
});


