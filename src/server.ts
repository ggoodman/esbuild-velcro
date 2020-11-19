import * as Boom from '@hapi/boom';
import * as Hapi from '@hapi/hapi';
import { CancellationToken, CancellationTokenSource } from '@velcro/common';
import { isLeft } from 'fp-ts/lib/Either';
import { Logger } from 'pino';
import * as HapiPino from 'hapi-pino';
import * as t from 'io-ts';
import { BundlerService } from './bundler';
import { BundlePayload } from './codec/bundlePayload';
import { formatValidationErrors } from './validation/reporter';

export interface StartServerOptions {
  address?: string;
  bundler: BundlerService;
  logger: Logger;
  port?: number;
  token: CancellationToken;
}

export async function startServer(options: StartServerOptions) {
  const { bundler, logger } = options;
  const server = new Hapi.Server({
    address: options.address ?? 'localhost',
    port: options.port ?? 0,
  });

  options.token.onCancellationRequested(() => server.stop());

  await server.register({
    plugin: HapiPino,
    options: {
      instance: logger,
      logRequestStart: false,
      logRequestComplete: false,
    },
  });

  server.route({
    method: 'POST',
    path: '/bundle',
    options: {
      validate: {
        payload: codecToValidator('payload', BundlePayload),
      },
      handler: async (request, h) => {
        const tokenSource = new CancellationTokenSource();

        request.events.once('disconnect', () => tokenSource.dispose(true));

        const payload = request.payload as BundlePayload;
        return bundler.bundle({
          files: payload.files,
          token: tokenSource.token,
        });
      },
    },
  });

  await server.start();
}

function codecToValidator<TCodec extends t.Any>(
  kind: string,
  codec: TCodec
): (value: object | Buffer | string) => Promise<t.TypeOf<TCodec>> {
  return async function (value: object | Buffer | string) {
    if (Buffer.isBuffer(value)) {
      value = value.toString('utf-8');
    }

    if (typeof value === 'string') {
      value = JSON.parse(value);
    }

    const result = codec.decode(value);

    if (isLeft(result)) {
      const errors = formatValidationErrors(result.left, { truncateLongTypes: true })
        .map((line) => `\t${line}`)
        .join('\n');

      console.log(value);

      throw Boom.badRequest(`Validation failed for the ${kind}:\n${errors}`);
    }

    return result.right;
  };
}
