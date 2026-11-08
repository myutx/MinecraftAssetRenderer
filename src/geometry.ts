import type { FaceName, ModelElement, Vec3 } from "./types.js";
export type Point = [number, number, number];
export const radians = (angle: number) => (angle * Math.PI) / 180;

export function rotate(
  point: readonly number[],
  angles: readonly number[],
): Point {
  let [x, y, z] = point;
  // The GUI transform is Rx * Ry * Rz, so points encounter Z, Y, then X rotation.
  for (const axis of [2, 1, 0]) {
    const c = Math.cos(radians(angles[axis])),
      s = Math.sin(radians(angles[axis]));
    if (axis === 0) [y, z] = [y * c - z * s, y * s + z * c];
    if (axis === 1) [x, z] = [x * c + z * s, -x * s + z * c];
    if (axis === 2) [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}
export function elementPoint(point: Point, element: ModelElement): Point {
  if (!element.rotation) return point;
  const { origin, axis, angle, rescale } = element.rotation,
    index = "xyz".indexOf(axis);
  if (index < 0 || !Number.isFinite(angle) || Math.abs(angle) > 45)
    throw new Error("Invalid element rotation");
  const angles: [number, number, number] = [0, 0, 0];
  angles[index] = angle;
  let local = rotate(
    point.map((value, i) => value - origin[i]),
    angles,
  );
  if (rescale) {
    const factor = 1 / Math.cos(radians(angle));
    local = local.map((value, i) =>
      i === index ? value : value * factor,
    ) as Point;
  }
  return local.map((value, i) => value + origin[i]) as Point;
}
export function facePoints(name: FaceName, from: Vec3, to: Vec3): Point[] {
  const [x0, y0, z0] = from,
    [x1, y1, z1] = to;
  const faces: Record<FaceName, Point[]> = {
    north: [
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z0],
      [x1, y0, z0],
    ],
    south: [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    east: [
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z0],
      [x1, y0, z1],
    ],
    west: [
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z1],
      [x0, y0, z0],
    ],
    up: [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    down: [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y0, z0],
      [x0, y0, z0],
    ],
  };
  return faces[name];
}
export function defaultUV(
  name: FaceName,
  from: Vec3,
  to: Vec3,
): [number, number, number, number] {
  const [x0, y0, z0] = from,
    [x1, y1, z1] = to;
  switch (name) {
    case "up":
      return [x0, z0, x1, z1];
    case "down":
      return [x0, 16 - z1, x1, 16 - z0];
    case "north":
      return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case "south":
      return [x0, 16 - y1, x1, 16 - y0];
    case "west":
      return [z0, 16 - y1, z1, 16 - y0];
    case "east":
      return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
  }
}
