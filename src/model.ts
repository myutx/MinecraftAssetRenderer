import { decode, empty, type DecodeCache, type Pixels } from "./image.js";
import { worldViewport, type Viewport } from "./framing.js";
import { modelFaceLight, type FaceLighting } from "./lighting.js";
import {
  defaultUV,
  elementPoint,
  facePoints,
  rotate,
  type Point,
} from "./geometry.js";
import type { FaceName, MinecraftModel, RenderPart } from "./types.js";
type ModelPart = Extract<RenderPart, { kind: "model" }>;
type Vertex = { point: Point; uv: [number, number] };
import { FragmentBuffer } from "./fragments.js";

export interface RasterMaterial {
  lighting: FaceLighting;
  cullBackFaces: boolean;
  twoSidedLighting: boolean;
  alphaCutout: number;
}

const modelMaterial: RasterMaterial = {
  lighting: modelFaceLight,
  cullBackFaces: true,
  twoSidedLighting: false,
  alphaCutout: 0,
};

export async function modelImage(
  part: ModelPart,
  size: number,
  radius = 16,
  viewport: Viewport = worldViewport(size, radius),
  cache?: DecodeCache,
): Promise<Pixels> {
  const images = new Map<string, Pixels>();
  let decodedBytes = 0;
  for (const [name, bytes] of Object.entries(part.textures)) {
    if (images.size >= 256) throw new Error("Too many model textures");
    const image = await decode(bytes, cache);
    decodedBytes += image.data.byteLength;
    if (decodedBytes > 64 * 1024 * 1024)
      throw new Error("Model textures exceed decoded byte budget");
    images.set(name, image);
  }
  const tints = new Map<number, number[]>();
  for (const [index, value] of Object.entries(part.tints ?? {})) {
    if (!/^[0-9]+$/.test(index) || !/^#[a-f0-9]{6}$/i.test(value))
      throw new Error("Invalid model tint");
    tints.set(
      Number(index),
      [1, 3, 5].map((offset) =>
        Number.parseInt(value.slice(offset, offset + 2), 16),
      ),
    );
  }
  return rasterModel(
    part.model,
    images,
    size,
    radius,
    viewport,
    modelMaterial,
    tints,
  );
}

export function rasterModel(
  model: MinecraftModel,
  textures: ReadonlyMap<string, Pixels>,
  size: number,
  radius = 16,
  viewport: Viewport = worldViewport(size, radius),
  material: RasterMaterial = modelMaterial,
  tints: ReadonlyMap<number, number[]> = new Map(),
): Pixels {
  if (!model.elements?.length || model.elements.length > 4096)
    throw new Error("Model needs 1–4096 cuboid elements");
  const gui = model.display?.gui ?? {};
  const rotation = gui.rotation ?? [0, 0, 0],
    scale = gui.scale ?? [1, 1, 1],
    translation = gui.translation ?? [0, 0, 0];
  for (const vector of [rotation, scale, translation]) validateVector(vector);
  const fragments = new FragmentBuffer(size * size);
  const minimumAlpha = material.alphaCutout * 255;
  let rasterWork = 0;
  for (const element of model.elements) {
    if (!element || typeof element !== "object")
      throw new Error("Invalid model element");
    validateVector(element.from);
    validateVector(element.to);
    if (element.rotation) validateVector(element.rotation.origin);
    if (
      !element.faces ||
      typeof element.faces !== "object" ||
      Array.isArray(element.faces)
    )
      throw new Error("Invalid model faces");
    for (const [faceName, face] of Object.entries(element.faces)) {
      if (!face || typeof face !== "object")
        throw new Error("Invalid model face");
      if (typeof face.texture !== "string" || !face.texture)
        throw new Error("Invalid model face texture");
      const name = faceName as FaceName;
      if (!["north", "south", "east", "west", "up", "down"].includes(name))
        throw new Error("Invalid model face");
      const image = resolveTexture(face.texture, model, textures);
      const points = facePoints(name, element.from, element.to).map((point) => {
        const positioned = elementPoint(point, element);
        const transformed = rotate(
          positioned.map((value, i) => (value - 8) * scale[i]),
          rotation,
        );
        return transformed.map((value, i) => value + translation[i]) as Point;
      });
      const a = points[1].map((value, i) => value - points[0][i]),
        b = points[3].map((value, i) => value - points[0][i]);
      // Exterior-clockwise vertices give an inward cross-product normal.
      const normal = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      if (material.cullBackFaces && normal[2] >= -1e-8) continue;
      // Two-sided skull faces need the light normal to face the viewer on either side.
      const normalSign = material.twoSidedLighting && normal[2] >= 0 ? 1 : -1;
      const uv = face.uv ?? defaultUV(name, element.from, element.to);
      if (!Array.isArray(uv) || uv.length !== 4 || !uv.every(Number.isFinite))
        throw new Error("Invalid model face UV");
      const turns = (face.rotation ?? 0) / 90;
      if (!Number.isInteger(turns))
        throw new Error("Face rotation must be a multiple of 90 degrees");
      const corners: [number, number][] = [
        [uv[0], uv[1]],
        [uv[2], uv[1]],
        [uv[2], uv[3]],
        [uv[0], uv[3]],
      ];
      const vertices = points.map((point, i) => ({
        point: [
          viewport.originX + point[0] * viewport.pixelsPerUnit,
          viewport.originY - point[1] * viewport.pixelsPerUnit,
          point[2],
        ] as Point,
        uv: corners[(((i - turns) % 4) + 4) % 4],
      }));
      const normalLength = Math.hypot(...normal);
      const light =
        element.shade === false || model.gui_light === "front"
          ? 1
          : material.lighting([
              (normalSign * normal[0]) / normalLength,
              (normalSign * normal[1]) / normalLength,
              (normalSign * normal[2]) / normalLength,
            ]);
      const tint =
        face.tintindex === undefined ? undefined : tints.get(face.tintindex);
      for (const indices of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        rasterTriangle(
          indices.map((index) => vertices[index]),
          image,
          light,
          size,
          (index, z, r, g, b, alpha) => {
            if (alpha < minimumAlpha) return;
            fragments.add(
              index,
              z,
              tint ? Math.round((r * tint[0]) / 255) : r,
              tint ? Math.round((g * tint[1]) / 255) : g,
              tint ? Math.round((b * tint[2]) / 255) : b,
              alpha,
            );
          },
          (count) => {
            rasterWork += count;
            if (rasterWork > 4_000_000)
              throw new Error("Model rasterization budget exceeded");
          },
        );
      }
    }
  }
  const output = empty(size);
  fragments.composite(output.data);
  return output;
}
/** Return the GUI-space radius needed to keep transformed parts and sprite frames aligned. */
export function modelRadius(model: MinecraftModel): number {
  if (!model.elements?.length || model.elements.length > 4096)
    throw new Error("Model needs 1–4096 cuboid elements");
  const gui = model.display?.gui ?? {};
  const rotation = gui.rotation ?? [0, 0, 0],
    scale = gui.scale ?? [1, 1, 1],
    translation = gui.translation ?? [0, 0, 0];
  for (const vector of [rotation, scale, translation]) validateVector(vector);
  let radius = 16;
  for (const element of model.elements) {
    if (!element || typeof element !== "object")
      throw new Error("Invalid model element");
    validateVector(element.from);
    validateVector(element.to);
    if (element.rotation) validateVector(element.rotation.origin);
    for (const x of [element.from[0], element.to[0]])
      for (const y of [element.from[1], element.to[1]])
        for (const z of [element.from[2], element.to[2]]) {
          const positioned = elementPoint([x, y, z], element);
          const point = rotate(
            positioned.map((value, i) => (value - 8) * scale[i]),
            rotation,
          );
          radius = Math.max(
            radius,
            Math.abs(point[0] + translation[0]),
            Math.abs(point[1] + translation[1]),
          );
        }
  }
  return radius;
}
function validateVector(vector: readonly number[]) {
  if (
    !Array.isArray(vector) ||
    vector.length !== 3 ||
    !vector.every((value) => Number.isFinite(value) && Math.abs(value) <= 1024)
  )
    throw new Error("Invalid model vector");
}
function resolveTexture(
  reference: string,
  model: MinecraftModel,
  textures: ReadonlyMap<string, Pixels>,
): Pixels {
  let name = reference;
  const visited = new Set<string>();
  for (let depth = 0; depth < 32; depth++) {
    const key = name.replace(/^#/, "");
    const direct = textures.get(key) ?? textures.get(name);
    if (direct) return direct;
    if (visited.has(key)) throw new Error("Cyclic model texture reference");
    visited.add(key);
    const next = model.textures?.[key];
    if (!next) break;
    name = next;
  }
  throw new Error("Missing model texture: " + reference);
}
function rasterTriangle(
  vertices: Vertex[],
  texture: Pixels,
  light: number,
  size: number,
  emit: (
    index: number,
    z: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
  ) => void,
  charge: (count: number) => void,
): number {
  const [a, b, c] = vertices;
  const [ax, ay] = a.point,
    [bx, by] = b.point,
    [cx, cy] = c.point;
  const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(determinant) < 1e-9) return 0;
  const left = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
    right = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
  const top = Math.max(0, Math.floor(Math.min(ay, by, cy))),
    bottom = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
  if (right < left || bottom < top) return 0;
  const count = (right - left + 1) * (bottom - top + 1);
  charge(count);
  const topLeft = (from: Vertex, to: Vertex) => {
    const dx = (to.point[0] - from.point[0]) * Math.sign(determinant);
    const dy = (to.point[1] - from.point[1]) * Math.sign(determinant);
    return dy < 0 || (dy === 0 && dx > 0);
  };
  const inclusive = [topLeft(b, c), topLeft(c, a), topLeft(a, b)];
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const px = x + 0.5,
        py = y + 0.5;
      const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / determinant;
      const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / determinant;
      const wc = 1 - wa - wb;
      if (
        wa < -1e-9 ||
        wb < -1e-9 ||
        wc < -1e-9 ||
        (Math.abs(wa) < 1e-9 && !inclusive[0]) ||
        (Math.abs(wb) < 1e-9 && !inclusive[1]) ||
        (Math.abs(wc) < 1e-9 && !inclusive[2])
      )
        continue;
      const u = (a.uv[0] * wa + b.uv[0] * wb + c.uv[0] * wc) / 16;
      const v = (a.uv[1] * wa + b.uv[1] * wb + c.uv[1] * wc) / 16;
      const tx = Math.max(
        0,
        Math.min(texture.width - 1, Math.floor(u * texture.width)),
      );
      const ty = Math.max(
        0,
        Math.min(texture.height - 1, Math.floor(v * texture.height)),
      );
      const offset = (ty * texture.width + tx) * 4,
        alpha = texture.data[offset + 3];
      if (!alpha) continue;
      emit(
        y * size + x,
        a.point[2] * wa + b.point[2] * wb + c.point[2] * wc,
        Math.round(texture.data[offset] * light),
        Math.round(texture.data[offset + 1] * light),
        Math.round(texture.data[offset + 2] * light),
        alpha,
      );
    }
  return count;
}
