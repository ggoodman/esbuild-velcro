import * as t from 'io-ts';

export const BundlePayload = t.type({
  /**
   * A mapping of logical file path to the content of the file at that path
   */
  files: t.record(t.string, t.string, 'Files'),
  /**
   * The list of entrypoint paths
   * 
   * This is temporarily limited to a single entrypoint while some details
   * are resolved with the underlying bundler.
   */
  entrypoints: t.tuple([t.string]),
  env: t.record(t.string, t.string),
});
export type BundlePayload = t.TypeOf<typeof BundlePayload>;
