import type { Bounds } from "./image.js";

/** Scale and offsets convert source pixels to output pixels without changing the aspect ratio. */
export interface PixelTransform {
  scale: number;
  x: number;
  y: number;
}
/** Scale is measured in output pixels per world unit; the origin is in output pixels. */
export interface Viewport {
  pixelsPerUnit: number;
  originX: number;
  originY: number;
}

export function fitTransform(
  bounds: Bounds,
  size: number,
  padding: number,
): PixelTransform {
  const scale = Math.min(
    (size - 2 * padding) / bounds.width,
    (size - 2 * padding) / bounds.height,
  );
  return {
    scale,
    x: (size - bounds.width * scale) / 2 - bounds.left * scale,
    y: (size - bounds.height * scale) / 2 - bounds.top * scale,
  };
}

export function worldViewport(size: number, radius: number): Viewport {
  return {
    pixelsPerUnit: size / (radius * 2),
    originX: size / 2,
    originY: size / 2,
  };
}

export function fittedViewport(
  measurementSize: number,
  radius: number,
  transform: PixelTransform,
): Viewport {
  const world = worldViewport(measurementSize, radius);
  return {
    pixelsPerUnit: world.pixelsPerUnit * transform.scale,
    originX: world.originX * transform.scale + transform.x,
    originY: world.originY * transform.scale + transform.y,
  };
}
