import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push-support';

describe('urlBase64ToUint8Array', () => {
  it('decodes a padded-less base64url string to the right bytes', () => {
    // "SGVsbG8" is base64url for "Hello".
    expect(Array.from(urlBase64ToUint8Array('SGVsbG8'))).toEqual([72, 101, 108, 108, 111]);
  });

  it('handles the base64url-specific characters "-" and "_"', () => {
    // bytes [251, 255] -> base64 "+/8=" -> base64url "-_8"
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });

  it('returns a Uint8Array backed by a plain ArrayBuffer', () => {
    expect(urlBase64ToUint8Array('SGVsbG8').buffer).toBeInstanceOf(ArrayBuffer);
  });
});
