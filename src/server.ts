import { CancellationToken } from '@velcro/common';
import { Logger } from 'pino';
import { BundlerService } from './bundler';
import { BundlePayload } from './codec/bundlePayload';
import { Server } from './framework';

export interface StartServerOptions {
  address?: string;
  bundler: BundlerService;
  logger: Logger;
  port?: number;
  token: CancellationToken;
}

export async function startServer(options: StartServerOptions) {
  const server = createServer(options);

  await server.start();
}

export function createServer(options: StartServerOptions) {
  const { bundler, logger } = options;
  const server = new Server({
    address: options.address ?? 'localhost',
    logger,
    port: options.port ?? 0,
    token: options.token,
  });

  server.route({
    method: 'POST',
    path: '/bundle',
    validators: {
      payload: BundlePayload,
    },
    handler: async (request) => {
      return bundler.bundle({
        entrypoints: request.payload.entrypoints,
        env: request.payload.env,
        files: request.payload.files,
        token: request.token,
      });
    },
  });

  return server;
}

