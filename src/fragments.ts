import { blend } from "./image.js";
const SHIFT = 16,
  LENGTH = 1 << SHIFT,
  MASK = LENGTH - 1;
/** Opaque depth uses one entry per pixel; translucent fragments share linked storage chunks. */
export class FragmentBuffer {
  private opaqueDepth: Float64Array;
  private opaque: Uint32Array;
  private opaqueOrder: Int32Array;
  private order: Uint32Array[] = [];
  private sequence = 0;
  private heads: Int32Array;
  private depth: Float64Array[] = [];
  private colors: Uint32Array[] = [];
  private next: Int32Array[] = [];
  private length = 0;
  constructor(private readonly pixels: number) {
    this.opaqueDepth = new Float64Array(pixels).fill(-Infinity);
    this.opaque = new Uint32Array(pixels);
    this.opaqueOrder = new Int32Array(pixels).fill(-1);
    this.heads = new Int32Array(pixels).fill(-1);
  }
  add(
    pixel: number,
    z: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
  ) {
    const sequence = this.sequence++;
    if (z < this.opaqueDepth[pixel]) return;
    const color = (r | (g << 8) | (b << 16) | (alpha << 24)) >>> 0;
    if (alpha === 255) {
      this.opaqueDepth[pixel] = z;
      this.opaque[pixel] = color;
      this.opaqueOrder[pixel] = sequence;
      return;
    }
    if (this.length >= 4_000_000)
      throw new Error("Model rasterization budget exceeded");
    const index = this.length++,
      chunk = index >>> SHIFT,
      slot = index & MASK;
    if (!this.depth[chunk]) {
      this.depth.push(new Float64Array(LENGTH));
      this.colors.push(new Uint32Array(LENGTH));
      this.next.push(new Int32Array(LENGTH));
      this.order.push(new Uint32Array(LENGTH));
    }
    this.depth[chunk][slot] = z;
    this.order[chunk][slot] = sequence;
    this.colors[chunk][slot] = color;
    this.next[chunk][slot] = this.heads[pixel];
    this.heads[pixel] = index;
  }
  composite(output: Uint8Array) {
    const ordered: number[] = [];
    const depth = (index: number) => this.depth[index >>> SHIFT][index & MASK];
    const paint = (pixel: number, color: number) =>
      blend(
        output,
        pixel * 4,
        color & 255,
        (color >>> 8) & 255,
        (color >>> 16) & 255,
        color >>> 24,
      );
    for (let pixel = 0; pixel < this.pixels; pixel++) {
      if (this.opaque[pixel]) paint(pixel, this.opaque[pixel]);
      ordered.length = 0;
      for (
        let index = this.heads[pixel];
        index >= 0;
        index = this.next[index >>> SHIFT][index & MASK]
      )
        if (
          depth(index) > this.opaqueDepth[pixel] ||
          (depth(index) === this.opaqueDepth[pixel] &&
            this.order[index >>> SHIFT][index & MASK] > this.opaqueOrder[pixel])
        )
          ordered.push(index);
      ordered.sort((a, b) => depth(a) - depth(b) || a - b);
      for (const index of ordered)
        paint(pixel, this.colors[index >>> SHIFT][index & MASK]);
    }
  }
}
