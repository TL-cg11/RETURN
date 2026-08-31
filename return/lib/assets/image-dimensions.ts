export type ImageDimensions = { width: number; height: number };

function valid(width: number, height: number): ImageDimensions | null {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function text(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Reads dimensions from supported image headers without decoding untrusted pixels. */
export function readImageDimensions(buffer: ArrayBuffer, contentType: string): ImageDimensions | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (contentType === 'image/png' && bytes.length >= 24
    && text(bytes, 1, 3) === 'PNG' && text(bytes, 12, 4) === 'IHDR') {
    return valid(view.getUint32(16), view.getUint32(20));
  }

  if (contentType === 'image/gif' && bytes.length >= 10 && text(bytes, 0, 3) === 'GIF') {
    return valid(view.getUint16(6, true), view.getUint16(8, true));
  }

  if (contentType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && length >= 7 && offset + 7 <= bytes.length) {
        return valid(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      if (length < 2) break;
      offset += length;
    }
  }

  if (contentType === 'image/webp' && bytes.length >= 20 && text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = text(bytes, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (kind === 'VP8X' && data + 10 <= bytes.length) {
        const width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
        const height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
        return valid(width, height);
      }
      if (kind === 'VP8L' && data + 5 <= bytes.length && bytes[data] === 0x2f) {
        const width = 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8);
        const height = 1 + ((bytes[data + 2] & 0xc0) >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10);
        return valid(width, height);
      }
      if (kind === 'VP8 ' && data + 10 <= bytes.length && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        return valid(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff);
      }
      offset = data + size + (size % 2);
    }
  }

  return null;
}
