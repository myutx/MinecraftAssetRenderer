import {
  blend,
  decode,
  empty,
  fit,
  type DecodeCache,
  type Pixels,
} from "./image.js";
import type { RenderPart } from "./types.js";
type Flat = Extract<RenderPart, { kind: "flat" }>;

export async function flatLayers(
  part: Flat,
  size: number,
  cache?: DecodeCache,
): Promise<Pixels> {
  if (!part.layers.length || part.layers.length > 32)
    throw new Error("Flat artwork needs 1–32 layers");
  const output = empty(size);
  for (const layer of part.layers) {
    const image = await decode(layer.png, cache);
    const fitted = fit(
      image,
      { left: 0, top: 0, width: image.width, height: image.height },
      size,
      0,
    );
    const tint = layer.tint ? parseTint(layer.tint) : [255, 255, 255];
    for (let i = 0; i < fitted.data.length; i += 4)
      blend(
        output.data,
        i,
        Math.round((fitted.data[i] * tint[0]) / 255),
        Math.round((fitted.data[i + 1] * tint[1]) / 255),
        Math.round((fitted.data[i + 2] * tint[2]) / 255),
        fitted.data[i + 3],
      );
  }
  return output;
}
function parseTint(color: string): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error("Tint must be a six-digit hex color");
  return [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16),
  );
}
