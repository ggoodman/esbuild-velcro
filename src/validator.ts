import * as Boom from '@hapi/boom';
import { isLeft } from 'fp-ts/lib/Either';
import * as t from 'io-ts';
import { formatValidationErrors } from './validation/reporter';

export function codecToValidator<TCodec extends t.Any>(
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

      throw Boom.badRequest(`Validation failed for the ${kind}:\n${errors}`);
    }

    return result.right;
  };
}
