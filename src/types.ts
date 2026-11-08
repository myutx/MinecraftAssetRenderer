export type Vec3 = readonly [number, number, number];
export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
export interface ModelFace {
  texture: string;
  uv?: readonly [number, number, number, number];
  rotation?: number;
  tintindex?: number;
}
export interface ModelElement {
  from: Vec3;
  to: Vec3;
  faces: Partial<Record<FaceName, ModelFace>>;
  rotation?: {
    origin: Vec3;
    axis: "x" | "y" | "z";
    angle: number;
    rescale?: boolean;
  };
  shade?: boolean;
}
export interface MinecraftModel {
  textures?: Readonly<Record<string, string>>;
  elements: readonly ModelElement[];
  display?: { gui?: { rotation?: Vec3; translation?: Vec3; scale?: Vec3 } };
  gui_light?: "front" | "side";
}
export type RenderPart =
  | { kind: "head"; skin: Uint8Array }
  | { kind: "flat"; layers: readonly { png: Uint8Array; tint?: string }[] }
  | {
      kind: "model";
      model: MinecraftModel;
      textures: Readonly<Record<string, Uint8Array>>;
      tints?: Readonly<Record<number, string>>;
    };
export interface RenderOptions {
  size?: number;
  /** Padding is measured in output pixels and defaults to one sixteenth of the output size. */
  padding?: number;
  /** Inventory framing fits visible pixels; canvas framing retains transparent source margins. */
  framing?: "inventory" | "canvas";
}
