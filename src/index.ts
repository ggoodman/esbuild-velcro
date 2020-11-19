import { CancellationTokenSource } from '@velcro/common';
import Pino from 'pino';
import { BundlerServiceImpl } from './bundler';
import { startServer } from './server';

async function main() {
  const logger = Pino({
    prettyPrint: process.env.NODE_ENV !== 'production',
  });
  const tokenSource = new CancellationTokenSource();
  const bundler = new BundlerServiceImpl({ token: tokenSource.token });

  const onSignal: NodeJS.SignalsListener = (signal) => {
    logger.fatal({ signal }, 'signal received, initiating shutdown');

    tokenSource.dispose(true);
  };

  const onUncaught: NodeJS.UncaughtExceptionListener = (err) => {
    logger.fatal({ err }, 'uncaught exception throw, initiating shutdown');

    tokenSource.dispose(true);
  };

  process.on('SIGINT', onSignal).on('SIGTERM', onSignal).on('uncaughtException', onUncaught);

  await startServer({
    bundler,
    logger,
    port: process.env.PORT ? Number(process.env.PORT) : 0,
    token: tokenSource.token,
  });
}

main().catch((e) => {
  console.error(e);
  throw e;
});
