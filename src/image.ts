import sharp from "sharp";
import { fitTransform, type PixelTransform } from "./framing.js";

export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export const empty = (width: number, height = width): Pixels => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
});

export type DecodeCache = {
  images: WeakMap<Uint8Array, Promise<Pixels>>;
  bytes: number;
};
export function decode(png: Uint8Array, cache?: DecodeCache): Promise<Pixels> {
  const saved = cache?.images.get(png);
  if (saved) return saved;
  const result = decodeTexture(png).then((image) => {
    if (cache) {
      cache.bytes += image.data.byteLength;
      if (cache.bytes > 64 * 1024 * 1024)
        throw new Error("Textures exceed decoded byte budget");
    }
    return image;
  });
  cache?.images.set(png, result);
  return result;
}
async function decodeTexture(png: Uint8Array): Promise<Pixels> {
  if (!png.byteLength || png.byteLength > 16 * 1024 * 1024)
    throw new Error("Invalid encoded texture size");
  const input = sharp(Buffer.from(png), {
    limitInputPixels: 4096 * 4096,
    ignoreIcc: true,
    failOn: "error",
  });
  if ((await input.metadata()).format !== "png")
    throw new Error("Texture must be PNG");
  const { data, info } = await input
    .ensureAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function alphaBounds(image: Pixels): Bounds | undefined {
  let left = image.width,
    top = image.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      if (!image.data[(y * image.width + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return right < left
    ? undefined
    : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function unionBounds(a: Bounds | undefined, b: Bounds): Bounds {
  if (!a) return b;
  const left = Math.min(a.left, b.left),
    top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}

/** Blend straight-alpha channels with source-over; transparent input leaves target bytes intact. */
export function blend(
  target: Uint8Array,
  offset: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
) {
  if (!alpha) return;
  const src = alpha / 255,
    dest = target[offset + 3] / 255,
    out = src + dest * (1 - src);
  target[offset] = Math.round(
    (r * src + target[offset] * dest * (1 - src)) / out,
  );
  target[offset + 1] = Math.round(
    (g * src + target[offset + 1] * dest * (1 - src)) / out,
  );
  target[offset + 2] = Math.round(
    (b * src + target[offset + 2] * dest * (1 - src)) / out,
  );
  target[offset + 3] = Math.round(out * 255);
}

/** Fit without stretching, sampling directly at the final pixel centers. */
export function fit(
  image: Pixels,
  bounds: Bounds,
  size: number,
  padding: number,
): Pixels {
  return mapPixels(image, size, fitTransform(bounds, size, padding));
}

export function mapPixels(
  image: Pixels,
  size: number,
  transform: PixelTransform,
): Pixels {
  const output = empty(size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x + 0.5 - transform.x) / transform.scale);
      const sy = Math.floor((y + 0.5 - transform.y) / transform.scale);
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const source = (sy * image.width + sx) * 4;
      output.data.set(
        image.data.subarray(source, source + 4),
        (y * size + x) * 4,
      );
    }
  return output;
}
export async function encode(image: Pixels): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
