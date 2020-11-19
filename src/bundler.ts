import { CanceledError, CancellationToken, CancellationTokenSource, Uri } from '@velcro/common';
import { Resolver } from '@velcro/resolver';
import { CdnStrategy } from '@velcro/strategy-cdn';
import { CompoundStrategy } from '@velcro/strategy-compound';
import { MemoryStrategy } from '@velcro/strategy-memory';
import { build, Loader, Service, startService } from 'esbuild';
import got, { CancelError, Got } from 'got/dist/source';

export interface BundleOptions {
  files: Record<string, string>;
  nodeEnv?: string;
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

    const indexFileName = 'index.jsx';
    const indexFileContent = options.files[indexFileName];
    const indexFileUrl = memoryStrategy.uriForPath(indexFileName);
    const namespace = 'velcro';
    const buildResult = await esbuild.build({
      bundle: true,
      define: {
        'process.env.NODE_ENV': options.nodeEnv || 'development',
      },
      format: 'esm',
      metafile: 'meta.json',
      minify: true,
      outdir: process.cwd(),
      // sourcemap: 'external',
      // splitting: true,
      stdin: {
        contents: indexFileContent,
        sourcefile: indexFileUrl.toString(),
        loader: loaderForUri(indexFileUrl.toString()),
      },
      write: false,
      plugins: [
        {
          name: 'velcro',
          setup: (build) => {
            build.onResolve({ filter: /./ }, async ({ importer, path }) => {
              if (importer === '<stdin>') {
                importer = indexFileUrl.toString();
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

    return {
      warnings: buildResult.warnings,
      outputFiles: (buildResult.outputFiles || []).map((file) => {
        return {
          path: file.path.replace(`${process.cwd()}/stdin.js`, indexFileUrl.toString()),
          content: file.text,
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
