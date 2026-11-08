import { createHash } from "node:crypto";
import {
  alphaBounds,
  blend,
  empty,
  encode,
  mapPixels,
  unionBounds,
  type Bounds,
  type DecodeCache,
  type Pixels,
} from "./image.js";
import {
  fitTransform,
  fittedViewport,
  worldViewport,
  type PixelTransform,
  type Viewport,
} from "./framing.js";
import { flatLayers } from "./flat.js";
import { headImage } from "./head.js";
import { modelImage, modelRadius } from "./model.js";
import type { RenderOptions, RenderPart } from "./types.js";
export type * from "./types.js";

export const RENDERER_VERSION = "1.0.0";
const measuredBounds = new Map<string, Bounds>();

/** Return a PNG frame from caller-resolved textures and models. */
export async function renderFrame(
  parts: readonly RenderPart[],
  options: RenderOptions = {},
): Promise<Buffer> {
  return renderSprite([parts], options);
}
/** Return a vertical PNG sprite with shared framing to prevent movement between cells. */
export async function renderSprite(
  frames: readonly (readonly RenderPart[])[],
  options: RenderOptions = {},
): Promise<Buffer> {
  const size = options.size ?? 128;
  if (!Number.isInteger(size) || size < 1 || size > 512)
    throw new Error("Output size must be an integer from 1 to 512");
  const padding = options.padding ?? size / 16;
  if (
    (options.padding !== undefined && !Number.isInteger(padding)) ||
    padding < 0 ||
    padding * 2 >= size
  )
    throw new Error("Invalid output padding");
  if (
    !Array.isArray(frames as unknown) ||
    !frames.length ||
    frames.length > 512 ||
    size * size * frames.length > 16_777_216
  )
    throw new Error("Sprite exceeds output budget");
  if (
    options.framing !== undefined &&
    !["inventory", "canvas"].includes(options.framing)
  )
    throw new Error("Invalid framing policy");
  for (const parts of frames) {
    if (!Array.isArray(parts) || !parts.length || parts.length > 32)
      throw new Error("Artwork needs 1–32 parts");
    for (const part of parts) validatePart(part);
  }

  const cache: DecodeCache = { images: new WeakMap(), bytes: 0 };
  const mixed =
    frames.some((parts) => parts.some((part) => part.kind === "flat")) &&
    frames.some((parts) => parts.some((part) => part.kind !== "flat"));
  const onlyHeads = frames.every((parts) =>
    parts.every((part) => part.kind === "head"),
  );
  // A fixed measurement grid makes framing independent of output size.
  // These pixels determine bounds only; final output is rasterized separately.
  const measurementSize = 512;
  // An 8-unit radius contains the rotated 8.5-unit skull. Mixed parts need the
  // common 16-unit canvas so heads, models and flat layers share world coordinates.
  let radius = onlyHeads ? 8 : 16;
  const measured = new Set<object>();
  for (const parts of frames)
    for (const part of parts) {
      if (part.kind !== "model" || measured.has(part.model)) continue;
      measured.add(part.model);
      radius = Math.max(radius, modelRadius(part.model));
    }

  const canvas = options.framing === "canvas";
  const source = canvas
    ? { left: 0, top: 0, width: measurementSize, height: measurementSize }
    : await measureFrames(
        frames,
        { size: measurementSize, radius, cache, mixed },
        "union",
      );
  if (!source) throw new Error("Artwork contains no visible pixels");
  const transform = fitTransform(
    source,
    size,
    options.framing === "canvas" ? 0 : padding,
  );
  const viewport = fittedViewport(measurementSize, radius, transform);
  const output = empty(size, size * frames.length);
  // Rasterizing at output precision avoids enlarged pixel steps.
  // Keeping only the current intermediate frame bounds memory use.
  let visible = false;
  for (const [index, parts] of frames.entries()) {
    const frame = await rasterizeParts(parts, {
      size,
      radius,
      viewport,
      cache,
      mixed,
      flatTransform: canvas ? undefined : { measurementSize, transform },
    });
    output.data.set(frame.data, index * size * size * 4);
    if (canvas && !visible) visible = alphaBounds(frame) !== undefined;
  }
  // A visible source can fall between output pixel centers. Recheck empty canvas
  // results on the larger measurement grid before rejecting invisible artwork.
  if (canvas && !visible) {
    const occupied = await measureFrames(
      frames,
      { size: measurementSize, radius, cache, mixed },
      "visibility",
    );
    if (!occupied) throw new Error("Artwork contains no visible pixels");
  }
  return encode(output);
}

interface RasterSettings {
  cache: DecodeCache;
  mixed: boolean;
  size: number;
  radius: number;
  viewport?: Viewport;
  flatTransform?: { measurementSize: number; transform: PixelTransform };
}

async function measureFrames(
  frames: readonly (readonly RenderPart[])[],
  settings: RasterSettings,
  mode: "union" | "visibility",
): Promise<Bounds | undefined> {
  const key =
    mode === "union" ? measurementKey(frames, settings.radius) : undefined;
  const saved = key ? measuredBounds.get(key) : undefined;
  if (saved) {
    measuredBounds.delete(key!);
    measuredBounds.set(key!, saved);
    return saved;
  }
  let common: Bounds | undefined;
  for (const parts of frames) {
    const frame = await rasterizeParts(parts, settings);
    const occupied = alphaBounds(frame);
    if (!occupied) continue;
    if (mode === "visibility") return occupied;
    common = unionBounds(common, occupied);
  }
  if (key && common) {
    measuredBounds.set(key, common);
    if (measuredBounds.size > 64)
      measuredBounds.delete(measuredBounds.keys().next().value!);
  }
  return common;
}

async function rasterizeParts(
  parts: readonly RenderPart[],
  { size, radius, viewport, flatTransform, cache, mixed }: RasterSettings,
): Promise<Pixels> {
  const frame = empty(size);
  for (const part of parts) {
    let image: Pixels;
    if (part.kind === "flat") {
      image = await flatLayers(
        part,
        mixed ? size : (flatTransform?.measurementSize ?? size),
        cache,
      );
      if (mixed) {
        const world = viewport ?? worldViewport(size, radius);
        image = mapPixels(image, size, {
          scale: (16 * world.pixelsPerUnit) / size,
          x: world.originX - 8 * world.pixelsPerUnit,
          y: world.originY - 8 * world.pixelsPerUnit,
        });
      } else if (flatTransform)
        image = mapPixels(image, size, flatTransform.transform);
    } else if (part.kind === "head") {
      image = await headImage(part.skin, size, radius, viewport, cache);
    } else if (part.kind === "model") {
      image = await modelImage(part, size, radius, viewport, cache);
    } else throw new Error("Unknown render part");
    for (let i = 0; i < frame.data.length; i += 4)
      blend(
        frame.data,
        i,
        image.data[i],
        image.data[i + 1],
        image.data[i + 2],
        image.data[i + 3],
      );
  }
  return frame;
}

/** Content digests keep cached bounds valid when callers reuse or mutate input objects. */
function measurementKey(
  frames: readonly (readonly RenderPart[])[],
  radius: number,
) {
  const hashes = new WeakMap<Uint8Array, string>();
  const hash = (bytes: Uint8Array) => {
    let value = hashes.get(bytes);
    if (!value) {
      value = createHash("sha256").update(bytes).digest("hex");
      hashes.set(bytes, value);
    }
    return value;
  };
  return createHash("sha256")
    .update(
      JSON.stringify({
        radius,
        frames: frames.map((parts) =>
          parts.map((part) => {
            if (part.kind === "head")
              return { kind: part.kind, skin: hash(part.skin) };
            if (part.kind === "flat")
              return {
                kind: part.kind,
                layers: part.layers.map((layer) => ({
                  png: hash(layer.png),
                  tint: layer.tint,
                })),
              };
            return {
              kind: part.kind,
              model: part.model,
              tints: part.tints,
              textures: Object.fromEntries(
                Object.entries(part.textures).map(([name, bytes]) => [
                  name,
                  hash(bytes),
                ]),
              ),
            };
          }),
        ),
      }),
    )
    .digest("hex");
}

function validatePart(part: RenderPart) {
  if (!part || typeof part !== "object") throw new Error("Unknown render part");
  const bytes = (value: unknown) => {
    if (
      !(value instanceof Uint8Array) ||
      !value.byteLength ||
      value.byteLength > 16 * 1024 * 1024
    )
      throw new Error("Invalid encoded texture size");
  };
  if (part.kind === "head") {
    bytes(part.skin);
    return;
  }
  if (part.kind === "flat") {
    if (
      !Array.isArray(part.layers) ||
      !part.layers.length ||
      part.layers.length > 32
    )
      throw new Error("Flat artwork needs 1–32 layers");
    for (const layer of part.layers) {
      if (!layer || typeof layer !== "object")
        throw new Error("Invalid flat layer");
      bytes(layer.png);
      if (
        layer.tint !== undefined &&
        (typeof layer.tint !== "string" || !/^#[0-9a-f]{6}$/i.test(layer.tint))
      )
        throw new Error("Tint must be a six-digit hex color");
    }
    return;
  }
  if (part.kind === "model") {
    if (
      !part.model ||
      !Array.isArray(part.model.elements) ||
      !part.model.elements.length ||
      part.model.elements.length > 4096
    )
      throw new Error("Model needs 1–4096 cuboid elements");
    if (
      !part.textures ||
      typeof part.textures !== "object" ||
      Array.isArray(part.textures)
    )
      throw new Error("Invalid model textures");
    if (Object.keys(part.textures).length > 256)
      throw new Error("Too many model textures");
    for (const value of Object.values(part.textures)) bytes(value);
    return;
  }
  throw new Error("Unknown render part");
}
