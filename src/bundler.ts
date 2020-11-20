import {
  CanceledError,
  CancellationToken,
  CancellationTokenSource,
  checkCancellation,
  Uri,
} from '@velcro/common';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';
import { memory } from 'console';
import { build, Loader, Service, startService } from 'esbuild';
import got, { CancelError, Got } from 'got/dist/source';

export interface BundleOptions {
  entrypoints: [string];
  files: Record<string, string>;
  env?: Record<string, string>;
  token?: CancellationToken;
}

export interface Bundle {}

export interface BundlerService {
  dispose(): void;

  bundle(options: BundleOptions): Promise<Bundle>;
}

export class BundlerServiceImpl implements BundlerService {
  private esbuildPromise: Promise<Service> | undefined;
  private readonly got: Got;
  private readonly tokenSource: CancellationTokenSource;

  constructor(options: { token?: CancellationToken } = {}) {
    this.tokenSource = new CancellationTokenSource(options.token);
    this.tokenSource.token.onCancellationRequested(this.dispose.bind(this));
    this.got = got.extend({
      cache: new Map(),
    });
  }

  dispose() {
    if (this.esbuildPromise) {
      this.esbuildPromise.then((esbuild) => esbuild.stop());
      this.esbuildPromise = undefined;
    }
  }

  async bundle(options: BundleOptions) {
    const esbuild = await this.startEsbuild();

    if (this.tokenSource.token.isCancellationRequested) {
      return new CanceledError();
    }

    const tokenSource = new CancellationTokenSource(options.token);
    this.tokenSource.token.onCancellationRequested(() => tokenSource.dispose(true));

    const memoryStrategy = new MemoryStrategy(options.files);
    const cdnStrategy = CdnStrategy.forJsDelivr(this.readUrlFn.bind(this));
    const compoundStrategy = new CompoundStrategy({
      strategies: [memoryStrategy, cdnStrategy],
    });
    const resolver = new Resolver(compoundStrategy, {
      extensions: ['.js', '.ts', '.tsx'],
      packageMain: ['module', 'main'],
    });

    const entrypoints = await checkCancellation(
      Promise.all(
        options.entrypoints.map(async (entrypoint) => {
          const resolveResult = await resolver.resolve(memoryStrategy.uriForPath(entrypoint));

          if (!resolveResult.found) {
            throw new Error(`Unable to resolve the entrypoint ${JSON.stringify(entrypoint)}`);
          }

          if (!resolveResult.uri) {
            throw new Error(
              `The entrypoint ${JSON.stringify(
                entrypoint
              )} was excluded by "browser" field overrides`
            );
          }

          const contentResult = await resolver.readFileContent(resolveResult.uri);

          return {
            href: resolveResult.uri.toString(),
            content: Buffer.from(contentResult.content).toString('utf-8'),
          };
        })
      ),
      tokenSource.token
    );

    const entrypoint = entrypoints[0];
    const define: Record<string, string> = {};

    if (options.env) {
      for (const envVar in options.env) {
        define[`process.env.${envVar}`] = JSON.stringify(options.env[envVar]);
      }
    }

    // const indexFileName = 'index.jsx';
    // const indexFileContent = options.files[indexFileName];
    // const indexFileUrl = memoryStrategy.uriForPath(indexFileName);
    const namespace = 'velcro';
    const buildResult = await esbuild.build({
      bundle: true,
      define,
      format: 'esm',
      metafile: 'meta.json',
      minify: true,
      outdir: process.cwd(),
      sourcemap: 'external',
      splitting: true,
      stdin: {
        contents: entrypoint.content,
        sourcefile: entrypoint.href,
        loader: loaderForUri(entrypoint.href),
      },
      write: false,
      plugins: [
        {
          name: 'velcro',
          setup: (build) => {
            build.onResolve({ filter: /./ }, async ({ importer, path }) => {
              if (importer === '<stdin>') {
                importer = entrypoint.href;
              }

              const resolveResult = await resolver.resolve(path, Uri.parse(importer));

              if (!resolveResult.found || !resolveResult.uri) {
                throw new Error(`Unable to resolve ${path} from ${importer}`);
              }

              return {
                namespace,
                path: resolveResult.uri.toString(),
              };
            });

            build.onLoad({ filter: /./, namespace }, async ({ path }) => {
              const readResult = await resolver.readFileContent(Uri.parse(path));

              return {
                contents: Buffer.from(readResult.content),
              };
            });
          },
        },
      ],
    });

    const metaHref = memoryStrategy.uriForPath('meta.json').toString();

    return {
      warnings: buildResult.warnings,
      outputFiles: (buildResult.outputFiles || []).map((file) => {
        const normalizedPath = file.path
          .replace(`${process.cwd()}/stdin.js`, entrypoint.href)
          .replace(`${process.cwd()}/`, Uri.ensureTrailingSlash(memoryStrategy.rootUri).toString());

        let content = file.text;

        if (normalizedPath === metaHref) {
          const meta = JSON.parse(file.text);
          const normalizedMeta: any = { inputs: {}, outputs: {} };

          for (const path in meta.inputs) {
            normalizedMeta.inputs[path.replace(/^velcro:/, '')] = meta.inputs[path];
          }

          for (const path in meta.outputs) {
            normalizedMeta.inputs[path.replace(/^velcro:/, '')] = meta.inputs[path];
          }

          content = JSON.stringify(normalizedMeta);

          console.dir(meta, { depth: 5 });
        }

        return {
          path: normalizedPath,
          content,
        };
      }),
    };
  }

  private readUrlFn(uri: string, token: CancellationToken) {
    const promise = this.got.get(uri, {
      followRedirect: true,
      responseType: 'buffer',
    });

    token.onCancellationRequested(() => promise.cancel());

    return promise.then((res) => res.body);
  }

  private startEsbuild() {
    if (!this.esbuildPromise) {
      this.esbuildPromise = startService();
    }

    return this.esbuildPromise;
  }
}

function loaderForUri(href: string): Loader {
  return 'tsx';
}
