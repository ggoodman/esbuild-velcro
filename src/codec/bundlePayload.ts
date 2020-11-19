import * as t from 'io-ts';

export const BundlePayload = t.type({
  /**
   * A mapping of logical file path to the content of the file at that path
   */
  files: t.record(t.string, t.string, 'Files'),
});
export type BundlePayload = t.TypeOf<typeof BundlePayload>;
