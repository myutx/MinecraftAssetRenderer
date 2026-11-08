# Minecraft Asset Renderer

Server-side Minecraft item, head, and sprite rendering.

`minecraft-asset-renderer` turns PNG textures, skins and cuboid models into
Minecraft inventory images. It runs in Node.js without a browser. You handle
loading assets, resolving model inheritance, choosing resource packs and timing
animations.

## Install

Use Node.js 24 or newer and pnpm 11.25.0. The package is private and installed from a local archive.

From this directory, install the dependencies and pack the library:

```sh
pnpm install --frozen-lockfile
pnpm pack
```

Then install the archive in your project:

```sh
pnpm add ./minecraft-asset-renderer-1.0.0.tgz
```



## Usage

```js
import { readFile, writeFile } from "node:fs/promises";
import { renderFrame } from "minecraft-asset-renderer";

const png = await renderFrame(
  [{ kind: "head", skin: await readFile("skin.png") }],
  { size: 128, framing: "canvas" },
);
await writeFile("head.png", png);
```

Heads use a 64×32 or 64×64 PNG skin. Flat items use PNG layers with optional
six-digit hex tints, such as `#80FF80`. For cuboid models, pass the resolved model,
texture bytes and optional face tints.

Game and resource-pack assets aren't included.

Use `renderSprite(frames, options)` to create a vertical PNG sprite sheet with
one square cell per frame. All frames share the same framing so they stay
aligned. You supply the frames and control playback.

## Development

```sh
pnpm check
pnpm test
```

`pnpm check` builds the TypeScript. `pnpm test` builds it, tests the renderer and
checks that the packed library works in another project.

## API

The package exports `renderFrame`, `renderSprite`, `RENDERER_VERSION` and the
types in [src/types.ts](src/types.ts).

Both render functions return PNG bytes. Each frame is square, from 1 to 512 pixels
per side. Use `inventory` framing to fit the visible pixels, or `canvas` framing
to keep the source canvas, including transparent margins.

The renderer supports inventory-style cuboid models and player heads. Model
lighting is approximate. You'll need to resolve item IDs yourself. Full player
bodies and world scenes aren't supported.

## License

[AGPL-3.0-only](LICENSE).