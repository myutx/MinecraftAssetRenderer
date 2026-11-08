import { decode, type DecodeCache, type Pixels } from "./image.js";
import { rasterModel, type RasterMaterial } from "./model.js";
import { skullFaceLight } from "./lighting.js";
import type { Viewport } from "./framing.js";
import type { FaceName, ModelElement } from "./types.js";

const skullMaterial: RasterMaterial = {
  lighting: skullFaceLight,
  cullBackFaces: false,
  twoSidedLighting: true,
  alphaCutout: 0.1,
};

export async function headImage(
  skin: Uint8Array,
  size: number,
  radius = 16,
  viewport?: Viewport,
  cache?: DecodeCache,
): Promise<Pixels> {
  const image = await decode(skin, cache);
  if (image.width !== 64 || ![32, 64].includes(image.height))
    throw new Error("Head skin must be 64×32 or 64×64");
  // The native X flip places the skin front on the south face.
  // Its top edge meets the bottom edge of the top texture tile.
  const regions: Record<FaceName, [number, number]> = {
    north: [24, 8],
    south: [8, 8],
    east: [16, 8],
    west: [0, 8],
    up: [8, 0],
    down: [16, 0],
  };
  const element = (outer: boolean): ModelElement => {
    const inflation = outer ? 0.25 : 0;
    return {
      // Item skulls use 0.25-unit hat inflation rather than the player model's 0.5 units.
      // Subtracting the model origin later places the cube center at y = -4.
      from: [4 - inflation, -inflation, 4 - inflation],
      to: [12 + inflation, 8 + inflation, 12 + inflation],
      faces: Object.fromEntries(
        Object.entries(regions).map(([name, [x, y]]) => [
          name,
          {
            texture: "#skin",
            uv: [
              (x + (outer ? 32 : 0)) / 4,
              // Reversing underside V keeps its front edge aligned after the skull X flip.
              ((y + (name === "down" ? 8 : 0)) * 16) / image.height,
              (x + (outer ? 32 : 0) + 8) / 4,
              ((y + (name === "down" ? 0 : 8)) * 16) / image.height,
            ],
          },
        ]),
      ),
    };
  };
  const elements = [element(false)];
  // A fully opaque hat region on a legacy 64×32 skin is unused texture space.
  let legacyOpaque = image.height === 32;
  if (legacyOpaque) {
    for (let y = 0; y < 32; y++)
      for (let x = 32; x < 64; x++)
        if (image.data[(y * 64 + x) * 4 + 3] < 128) legacyOpaque = false;
  }
  if (!legacyOpaque) elements.push(element(true));
  return rasterModel(
    {
      elements,
      display: { gui: { rotation: [30, 45, 0], translation: [0, 3, 0] } },
    },
    new Map([["skin", image]]),
    size,
    radius,
    viewport,
    skullMaterial,
  );
}
