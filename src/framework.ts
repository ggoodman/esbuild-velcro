import * as Hapi from '@hapi/hapi';
import { CancellationToken, CancellationTokenSource, DisposableStore } from '@velcro/common';
import * as HapiPino from 'hapi-pino';
import * as t from 'io-ts';
import { Logger } from 'pino';
import { codecToValidator } from './validator';

interface Validators {
  payload?: t.Any;
}

interface ValidatedRequest<TValidators extends Validators> extends Omit<Hapi.Request, 'payload'> {
  payload: [TValidators['payload']] extends [t.Any] ? t.TypeOf<TValidators['payload']> : unknown;
  token: CancellationToken;
}

interface Handler<TValidators extends Validators, TRequest = ValidatedRequest<TValidators>> {
  (request: TRequest, h: Hapi.ResponseToolkit): Hapi.Lifecycle.ReturnValue;
}

export class Server {
  private readonly disposer = new DisposableStore();
  private readonly hapi: Hapi.Server;
  readonly logger: Logger;

  constructor(options: {
    address: string;
    logger: Logger;
    port: number;
    token: CancellationToken;
  }) {
    this.hapi = new Hapi.Server({
      address: options.address,
      port: options.port,
    });
    this.logger = options.logger;

    this.disposer.add(options.token.onCancellationRequested(() => this.hapi.stop()));
  }

  dispose() {
    this.disposer.dispose();
    this.hapi.stop();
  }

  async initialize() {
    await this.hapi.register({
      plugin: HapiPino,
      options: {
        instance: this.logger,
        logPayload: false,
        logRequestComplete: false,
        logRequestStart: false,
      },
    });

    await this.hapi.initialize();
  }

  route<TValidators extends Validators, THandler = Handler<TValidators>>(options: {
    method: Hapi.Util.HTTP_METHODS_PARTIAL | Hapi.Util.HTTP_METHODS_PARTIAL[];
    path: string;
    validators: TValidators;
    handler: THandler;
  }) {
    const validate: {
      [K in keyof TValidators]?: (value: object | Buffer | string) => Promise<any>;
    } = {};

    for (const component in options.validators) {
      validate[component] = codecToValidator(
        component,
        (options.validators[component] as any) as t.Any
      );
    }

    this.hapi.route({
      method: options.method,
      path: options.path,
      options: {
        validate,
        handler: (request, h) => {
          const tokenSource = new CancellationTokenSource();

          request.events.once('disconnect', () => {
            tokenSource.cancel();
          });

          (request as any).token = tokenSource.token;
          return (options.handler as any)(request, h);
        },
      },
    });
  }

  async start() {
    await this.initialize();
    await this.hapi.start();
  }
}
