import assert from 'node:assert/strict';
import test from 'node:test';
import { readImageDimensions } from './image-dimensions.ts';

test('reads PNG and GIF dimensions from their headers', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, 2400);
  new DataView(png.buffer).setUint32(20, 300);
  assert.deepEqual(readImageDimensions(png.buffer, 'image/png'), { width: 2400, height: 300 });

  const gif = new Uint8Array(10);
  gif.set([0x47, 0x49, 0x46], 0);
  new DataView(gif.buffer).setUint16(6, 200, true);
  new DataView(gif.buffer).setUint16(8, 900, true);
  assert.deepEqual(readImageDimensions(gif.buffer, 'image/gif'), { width: 200, height: 900 });
});

test('reads JPEG and extended WebP dimensions', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x04, 0xb0, 0x03, 0x01, 0x11, 0x00, 0xff, 0xd9]);
  assert.deepEqual(readImageDimensions(jpeg.buffer, 'image/jpeg'), { width: 1200, height: 200 });

  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
  new DataView(webp.buffer).setUint32(16, 10, true);
  webp.set([0xff, 0x0f, 0x00], 24); // 4096px wide, stored minus one.
  webp.set([0xff, 0x07, 0x00], 27); // 2048px high, stored minus one.
  assert.deepEqual(readImageDimensions(webp.buffer, 'image/webp'), { width: 4096, height: 2048 });
});

test('fails closed for malformed or unsupported data', () => {
  assert.equal(readImageDimensions(new Uint8Array([1, 2, 3]).buffer, 'image/png'), null);
  assert.equal(readImageDimensions(new Uint8Array(40).buffer, 'image/jpeg'), null);
  assert.equal(readImageDimensions(new Uint8Array(40).buffer, 'application/pdf'), null);
});
