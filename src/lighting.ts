import { rotate, type Point } from "./geometry.js";
import type { Vec3 } from "./types.js";

/** The input is an outward unit normal in the rotated item GUI coordinate system. */
export type FaceLighting = (normal: Vec3) => number;

// Baked models use approximate lighting; skulls use the native entity light
// calculation and signed-byte normals below.
export const modelFaceLight: FaceLighting = ([x, y, z]) =>
  Math.max(0.55, Math.min(1, 0.75 + (x * -0.35 + y * 0.8 + z * 0.48) * 0.25));

function guiLightDirection(source: Vec3): Point {
  const length = Math.hypot(...source);
  let direction: Point = [
    source[0] / length,
    source[1] / length,
    source[2] / length,
  ];
  // Vanilla 26.2 ITEMS_3D lights use S(1,-1,1) Ry62 Rx185.5 Ry-22.5 Rx135.
  // Apply the rightmost rotation first, then flip Y on return.
  for (const angles of [
    [135, 0, 0],
    [0, -22.5, 0],
    [185.5, 0, 0],
    [0, 62, 0],
  ])
    direction = rotate(direction, angles);
  return [direction[0], -direction[1], direction[2]];
}

const skullLights = [
  guiLightDirection([0.2, 1, -0.7]),
  guiLightDirection([-0.2, 1, 0.7]),
];

function packedNormalComponent(component: number): number {
  const clamped = Math.max(-1, Math.min(1, component));
  // BufferBuilder truncates float normals to signed bytes. Attribute decoding
  // divides by 127 without normalizing the resulting vector again.
  const packed = Math.trunc(Math.fround(Math.fround(clamped) * 127));
  return Math.fround(packed / 127);
}

export const skullFaceLight: FaceLighting = (normal) => {
  // GUI projection flips Y, so lighting needs the same normal orientation.
  const shaderNormal = [normal[0], -normal[1], normal[2]].map(
    packedNormalComponent,
  );
  const diffuse = skullLights.reduce((sum, light) => {
    const dot = light.reduce(
      (value, component, axis) => value + component * shaderNormal[axis],
      0,
    );
    return sum + Math.max(0, dot);
  }, 0);
  return Math.min(1, 0.4 + 0.6 * diffuse);
};
