# HeicScope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static React viewer that draws a HEIC's tiles and clean aperture in the pre-transform coordinate space and publishes it with GitHub Pages.

**Architecture:** A hand-written ISOBMFF parser produces item properties, grid placement, and the clean-aperture rectangle. `libheif-js/wasm-bundle` decodes either each grid tile or the primary image; rotation and mirror are undone so pixels stay in stored orientation. An SVG overlay shares the canvas coordinate space.

**Tech Stack:** Vite 6, React 19, TypeScript 5, Vitest 3, `libheif-js` 1.23.5 (`wasm-bundle`), Node 22, GitHub Actions.

## Global Constraints

- UI copy is English. Use the strings in `src/heif/messages.ts` exactly.
- Browser only. No server.
- `vite` `base` is `"./"`
- Decoder import is `libheif-js/wasm-bundle`. Do not emit a separate `.wasm` file.
- Structural canvas is before `clap`, `irot`, and `imir`. `irot` / `imir` appear as numbers, not as a pixel rotation of that canvas.
- `clap` math matches libheif 1.23.5 `Box_clap::get_crop`: integer rationals (`bigint`), left edge `round_down`, top/right/bottom `round` where `round(n/d) = (n + d/2) / d` with truncating division and `d > 0`. An image edge of exactly `2^31` is valid. An edge of `0` or greater than `2^31` makes the clean aperture malformed.
- Transformation order on the coded image is `clap`, then `irot` (counter-clockwise), then `imir`. Undo mirror first, then rotation.
- Pixel path decodes `dimg` children only when every child is `hvc1` or `hev1`, the count equals `rows * columns`, no child has `clap` / `irot` / `imir`, and every child decodes. Otherwise place the undone primary image at the clap origin.
- Geometry stays on screen when pixels are missing.
- Refuse pixel allocation until "Decode pixels anyway" when width or height is greater than 8192 or the area is greater than 16,000,000.
- Parser caps: 512 items, box nesting 32.
- Accepted brands, major or compatible: `mif1`, `heic`, `heix`, `hevc`.
- Samples live in `public/samples/` and are committed. CI does not run `heif-enc`.
- `irot-90.heic` is 128×64, not 64×32 (spec updated: heif-enc 1.19.7 writes a `clap` for sizes that are not multiples of 64).
- `clap-odd.heic` keeps `ispe` 32×32. libheif-js 1.23.5 refuses to decode it because the coded frame is 64×64. The viewer shows geometry only and `messages.primaryDecode`. Do not rewrite `ispe` before decode.
- App license MIT. Footer links to https://github.com/catdad-experiments/libheif-js with the text `Decoder: libheif-js (LGPL-3.0)`.
- No router, no old-versus-new dimension comparison, no box-tree browser, no AVIF brand, no `iovl` reconstruction.

---

## File map

- `src/heif/messages.ts` — every user-visible English string
- `src/heif/types.ts` — `HeifFile`, `Clap`, `Rgba`, `HeifError`
- `src/heif/clap.ts` — `cleanApertureRect`
- `src/isobmff/boxes.ts` — `readBoxes`
- `src/heif/parseHeif.ts` — `parseHeif`
- `src/heif/orient.ts` — `undoImir`, `undoIrot`, `expectedDecodedSize`
- `src/heif/decode.ts` — `renderPixels`
- `src/ui/App.tsx`, `src/ui/Viewport.tsx`, `src/ui/SidePanel.tsx`, `src/ui/labels.ts`
- `src/styles.css`, `src/main.tsx`, `index.html`
- `tests/boxBuilder.ts` — synthetic HEIF bytes
- `tests/clap.test.ts`, `tests/parseHeif.test.ts`, `tests/orient.test.ts`, `tests/decode.test.ts`, `tests/labels.test.ts`
- `scripts/generate-samples.mjs`
- `public/samples/clap-odd.heic`, `grid-small-canvas.heic`, `irot-90.heic`
- `.github/workflows/pages.yml`, `LICENSE`, `THIRD_PARTY_NOTICES.md`

---

### Task 1: Scaffold and clean-aperture math

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/heif/messages.ts`, `src/heif/types.ts`, `src/heif/clap.ts`, `tests/clap.test.ts`, `src/main.tsx`, `src/ui/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export class HeifError extends Error`
  - `export type Fraction = { numerator: bigint; denominator: bigint }`
  - `export type Clap = { width: Fraction; height: Fraction; horizontalOffset: Fraction; verticalOffset: Fraction }`
  - `export type PixelRect = { x: number; y: number; width: number; height: number }`
  - `export function cleanApertureRect(clap: Clap, imageWidth: number, imageHeight: number): PixelRect | null`
  - `export const messages` (see Step 3)

- [ ] **Step 1: Select Node 22 and write the failing test**

If `node -v` is not v22, prepend a Node 22 install to `PATH` (on this machine: `/Users/admin/.asdf/installs/nodejs/v22.23.4/bin`).

Create `tests/clap.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { cleanApertureRect } from "../src/heif/clap";
import type { Clap } from "../src/heif/types";

function clap(
  widthN: number,
  widthD: number,
  heightN: number,
  heightD: number,
  horizN: number,
  horizD: number,
  vertN: number,
  vertD: number,
): Clap {
  return {
    width: { numerator: BigInt(widthN), denominator: BigInt(widthD) },
    height: { numerator: BigInt(heightN), denominator: BigInt(heightD) },
    horizontalOffset: { numerator: BigInt(horizN), denominator: BigInt(horizD) },
    verticalOffset: { numerator: BigInt(vertN), denominator: BigInt(vertD) },
  };
}

describe("cleanApertureRect", () => {
  it("crops one column off the right of a 32x32 image", () => {
    expect(cleanApertureRect(clap(31, 1, 32, 1, -1, 2, 0, 1), 32, 32)).toEqual({
      x: 0,
      y: 0,
      width: 31,
      height: 32,
    });
  });

  it("centers a 16x16 window when offsets are zero", () => {
    expect(cleanApertureRect(clap(16, 1, 16, 1, 0, 1, 0, 1), 32, 32)).toEqual({
      x: 8,
      y: 8,
      width: 16,
      height: 16,
    });
  });

  it("returns null when a denominator is zero", () => {
    expect(cleanApertureRect(clap(31, 0, 32, 1, 0, 1, 0, 1), 32, 32)).toBeNull();
  });

  it("accepts an image whose edge is exactly 2^31", () => {
    expect(cleanApertureRect(clap(1, 1, 1, 1, 0, 1, 0, 1), 2147483648, 1)).toEqual({
      x: 1073741823,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("returns null when an edge is greater than 2^31", () => {
    expect(cleanApertureRect(clap(1, 1, 1, 1, 0, 1, 0, 1), 2147483649, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/clap.test.ts`

Expected: FAIL because `src/heif/clap.ts` does not exist. Vitest itself may also be missing until Step 3; install dependencies in Step 3 before re-running if the failure is `vitest: command not found`. After install, the assertion failure or missing module is the expected red result.

- [ ] **Step 3: Write the project files and the implementation**

`package.json`:

```json
{
  "name": "heicscope",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "libheif-js": "1.23.5",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

`vite.config.ts`:

```typescript
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    server: { deps: { inline: ["libheif-js"] } },
  },
});
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HeicScope</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/heif/messages.ts`:

```typescript
export const messages = {
  notHeif: "This file is not a HEIF image.",
  truncated: (offset: number) => `Truncated box at offset ${offset}.`,
  limits: "This HEIF file exceeds the parser limits.",
  noImage: "This file has no image item.",
  primaryFallback: "Primary item was missing. Showing the first image item.",
  clapIgnored: "Clean aperture was ignored because it is malformed.",
  gridNoIspe: "The grid item has no stored size. The clean aperture uses the grid output size.",
  sizeDiffer: "Stored size and grid output size differ.",
  tileCount:
    "Tile count does not match the grid. Showing the composed image placed in the grid output.",
  tileTransform:
    "A tile has its own transformations. Showing the composed image placed in the grid output.",
  tileDecode:
    "Tile decode failed. Showing the composed image placed in the grid output. Pixels outside that rectangle are not available.",
  tileSize: (id: number, w: number, h: number, sw: number, sh: number) =>
    `Tile ${id} decoded at ${w}×${h}; stored size is ${sw}×${sh}.`,
  tileNoSize: (id: number) => `Tile ${id} has no stored size.`,
  decodedMismatch: "Decoded size does not match the clean aperture. Showing geometry only.",
  overlay: "Overlay images are not reconstructed.",
  decoderLoad: "Decoder failed to load.",
  primaryDecode: "The primary image could not be decoded. Showing geometry only.",
  tooLarge: (w: number, h: number) =>
    `This image is too large to decode in the browser (${w}×${h}). Showing geometry only.`,
  buffer: "The browser refused to allocate the pixel buffer.",
  gridUnread: "The grid image data could not be read.",
};
```

`src/heif/types.ts`:

```typescript
export class HeifError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeifError";
  }
}

export type Fraction = { numerator: bigint; denominator: bigint };

export type Clap = {
  width: Fraction;
  height: Fraction;
  horizontalOffset: Fraction;
  verticalOffset: Fraction;
};

export type PixelRect = { x: number; y: number; width: number; height: number };

export type ItemKind = "grid" | "hvc1" | "hev1" | "iovl" | "other";

export type ItemProperties = {
  ispe?: { width: number; height: number };
  clap?: Clap;
  irot?: 0 | 1 | 2 | 3;
  imir?: 0 | 1;
};

export type HeifItem = {
  id: number;
  kind: ItemKind;
  hidden: boolean;
  properties: ItemProperties;
  children: number[];
};

export type TileCell = {
  id: number;
  column: number;
  row: number;
  x: number;
  y: number;
  storedWidth: number;
  storedHeight: number;
};

export type Grid = {
  rows: number;
  columns: number;
  outputWidth: number;
  outputHeight: number;
  tiles: TileCell[];
};

export type HeifFile = {
  primaryItemId: number;
  items: HeifItem[];
  grid: Grid | null;
  canvas: { width: number; height: number };
  clapRect: PixelRect | null;
  warnings: string[];
};

export type Rgba = { width: number; height: number; data: Uint8ClampedArray };
```

`src/heif/clap.ts`:

```typescript
import type { Clap, Fraction, PixelRect } from "./types";

const INT32_MAX = 2147483647n;

type Fr = { n: bigint; d: bigint };

function truncDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator;
}

function roundFraction(numerator: bigint, denominator: bigint): bigint {
  return truncDiv(numerator + truncDiv(denominator, 2n), denominator);
}

function fr(value: Fraction): Fr {
  return value.denominator < 0n
    ? { n: -value.numerator, d: -value.denominator }
    : { n: value.numerator, d: value.denominator };
}

function add(a: Fr, b: Fr): Fr {
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}

function sub(a: Fr, b: Fr): Fr {
  return add(a, { n: -b.n, d: b.d });
}

function fractionAllowed(value: Fraction): boolean {
  if (value.denominator === 0n || value.denominator < 0n || value.denominator > INT32_MAX) return false;
  const magnitude = value.numerator < 0n ? -value.numerator : value.numerator;
  return magnitude <= INT32_MAX;
}

export function cleanApertureRect(clap: Clap, imageWidth: number, imageHeight: number): PixelRect | null {
  if (
    !fractionAllowed(clap.width) ||
    !fractionAllowed(clap.height) ||
    !fractionAllowed(clap.horizontalOffset) ||
    !fractionAllowed(clap.verticalOffset)
  ) {
    return null;
  }
  if (imageWidth <= 0 || imageHeight <= 0 || imageWidth > 2 ** 31 || imageHeight > 2 ** 31) return null;

  const width = fr(clap.width);
  const height = fr(clap.height);
  const halfW: Fr = { n: BigInt(imageWidth - 1), d: 2n };
  const halfH: Fr = { n: BigInt(imageHeight - 1), d: 2n };
  const leftFr = sub(add(fr(clap.horizontalOffset), halfW), { n: width.n - width.d, d: width.d * 2n });
  const topFr = sub(add(fr(clap.verticalOffset), halfH), { n: height.n - height.d, d: height.d * 2n });
  const left = Number(truncDiv(leftFr.n, leftFr.d));
  const top = Number(roundFraction(topFr.n, topFr.d));
  const right = Number(roundFraction(width.n - width.d + BigInt(left) * width.d, width.d));
  const bottom = Number(roundFraction(height.n - height.d + BigInt(top) * height.d, height.d));
  if (left > right || top > bottom) return null;

  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const clampedRight = Math.min(imageWidth - 1, right);
  const clampedBottom = Math.min(imageHeight - 1, bottom);
  const rectWidth = clampedRight - x + 1;
  const rectHeight = clampedBottom - y + 1;
  if (rectWidth <= 0 || rectHeight <= 0) return null;
  return { x, y, width: rectWidth, height: rectHeight };
}
```

`src/styles.css`:

```css
:root {
  color: #e8e8e8;
  background: #111;
  font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
}
body { margin: 0; }
button, label { font: inherit; }
```

`src/ui/App.tsx`:

```tsx
export function App() {
  return <h1>HeicScope</h1>;
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Run `npm install`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/clap.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests
git commit -m "$(cat <<'EOF'
Add clean-aperture rectangle math for the HEIC viewer.

EOF
)"
```

---

### Task 2: ISOBMFF box reader

**Files:**
- Create: `src/isobmff/boxes.ts`, `tests/boxes.test.ts`
- Modify: none

**Interfaces:**
- Consumes: `HeifError`, `messages.truncated`
- Produces:
  - `export type IsoBox = { type: string; start: number; header: number; size: number; dataStart: number; dataEnd: number }`
  - `export function readBoxes(data: Uint8Array, start: number, end: number): IsoBox[]`

- [ ] **Step 1: Write the failing test**

`tests/boxes.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readBoxes } from "../src/isobmff/boxes";
import { HeifError } from "../src/heif/types";

describe("readBoxes", () => {
  it("reads a size-0 box as extending to the parent end", () => {
    const data = new Uint8Array(20);
    data.set(new TextEncoder().encode("free"), 4);
    data.set([1, 2, 3, 4], 8);
    const boxes = readBoxes(data, 0, 12);
    expect(boxes).toEqual([
      {
        type: "free",
        start: 0,
        header: 8,
        size: 12,
        dataStart: 8,
        dataEnd: 12,
      },
    ]);
  });

  it("throws with the box offset when the declared size runs past the buffer", () => {
    const data = new Uint8Array(16);
    const view = new DataView(data.buffer);
    view.setUint32(0, 40);
    data.set(new TextEncoder().encode("free"), 4);
    expect(() => readBoxes(data, 0, data.length)).toThrow(HeifError);
    expect(() => readBoxes(data, 0, data.length)).toThrow("Truncated box at offset 0.");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/boxes.test.ts`

Expected: FAIL, cannot find `src/isobmff/boxes.ts`.

- [ ] **Step 3: Implement the reader**

`src/isobmff/boxes.ts`:

```typescript
import { messages } from "../heif/messages";
import { HeifError } from "../heif/types";

export type IsoBox = {
  type: string;
  start: number;
  header: number;
  size: number;
  dataStart: number;
  dataEnd: number;
};

function fourcc(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0);
}

export function readBoxes(data: Uint8Array, start: number, end: number): IsoBox[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) throw new HeifError(messages.truncated(offset));
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new HeifError(messages.truncated(offset));
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new HeifError(messages.truncated(offset));
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) throw new HeifError(messages.truncated(offset));
    boxes.push({
      type: fourcc(data, offset + 4),
      start: offset,
      header,
      size,
      dataStart: offset + header,
      dataEnd: offset + size,
    });
    offset += size;
  }
  return boxes;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/boxes.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/isobmff/boxes.ts tests/boxes.test.ts
git commit -m "$(cat <<'EOF'
Read ISOBMFF box headers, including boxes that extend to the parent end.

EOF
)"
```

---

### Task 3: HEIF parser and grid placement

**Files:**
- Create: `src/heif/parseHeif.ts`, `tests/boxBuilder.ts`, `tests/parseHeif.test.ts`

**Interfaces:**
- Consumes: `readBoxes`, `cleanApertureRect`, `messages`, types from Task 1
- Produces: `export function parseHeif(data: Uint8Array): HeifFile`

- [ ] **Step 1: Write the box builder and failing parser tests**

`tests/boxBuilder.ts`:

```typescript
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(payload, 8);
  return out;
}

export function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + payload.length);
  body[0] = version;
  body[1] = (flags >> 16) & 0xff;
  body[2] = (flags >> 8) & 0xff;
  body[3] = flags & 0xff;
  body.set(payload, 4);
  return box(type, body);
}

export function ftyp(major: string, compatible: string[]): Uint8Array {
  const payload = new Uint8Array(8 + compatible.length * 4);
  payload.set(ascii(major), 0);
  let offset = 8;
  for (const brand of compatible) {
    payload.set(ascii(brand), offset);
    offset += 4;
  }
  return box("ftyp", payload);
}

export function infe(id: number, type: string, hidden = false): Uint8Array {
  const payload = new Uint8Array(9);
  const view = new DataView(payload.buffer);
  view.setUint16(0, id);
  view.setUint16(2, 0);
  payload.set(ascii(type), 4);
  return fullBox("infe", 2, hidden ? 1 : 0, payload);
}

export function iinf(items: Uint8Array[]): Uint8Array {
  const count = new Uint8Array(2);
  new DataView(count.buffer).setUint16(0, items.length);
  return fullBox("iinf", 0, 0, concatBytes([count, ...items]));
}

export function pitm(id: number): Uint8Array {
  const payload = new Uint8Array(2);
  new DataView(payload.buffer).setUint16(0, id);
  return fullBox("pitm", 0, 0, payload);
}

export function hdlr(): Uint8Array {
  const payload = new Uint8Array(21);
  payload.set(ascii("pict"), 4);
  return fullBox("hdlr", 0, 0, payload);
}

export function ispe(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  return fullBox("ispe", 0, 0, payload);
}

export function clapBox(
  widthN: number,
  widthD: number,
  heightN: number,
  heightD: number,
  horizN: number,
  horizD: number,
  vertN: number,
  vertD: number,
): Uint8Array {
  const payload = new Uint8Array(32);
  const view = new DataView(payload.buffer);
  view.setUint32(0, widthN);
  view.setUint32(4, widthD);
  view.setUint32(8, heightN);
  view.setUint32(12, heightD);
  view.setInt32(16, horizN);
  view.setUint32(20, horizD);
  view.setInt32(24, vertN);
  view.setUint32(28, vertD);
  return box("clap", payload);
}

export function irot(angle: number): Uint8Array {
  return box("irot", Uint8Array.of(angle));
}

export function imir(axis: number): Uint8Array {
  return box("imir", Uint8Array.of(axis));
}

export function ipma(entries: { id: number; indexes: number[] }[]): Uint8Array {
  let size = 4;
  for (const entry of entries) size += 3 + entry.indexes.length;
  const payload = new Uint8Array(size);
  const view = new DataView(payload.buffer);
  view.setUint32(0, entries.length);
  let offset = 4;
  for (const entry of entries) {
    view.setUint16(offset, entry.id);
    offset += 2;
    payload[offset] = entry.indexes.length;
    offset += 1;
    for (const index of entry.indexes) payload[offset++] = index & 0x7f;
  }
  return fullBox("ipma", 0, 0, payload);
}

export function dimg(from: number, to: number[]): Uint8Array {
  const body = new Uint8Array(4 + to.length * 2);
  const view = new DataView(body.buffer);
  view.setUint16(0, from);
  view.setUint16(2, to.length);
  to.forEach((id, index) => view.setUint16(4 + index * 2, id));
  return fullBox("iref", 0, 0, box("dimg", body));
}

export function imageGrid(rows: number, columns: number, width: number, height: number, wide: boolean): Uint8Array {
  if (!wide) {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    payload[0] = 0;
    payload[1] = 0;
    payload[2] = rows - 1;
    payload[3] = columns - 1;
    view.setUint16(4, width);
    view.setUint16(6, height);
    return payload;
  }
  const payload = new Uint8Array(12);
  const view = new DataView(payload.buffer);
  payload[0] = 0;
  payload[1] = 1;
  payload[2] = rows - 1;
  payload[3] = columns - 1;
  view.setUint32(4, width);
  view.setUint32(8, height);
  return payload;
}

export function ilocInIdat(itemId: number, length: number): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  payload[0] = 0x44;
  payload[1] = 0x00;
  view.setUint16(2, 1);
  view.setUint16(4, itemId);
  view.setUint16(6, 1);
  view.setUint16(8, 0);
  view.setUint16(10, 1);
  view.setUint32(12, 0);
  view.setUint32(16, length);
  return fullBox("iloc", 1, 0, payload);
}

export type ItemSpec = {
  id: number;
  type: string;
  hidden?: boolean;
  properties: Uint8Array[];
};

export function assemble(options: {
  brands?: string[];
  pitm?: number | null;
  items: ItemSpec[];
  dimg?: { from: number; to: number[] };
  grid?: { itemId: number; body: Uint8Array };
}): Uint8Array {
  const properties: Uint8Array[] = [];
  const associations: { id: number; indexes: number[] }[] = [];
  for (const item of options.items) {
    const indexes: number[] = [];
    for (const property of item.properties) {
      properties.push(property);
      indexes.push(properties.length);
    }
    associations.push({ id: item.id, indexes });
  }
  const children = [
    hdlr(),
    ...(options.pitm === null ? [] : [pitm(options.pitm ?? options.items[0]?.id ?? 1)]),
    ...(options.grid ? [box("idat", options.grid.body), ilocInIdat(options.grid.itemId, options.grid.body.length)] : []),
    iinf(options.items.map((item) => infe(item.id, item.type, item.hidden))),
    box("iprp", concatBytes([box("ipco", concatBytes(properties)), ipma(associations)])),
    ...(options.dimg ? [dimg(options.dimg.from, options.dimg.to)] : []),
  ];
  return concatBytes([
    ftyp("heic", options.brands ?? ["mif1", "heic"]),
    fullBox("meta", 0, 0, concatBytes(children)),
  ]);
}
```

`tests/parseHeif.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseHeif } from "../src/heif/parseHeif";
import { HeifError } from "../src/heif/types";
import { assemble, clapBox, imageGrid, imir, irot, ispe } from "./boxBuilder";

describe("parseHeif", () => {
  it("keeps the last ispe associated with an item", () => {
    const file = assemble({
      items: [{ id: 1, type: "hvc1", properties: [ispe(10, 10), ispe(32, 16)] }],
    });
    const parsed = parseHeif(file);
    expect(parsed.primaryItemId).toBe(1);
    expect(parsed.canvas).toEqual({ width: 32, height: 16 });
    expect(parsed.items[0]?.properties.ispe).toEqual({ width: 32, height: 16 });
  });

  it("places a 31x32 clean aperture on a 32x32 image", () => {
    const file = assemble({
      items: [{ id: 1, type: "hvc1", properties: [ispe(32, 32), clapBox(31, 1, 32, 1, -1, 2, 0, 1)] }],
    });
    expect(parseHeif(file).clapRect).toEqual({ x: 0, y: 0, width: 31, height: 32 });
  });

  it("ignores a clean aperture with a zero denominator", () => {
    const file = assemble({
      items: [{ id: 1, type: "hvc1", properties: [ispe(32, 32), clapBox(31, 0, 32, 1, 0, 1, 0, 1)] }],
    });
    const parsed = parseHeif(file);
    expect(parsed.clapRect).toBeNull();
    expect(parsed.warnings).toContain("Clean aperture was ignored because it is malformed.");
  });

  it("reads irot and imir", () => {
    const file = assemble({
      items: [{ id: 1, type: "hvc1", properties: [ispe(128, 64), irot(1), imir(0)] }],
    });
    const properties = parseHeif(file).items[0]?.properties;
    expect(properties?.irot).toBe(1);
    expect(properties?.imir).toBe(0);
  });

  it("lays out a 16-bit image grid from idat", () => {
    const file = assemble({
      pitm: 1,
      items: [
        { id: 1, type: "grid", properties: [ispe(15, 20)] },
        { id: 2, type: "hvc1", hidden: true, properties: [ispe(10, 20)] },
        { id: 3, type: "hvc1", hidden: true, properties: [ispe(10, 20)] },
      ],
      dimg: { from: 1, to: [2, 3] },
      grid: { itemId: 1, body: imageGrid(1, 2, 15, 20, false) },
    });
    const parsed = parseHeif(file);
    expect(parsed.grid).toMatchObject({ rows: 1, columns: 2, outputWidth: 15, outputHeight: 20 });
    expect(parsed.canvas).toEqual({ width: 20, height: 20 });
    expect(parsed.grid?.tiles.map((tile) => [tile.id, tile.x, tile.y])).toEqual([
      [2, 0, 0],
      [3, 10, 0],
    ]);
  });

  it("reads a 32-bit image grid output size", () => {
    const file = assemble({
      items: [
        { id: 1, type: "grid", properties: [ispe(70000, 10)] },
        { id: 2, type: "hvc1", properties: [ispe(70000, 10)] },
      ],
      dimg: { from: 1, to: [2] },
      grid: { itemId: 1, body: imageGrid(1, 1, 70000, 10, true) },
    });
    expect(parseHeif(file).grid?.outputWidth).toBe(70000);
  });

  it("falls back to the first image item when pitm is absent", () => {
    const file = assemble({
      pitm: null,
      items: [{ id: 7, type: "hvc1", properties: [ispe(4, 4)] }],
    });
    const parsed = parseHeif(file);
    expect(parsed.primaryItemId).toBe(7);
    expect(parsed.warnings).toContain("Primary item was missing. Showing the first image item.");
  });

  it("rejects a file whose brands are not HEIF", () => {
    const file = assemble({
      brands: ["avif"],
      items: [{ id: 1, type: "hvc1", properties: [ispe(1, 1)] }],
    });
    expect(() => parseHeif(file)).toThrow("This file is not a HEIF image.");
  });

  it("reports the offset of a truncated box", () => {
    const file = assemble({ items: [{ id: 1, type: "hvc1", properties: [ispe(4, 4)] }] });
    const cut = file.slice(0, 20);
    expect(() => parseHeif(cut)).toThrow(HeifError);
    expect(() => parseHeif(cut)).toThrow(/Truncated box at offset \d+\./);
  });
});
```

The brand test passes `brands: ["avif"]` as the compatible list while `ftyp()` still writes major brand `heic`. Change `assemble` so `options.brands` replaces both the major brand and the compatible list: major is `options.brands[0]`, compatible is `options.brands`. Update `ftyp("heic", options.brands ?? ["mif1", "heic"])` to:

```typescript
const brands = options.brands ?? ["mif1", "heic"];
ftyp(brands[0] ?? "heic", brands);
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/parseHeif.test.ts`

Expected: FAIL, `parseHeif` is not defined.

- [ ] **Step 3: Implement `parseHeif`**

`src/heif/parseHeif.ts`:

```typescript
import { readBoxes, type IsoBox } from "../isobmff/boxes";
import { cleanApertureRect } from "./clap";
import { messages } from "./messages";
import type { Clap, Grid, HeifFile, HeifItem, ItemKind, ItemProperties, TileCell } from "./types";
import { HeifError } from "./types";

const HEIF_BRANDS = new Set(["mif1", "heic", "heix", "hevc"]);
const MAX_ITEMS = 512;

function fourcc(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0);
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function u16(data: Uint8Array, offset: number): number {
  return view(data).getUint16(offset);
}

function u32(data: Uint8Array, offset: number): number {
  return view(data).getUint32(offset);
}

function i32(data: Uint8Array, offset: number): number {
  return view(data).getInt32(offset);
}

function payloadOf(data: Uint8Array, box: IsoBox): { version: number; flags: number; at: number } {
  if (box.dataStart + 4 > box.dataEnd) throw new HeifError(messages.truncated(box.start));
  const flags = (data[box.dataStart + 1] << 16) | (data[box.dataStart + 2] << 8) | data[box.dataStart + 3];
  return { version: data[box.dataStart], flags, at: box.dataStart + 4 };
}

function kindOf(type: string): ItemKind {
  if (type === "grid" || type === "hvc1" || type === "hev1" || type === "iovl") return type;
  return "other";
}

function findBox(boxes: IsoBox[], type: string): IsoBox | undefined {
  return boxes.find((box) => box.type === type);
}

type RawProperty =
  | { type: "ispe"; width: number; height: number }
  | { type: "clap"; clap: Clap }
  | { type: "irot"; angle: 0 | 1 | 2 | 3 }
  | { type: "imir"; axis: 0 | 1 }
  | { type: "other" };

function readProperty(data: Uint8Array, box: IsoBox): RawProperty {
  if (box.type === "ispe") {
    const body = payloadOf(data, box);
    return { type: "ispe", width: u32(data, body.at), height: u32(data, body.at + 4) };
  }
  if (box.type === "clap") {
    return {
      type: "clap",
      clap: {
        width: { numerator: BigInt(u32(data, box.dataStart)), denominator: BigInt(u32(data, box.dataStart + 4)) },
        height: { numerator: BigInt(u32(data, box.dataStart + 8)), denominator: BigInt(u32(data, box.dataStart + 12)) },
        horizontalOffset: { numerator: BigInt(i32(data, box.dataStart + 16)), denominator: BigInt(u32(data, box.dataStart + 20)) },
        verticalOffset: { numerator: BigInt(i32(data, box.dataStart + 24)), denominator: BigInt(u32(data, box.dataStart + 28)) },
      },
    };
  }
  if (box.type === "irot") return { type: "irot", angle: (data[box.dataStart] & 3) as 0 | 1 | 2 | 3 };
  if (box.type === "imir") return { type: "imir", axis: (data[box.dataStart] & 1) as 0 | 1 };
  return { type: "other" };
}

type Extent = { method: number; offset: number; length: number };

function readIloc(data: Uint8Array, box: IsoBox): Map<number, Extent[]> {
  const body = payloadOf(data, box);
  let at = body.at;
  const offsetSize = data[at] >> 4;
  const lengthSize = data[at] & 0x0f;
  at += 1;
  const baseSize = data[at] >> 4;
  const indexSize = body.version >= 1 ? data[at] & 0x0f : 0;
  at += 1;
  const count = body.version < 2 ? u16(data, at) : u32(data, at);
  at += body.version < 2 ? 2 : 4;
  if (count > MAX_ITEMS) throw new HeifError(messages.limits);
  const map = new Map<number, Extent[]>();
  const readN = (size: number) => {
    let value = 0;
    for (let i = 0; i < size; i += 1) value = value * 256 + data[at + i];
    at += size;
    return value;
  };
  for (let index = 0; index < count; index += 1) {
    const id = body.version < 2 ? u16(data, at) : u32(data, at);
    at += body.version < 2 ? 2 : 4;
    let method = 0;
    if (body.version === 1 || body.version === 2) {
      method = u16(data, at) & 0x0f;
      at += 2;
    }
    at += 2;
    const base = baseSize ? readN(baseSize) : 0;
    const extents = u16(data, at);
    at += 2;
    const list: Extent[] = [];
    for (let extent = 0; extent < extents; extent += 1) {
      if ((body.version === 1 || body.version === 2) && indexSize) at += indexSize;
      const offset = (offsetSize ? readN(offsetSize) : 0) + base;
      const length = lengthSize ? readN(lengthSize) : 0;
      list.push({ method, offset, length });
    }
    map.set(id, list);
  }
  return map;
}

function readItemBytes(data: Uint8Array, extents: Extent[], idat: IsoBox | undefined): Uint8Array | null {
  const parts: Uint8Array[] = [];
  for (const extent of extents) {
    if (extent.method === 1) {
      if (!idat) return null;
      const start = idat.dataStart + extent.offset;
      const end = start + extent.length;
      if (end > idat.dataEnd) return null;
      parts.push(data.slice(start, end));
    } else if (extent.method === 0) {
      const end = extent.offset + extent.length;
      if (extent.offset < 0 || end > data.length) return null;
      parts.push(data.slice(extent.offset, end));
    } else {
      return null;
    }
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function layoutTiles(
  columns: number,
  rows: number,
  children: { id: number; width: number; height: number }[],
  outputWidth: number,
  outputHeight: number,
): { canvas: { width: number; height: number }; tiles: TileCell[] } {
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  for (let column = 0; column < columns; column += 1) columnWidths.push(children[column]?.width ?? 0);
  for (let row = 0; row < rows; row += 1) rowHeights.push(children[row * columns]?.height ?? 0);
  const tiles: TileCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const child = children[row * columns + column];
      if (!child) continue;
      const x = columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0);
      const y = rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0);
      tiles.push({
        id: child.id,
        column,
        row,
        x,
        y,
        storedWidth: child.width,
        storedHeight: child.height,
      });
    }
  }
  const tiledWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const tiledHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  return {
    canvas: { width: Math.max(tiledWidth, outputWidth), height: Math.max(tiledHeight, outputHeight) },
    tiles,
  };
}

export function parseHeif(data: Uint8Array): HeifFile {
  const top = readBoxes(data, 0, data.length);
  const ftyp = findBox(top, "ftyp");
  if (!ftyp) throw new HeifError(messages.notHeif);
  const major = fourcc(data, ftyp.dataStart);
  const compatible: string[] = [];
  for (let offset = ftyp.dataStart + 8; offset + 4 <= ftyp.dataEnd; offset += 4) compatible.push(fourcc(data, offset));
  if (![major, ...compatible].some((brand) => HEIF_BRANDS.has(brand))) throw new HeifError(messages.notHeif);

  const meta = findBox(top, "meta");
  if (!meta) throw new HeifError(messages.noImage);
  const metaBody = payloadOf(data, meta);
  const metaBoxes = readBoxes(data, metaBody.at, meta.dataEnd);
  const warnings: string[] = [];

  const iinf = findBox(metaBoxes, "iinf");
  if (!iinf) throw new HeifError(messages.noImage);
  const iinfBody = payloadOf(data, iinf);
  const entryCount = iinfBody.version === 0 ? u16(data, iinfBody.at) : u32(data, iinfBody.at);
  if (entryCount > MAX_ITEMS) throw new HeifError(messages.limits);
  const infeBoxes = readBoxes(data, iinfBody.at + (iinfBody.version === 0 ? 2 : 4), iinf.dataEnd);
  const items = new Map<number, HeifItem>();
  for (const infe of infeBoxes) {
    if (infe.type !== "infe") continue;
    const body = payloadOf(data, infe);
    const id = body.version >= 3 ? u32(data, body.at) : u16(data, body.at);
    const typeAt = body.version >= 3 ? body.at + 6 : body.at + 4;
    items.set(id, {
      id,
      kind: kindOf(fourcc(data, typeAt)),
      hidden: (body.flags & 1) === 1,
      properties: {},
      children: [],
    });
  }

  const iref = findBox(metaBoxes, "iref");
  if (iref) {
    const body = payloadOf(data, iref);
    for (const reference of readBoxes(data, body.at, iref.dataEnd)) {
      if (reference.type !== "dimg") continue;
      const wide = body.version >= 1;
      const from = wide ? u32(data, reference.dataStart) : u16(data, reference.dataStart);
      const countAt = reference.dataStart + (wide ? 4 : 2);
      const count = u16(data, countAt);
      const children: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const at = countAt + 2 + index * (wide ? 4 : 2);
        children.push(wide ? u32(data, at) : u16(data, at));
      }
      const parent = items.get(from);
      if (parent) parent.children = children;
    }
  }

  const iprp = findBox(metaBoxes, "iprp");
  if (iprp) {
    const inner = readBoxes(data, iprp.dataStart, iprp.dataEnd);
    const ipco = findBox(inner, "ipco");
    const ipma = findBox(inner, "ipma");
    const properties = ipco ? readBoxes(data, ipco.dataStart, ipco.dataEnd).map((box) => readProperty(data, box)) : [];
    if (ipma) {
      const body = payloadOf(data, ipma);
      let at = body.at;
      const entries = u32(data, at);
      at += 4;
      const wideId = body.version >= 1;
      const wideIndex = (body.flags & 1) === 1;
      for (let index = 0; index < entries; index += 1) {
        const id = wideId ? u32(data, at) : u16(data, at);
        at += wideId ? 4 : 2;
        const count = data[at] ?? 0;
        at += 1;
        const item = items.get(id);
        for (let assoc = 0; assoc < count; assoc += 1) {
          let propertyIndex = 0;
          if (wideIndex) {
            propertyIndex = u16(data, at) & 0x7fff;
            at += 2;
          } else {
            propertyIndex = (data[at] ?? 0) & 0x7f;
            at += 1;
          }
          const property = properties[propertyIndex - 1];
          if (!item || !property) continue;
          if (property.type === "ispe") item.properties.ispe = { width: property.width, height: property.height };
          if (property.type === "clap") item.properties.clap = property.clap;
          if (property.type === "irot") item.properties.irot = property.angle;
          if (property.type === "imir") item.properties.imir = property.axis;
        }
      }
    }
  }

  const imageItems = [...items.values()].filter((item) => item.kind === "grid" || item.kind === "hvc1" || item.kind === "hev1");
  const pitmBox = findBox(metaBoxes, "pitm");
  let primaryId = pitmBox
    ? (() => {
        const body = payloadOf(data, pitmBox);
        return body.version === 0 ? u16(data, body.at) : u32(data, body.at);
      })()
    : 0;
  if (!items.has(primaryId)) {
    const fallback =
      imageItems.find((item) => item.kind === "grid" && !item.hidden) ??
      imageItems.find((item) => (item.kind === "hvc1" || item.kind === "hev1") && !item.hidden) ??
      imageItems[0];
    if (!fallback) throw new HeifError(messages.noImage);
    primaryId = fallback.id;
    warnings.push(messages.primaryFallback);
  }
  const primary = items.get(primaryId);
  if (!primary) throw new HeifError(messages.noImage);

  let grid: Grid | null = null;
  let canvas = primary.properties.ispe ?? { width: 0, height: 0 };
  if (primary.kind === "grid") {
    const idat = findBox(metaBoxes, "idat");
    const iloc = findBox(metaBoxes, "iloc");
    const extents = iloc ? readIloc(data, iloc).get(primary.id) : undefined;
    const bytes = extents ? readItemBytes(data, extents, idat) : null;
    if (!bytes || bytes.length < 4 || bytes[0] !== 0) {
      warnings.push(messages.gridUnread);
    } else {
      const flags = bytes[1] ?? 0;
      const rows = (bytes[2] ?? 0) + 1;
      const columns = (bytes[3] ?? 0) + 1;
      const wide = (flags & 1) === 1;
      const outputWidth = wide ? u32(bytes, 4) : u16(bytes, 4);
      const outputHeight = wide ? u32(bytes, 8) : u16(bytes, 6);
      const childItems = primary.children.map((id) => items.get(id));
      const missingSize = childItems.find((item) => item && !item.properties.ispe);
      if (missingSize) warnings.push(messages.tileNoSize(missingSize.id));
      const layout = layoutTiles(
        columns,
        rows,
        childItems.map((item) => ({
          id: item?.id ?? 0,
          width: item?.properties.ispe?.width ?? 0,
          height: item?.properties.ispe?.height ?? 0,
        })),
        outputWidth,
        outputHeight,
      );
      grid = { rows, columns, outputWidth, outputHeight, tiles: layout.tiles };
      canvas = layout.canvas;
      if (!primary.properties.ispe) warnings.push(messages.gridNoIspe);
      else if (primary.properties.ispe.width !== outputWidth || primary.properties.ispe.height !== outputHeight) {
        warnings.push(messages.sizeDiffer);
      }
    }
  }

  const reference = primary.properties.ispe ?? (grid ? { width: grid.outputWidth, height: grid.outputHeight } : canvas);
  let clapRect = null;
  if (primary.properties.clap) {
    clapRect = cleanApertureRect(primary.properties.clap, reference.width, reference.height);
    if (!clapRect) warnings.push(messages.clapIgnored);
  }

  return {
    primaryItemId: primary.id,
    items: [...items.values()],
    grid,
    canvas,
    clapRect,
    warnings,
  };
}
```

Remove the dead check `if (3 > MAX_DEPTH)`. Nesting is bounded because only `meta`, `iinf`, `iref`, `iprp`, and `ipco` are opened, which is fewer than 32. Keep `MAX_DEPTH` unused out of the file: delete the constant and the dead check so `noUnusedLocals` passes. Item cap stays on `iinf` entry_count and `iloc` item_count.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/parseHeif.test.ts tests/clap.test.ts tests/boxes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/heif/parseHeif.ts tests/boxBuilder.ts tests/parseHeif.test.ts
git commit -m "$(cat <<'EOF'
Parse HEIF item properties and grid placement from the box structure.

EOF
)"
```

---

### Task 4: Undo mirror and rotation

**Files:**
- Create: `src/heif/orient.ts`, `tests/orient.test.ts`

**Interfaces:**
- Consumes: `Rgba`, `HeifFile`
- Produces:
  - `export function undoImir(image: Rgba, axis: 0 | 1): Rgba`
  - `export function undoIrot(image: Rgba, angle: 0 | 1 | 2 | 3): Rgba`
  - `export function expectedDecodedSize(file: HeifFile): { width: number; height: number }`

- [ ] **Step 1: Write the failing test**

`tests/orient.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { expectedDecodedSize, undoImir, undoIrot } from "../src/heif/orient";
import type { HeifFile, Rgba } from "../src/heif/types";

function rgba(width: number, height: number, pixels: number[][]): Rgba {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => {
    data.set([pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, 255], index * 4);
  });
  return { width, height, data };
}

describe("orient", () => {
  it("restores a 90 degree counter-clockwise turn", () => {
    const stored = rgba(2, 1, [[1, 0, 0], [0, 1, 0]]);
    const displayed = undoIrot(stored, 3);
    expect(displayed.width).toBe(1);
    expect(displayed.height).toBe(2);
    const restored = undoIrot(displayed, 1);
    expect(restored).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(restored.data)).toEqual(Array.from(stored.data));
  });

  it("flips across the vertical axis and back", () => {
    const stored = rgba(2, 1, [[1, 0, 0], [0, 1, 0]]);
    const flipped = undoImir(stored, 0);
    expect(flipped.data[0]).toBe(0);
    expect(undoImir(flipped, 0).data[0]).toBe(1);
  });

  it("swaps the expected decoded size for 90 degree rotation", () => {
    const file = {
      primaryItemId: 1,
      items: [{ id: 1, kind: "hvc1", hidden: false, properties: { ispe: { width: 128, height: 64 }, irot: 1 }, children: [] }],
      grid: null,
      canvas: { width: 128, height: 64 },
      clapRect: null,
      warnings: [],
    } satisfies HeifFile;
    expect(expectedDecodedSize(file)).toEqual({ width: 64, height: 128 });
  });

  it("uses the clean aperture as the expected decoded size", () => {
    const file = {
      primaryItemId: 1,
      items: [{ id: 1, kind: "hvc1", hidden: false, properties: { ispe: { width: 32, height: 32 } }, children: [] }],
      grid: null,
      canvas: { width: 32, height: 32 },
      clapRect: { x: 0, y: 0, width: 31, height: 32 },
      warnings: [],
    } satisfies HeifFile;
    expect(expectedDecodedSize(file)).toEqual({ width: 31, height: 32 });
  });
});
```

`undoIrot(stored, 3)` is 90° CCW, which is what libheif applies for `irot = 1`. `undoIrot(displayed, 1)` is the inverse. The test locks that pair.

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/orient.test.ts`

Expected: FAIL, module missing.

- [ ] **Step 3: Implement orientation**

`src/heif/orient.ts`:

```typescript
import type { HeifFile, Rgba } from "./types";

function copyPixel(src: Rgba, sx: number, sy: number, dest: Uint8ClampedArray, destWidth: number, dx: number, dy: number) {
  const from = (sy * src.width + sx) * 4;
  dest.set(src.data.subarray(from, from + 4), (dy * destWidth + dx) * 4);
}

function rotate90CW(src: Rgba): Rgba {
  const width = src.height;
  const height = src.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let sy = 0; sy < src.height; sy += 1) {
    for (let sx = 0; sx < src.width; sx += 1) copyPixel(src, sx, sy, data, width, src.height - 1 - sy, sx);
  }
  return { width, height, data };
}

function rotate90CCW(src: Rgba): Rgba {
  const width = src.height;
  const height = src.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let sy = 0; sy < src.height; sy += 1) {
    for (let sx = 0; sx < src.width; sx += 1) copyPixel(src, sx, sy, data, width, sy, src.width - 1 - sx);
  }
  return { width, height, data };
}

function rotate180(src: Rgba): Rgba {
  const data = new Uint8ClampedArray(src.data.length);
  for (let sy = 0; sy < src.height; sy += 1) {
    for (let sx = 0; sx < src.width; sx += 1) {
      copyPixel(src, sx, sy, data, src.width, src.width - 1 - sx, src.height - 1 - sy);
    }
  }
  return { width: src.width, height: src.height, data };
}

export function undoIrot(image: Rgba, angle: 0 | 1 | 2 | 3): Rgba {
  if (angle === 1) return rotate90CW(image);
  if (angle === 2) return rotate180(image);
  if (angle === 3) return rotate90CCW(image);
  return image;
}

export function undoImir(image: Rgba, axis: 0 | 1): Rgba {
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = axis === 0 ? image.width - 1 - x : x;
      const dy = axis === 1 ? image.height - 1 - y : y;
      copyPixel(image, x, y, data, image.width, dx, dy);
    }
  }
  return { width: image.width, height: image.height, data };
}

export function expectedDecodedSize(file: HeifFile): { width: number; height: number } {
  const primary = file.items.find((item) => item.id === file.primaryItemId);
  const base = file.clapRect ?? {
    width: primary?.properties.ispe?.width ?? file.canvas.width,
    height: primary?.properties.ispe?.height ?? file.canvas.height,
  };
  const angle = primary?.properties.irot ?? 0;
  if (angle === 1 || angle === 3) return { width: base.height, height: base.width };
  return { width: base.width, height: base.height };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/orient.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/heif/orient.ts tests/orient.test.ts
git commit -m "$(cat <<'EOF'
Undo HEIF mirror and rotation so pixels can sit in stored orientation.

EOF
)"
```

---

### Task 5: Generate the three sample files

**Files:**
- Create: `scripts/generate-samples.mjs`
- Create: `public/samples/clap-odd.heic`, `public/samples/grid-small-canvas.heic`, `public/samples/irot-90.heic`

**Interfaces:**
- Consumes: `heif-enc` 1.19.7 on `PATH` (this machine: `/opt/homebrew/bin/heif-enc`)
- Produces: the three fixtures described in the spec

- [ ] **Step 1: Write the generator and run it**

Create `scripts/generate-samples.mjs` with the program below. It matches heif-enc 1.19.7: a 32×32 encode is stored as `ispe` 64×64 plus `clap` (overwrite both in place), a 128×64 encode has `ispe` 128×64 and no `clap` (append `irot`), and 512×512 tiles into a 600×400 grid keep full tile `ispe` values. `iloc` construction method 0 stores the file position in `base_offset`; add the meta size delta only to those base offsets.

```javascript
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const samples = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");
mkdirSync(samples, { recursive: true });

function png(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (tag, data) => {
    const type = Buffer.from(tag);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 0);
    return Buffer.concat([len, type, data, sum]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function run(args, cwd) {
  const result = spawnSync("heif-enc", args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`heif-enc failed: ${args.join(" ")}`);
}

function boxes(buf, start, end) {
  const out = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    out.push({ type: buf.toString("latin1", offset + 4, offset + 8), start: offset, size, ps: offset + header, pe: offset + size });
    offset += size;
  }
  return out;
}

function makeBox(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, "latin1");
  payload.copy(out, 8);
  return out;
}

function metaOf(buf) {
  const top = boxes(buf, 0, buf.length);
  const meta = top.find((box) => box.type === "meta");
  const children = boxes(buf, meta.ps + 4, meta.pe);
  const iprp = children.find((box) => box.type === "iprp");
  const inner = boxes(buf, iprp.ps, iprp.pe);
  return { top, meta, children, iprp, inner, ipco: inner.find((box) => box.type === "ipco"), ipma: inner.find((box) => box.type === "ipma") };
}

function readIpma(buf, ipma) {
  const version = buf[ipma.ps];
  const flags = buf.readUIntBE(ipma.ps + 1, 3);
  if (flags & 1) throw new Error("unexpected 16-bit ipma indexes");
  let at = ipma.ps + 4;
  const count = buf.readUInt32BE(at);
  at += 4;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const id = version >= 1 ? buf.readUInt32BE(at) : buf.readUInt16BE(at);
    at += version >= 1 ? 4 : 2;
    const associations = buf[at];
    at += 1;
    const list = [];
    for (let item = 0; item < associations; item += 1) {
      const value = buf[at];
      at += 1;
      list.push({ index: value & 0x7f, essential: value >> 7 });
    }
    entries.push({ id, list });
  }
  return { version, flags, entries };
}

function writeIpma(version, flags, entries) {
  const parts = [Buffer.alloc(8)];
  parts[0][0] = version;
  parts[0].writeUIntBE(flags, 1, 3);
  parts[0].writeUInt32BE(entries.length, 4);
  for (const entry of entries) {
    const id = Buffer.alloc(version >= 1 ? 4 : 2);
    if (version >= 1) id.writeUInt32BE(entry.id, 0);
    else id.writeUInt16BE(entry.id, 0);
    parts.push(id, Buffer.from([entry.list.length]));
    for (const association of entry.list) parts.push(Buffer.from([(association.essential << 7) | association.index]));
  }
  return makeBox("ipma", Buffer.concat(parts));
}

function patchBaseOffsets(buf, shift) {
  if (shift === 0) return buf;
  const { meta, children } = metaOf(buf);
  const iloc = children.find((box) => box.type === "iloc");
  const version = buf[iloc.ps];
  let at = iloc.ps + 4;
  const first = buf[at];
  at += 1;
  const second = buf[at];
  at += 1;
  const offsetSize = first >> 4;
  const lengthSize = first & 0x0f;
  const baseSize = second >> 4;
  const indexSize = version >= 1 ? second & 0x0f : 0;
  const count = version < 2 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
  at += version < 2 ? 2 : 4;
  for (let index = 0; index < count; index += 1) {
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version === 1 || version === 2) {
      method = buf.readUInt16BE(at) & 0x0f;
      at += 2;
    }
    at += 2;
    const baseAt = at;
    if (baseSize) at += baseSize;
    const extents = buf.readUInt16BE(at);
    at += 2;
    for (let extent = 0; extent < extents; extent += 1) {
      if ((version === 1 || version === 2) && indexSize) at += indexSize;
      at += offsetSize + lengthSize;
    }
    if (baseSize && method === 0) {
      const base = buf.readUIntBE(baseAt, baseSize);
      buf.writeUIntBE(base + shift, baseAt, baseSize);
    }
  }
  void meta;
  return buf;
}

function rebuild(buf, newIpco, newIpma) {
  const { top, meta, children, inner } = metaOf(buf);
  const iprpParts = inner.map((box) => {
    if (box.type === "ipco") return newIpco;
    if (box.type === "ipma") return newIpma;
    return buf.subarray(box.start, box.pe);
  });
  const newIprp = makeBox("iprp", Buffer.concat(iprpParts));
  const metaParts = [buf.subarray(meta.ps, meta.ps + 4)];
  for (const child of children) metaParts.push(child.type === "iprp" ? newIprp : buf.subarray(child.start, child.pe));
  const newMeta = makeBox("meta", Buffer.concat(metaParts));
  const ftyp = top.find((box) => box.type === "ftyp");
  const mdat = top.find((box) => box.type === "mdat");
  const out = Buffer.concat([buf.subarray(ftyp.start, ftyp.pe), newMeta, buf.subarray(mdat.start, mdat.pe)]);
  return patchBaseOffsets(out, newMeta.length - meta.size);
}

function writeClap() {
  const dir = mkdtempSync(join(tmpdir(), "heicscope-"));
  const source = join(dir, "solid.png");
  writeFileSync(source, png(32, 32, (x, y) => [(x * 8) & 255, (y * 8) & 255, 80]));
  const encoded = join(dir, "clap.heic");
  run(["-q", "40", "-o", encoded, source]);
  const buf = Buffer.from(readFileSync(encoded));
  const located = metaOf(buf);
  const props = boxes(buf, located.ipco.ps, located.ipco.pe);
  const ispe = props.find((box) => box.type === "ispe");
  const clap = props.find((box) => box.type === "clap");
  if (!ispe || !clap) throw new Error("clap sample is missing ispe or clap");
  buf.writeUInt32BE(32, ispe.ps + 4);
  buf.writeUInt32BE(32, ispe.ps + 8);
  [31, 1, 32, 1, -1, 2, 0, 1].forEach((value, index) => buf.writeInt32BE(value, clap.ps + index * 4));
  writeFileSync(join(samples, "clap-odd.heic"), buf);
  rmSync(dir, { recursive: true, force: true });
}

function writeRotation() {
  const dir = mkdtempSync(join(tmpdir(), "heicscope-"));
  const source = join(dir, "wide.png");
  writeFileSync(source, png(128, 64, (x, y) => [(x * 2) & 255, (y * 4) & 255, 40]));
  const encoded = join(dir, "rot.heic");
  run(["-q", "40", "-o", encoded, source]);
  const buf = Buffer.from(readFileSync(encoded));
  const located = metaOf(buf);
  const props = boxes(buf, located.ipco.ps, located.ipco.pe);
  if (props.some((box) => box.type === "clap")) throw new Error("128x64 encode unexpectedly contains clap");
  const ispe = props.find((box) => box.type === "ispe");
  if (buf.readUInt32BE(ispe.ps + 4) !== 128 || buf.readUInt32BE(ispe.ps + 8) !== 64) throw new Error("unexpected ispe");
  const ipma = readIpma(buf, located.ipma);
  const chunks = props.map((box) => buf.subarray(box.start, box.pe));
  chunks.push(makeBox("irot", Buffer.from([1])));
  const irotIndex = props.length + 1;
  const entries = ipma.entries.map((entry) => ({
    id: entry.id,
    list: entry.id === 1 ? [...entry.list, { index: irotIndex, essential: 1 }] : entry.list,
  }));
  const rebuilt = rebuild(buf, makeBox("ipco", Buffer.concat(chunks)), writeIpma(ipma.version, ipma.flags, entries));
  writeFileSync(join(samples, "irot-90.heic"), rebuilt);
  rmSync(dir, { recursive: true, force: true });
}

function writeGrid() {
  const dir = mkdtempSync(join(tmpdir(), "heicscope-"));
  writeFileSync(join(dir, "tile-01-01.png"), png(512, 512, () => [200, 40, 40]));
  writeFileSync(join(dir, "tile-01-02.png"), png(512, 512, () => [40, 160, 70]));
  const encoded = join(dir, "grid.heic");
  run(["-q", "40", "--tiled-input", "--tiled-image-width", "600", "--tiled-image-height", "400", "-o", encoded, "tile-01-01.png"], dir);
  const buf = Buffer.from(readFileSync(encoded));
  const located = metaOf(buf);
  const props = boxes(buf, located.ipco.ps, located.ipco.pe);
  const ipma = readIpma(buf, located.ipma);
  const clapIndexes = new Set(props.map((box, index) => (box.type === "clap" ? index + 1 : 0)).filter(Boolean));
  const gridEntry = ipma.entries.find((entry) => entry.id === 1);
  const gridIspe = gridEntry.list.map((item) => props[item.index - 1]).find((box) => box?.type === "ispe");
  if (buf.readUInt32BE(gridIspe.ps + 4) !== 600 || buf.readUInt32BE(gridIspe.ps + 8) !== 400) {
    throw new Error("grid ispe is not 600x400");
  }
  for (const entry of ipma.entries.filter((item) => item.id !== 1)) {
    if (entry.list.some((item) => clapIndexes.has(item.index))) throw new Error(`tile ${entry.id} has clap`);
    const tileIspe = entry.list.map((item) => props[item.index - 1]).find((box) => box?.type === "ispe");
    if (buf.readUInt32BE(tileIspe.ps + 4) !== 512 || buf.readUInt32BE(tileIspe.ps + 8) !== 512) {
      throw new Error(`tile ${entry.id} ispe is not 512x512`);
    }
  }
  const idat = located.children.find((box) => box.type === "idat");
  const grid = buf.subarray(idat.ps, idat.pe);
  if (grid.length !== 8 || grid[2] !== 0 || grid[3] !== 1 || grid.readUInt16BE(4) !== 600 || grid.readUInt16BE(6) !== 400) {
    throw new Error("ImageGrid is not 1x2 of 600x400");
  }
  writeFileSync(join(samples, "grid-small-canvas.heic"), buf);
  rmSync(dir, { recursive: true, force: true });
}

writeClap();
writeRotation();
writeGrid();
```

Run:

```bash
node scripts/generate-samples.mjs
```

Expected: the script exits 0 and the three files exist. `heif-info public/samples/irot-90.heic` includes `angle (ccw): 90` and `image: 64x128`. `heif-info public/samples/grid-small-canvas.heic` includes `tiles: 2x1, tile size: 512x512`. `heif-convert public/samples/clap-odd.heic /tmp/clap-odd.png` writes a 31×32 PNG.

- [ ] **Step 2: Commit the script and fixtures**

```bash
git add scripts/generate-samples.mjs public/samples
git commit -m "$(cat <<'EOF'
Add HEIC fixtures for clean aperture, tile overflow, and rotation.

EOF
)"
```

---

### Task 6: Decode pixels with libheif

**Files:**
- Create: `src/heif/libheif.d.ts`, `src/heif/decode.ts`, `tests/decode.test.ts`

**Interfaces:**
- Consumes: `parseHeif`, `undoImir`, `undoIrot`, `expectedDecodedSize`, `messages`, `Rgba`, `HeifFile`
- Produces:
  - `export type PixelLayer = { width: number; height: number; rgba: Uint8ClampedArray }`
  - `export type PixelResult = { layer: PixelLayer | null; warnings: string[] }`
  - `export async function renderPixels(file: Uint8Array, parsed: HeifFile, force: boolean): Promise<PixelResult>`

- [ ] **Step 1: Write the failing integration test**

`tests/decode.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPixels } from "../src/heif/decode";
import { parseHeif } from "../src/heif/parseHeif";

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../public/samples/${name}`, import.meta.url)));
}

function opaqueCount(layer: { rgba: Uint8ClampedArray } | null): number {
  if (!layer) return 0;
  let count = 0;
  for (let i = 3; i < layer.rgba.length; i += 4) if (layer.rgba[i] === 255) count += 1;
  return count;
}

describe("renderPixels", () => {
  it("shows the 31x32 clean aperture without pixels when libheif rejects the coded size", async () => {
    const bytes = load("clap-odd.heic");
    const parsed = parseHeif(bytes);
    expect(parsed.canvas).toEqual({ width: 32, height: 32 });
    expect(parsed.clapRect).toEqual({ x: 0, y: 0, width: 31, height: 32 });
    const result = await renderPixels(bytes, parsed, false);
    expect(result.layer).toBeNull();
    expect(result.warnings).toEqual(["The primary image could not be decoded. Showing geometry only."]);
  });

  it("keeps both 512 tiles on a 1024x512 canvas", async () => {
    const bytes = load("grid-small-canvas.heic");
    const parsed = parseHeif(bytes);
    expect(parsed.canvas).toEqual({ width: 1024, height: 512 });
    expect(parsed.grid).toMatchObject({ rows: 1, columns: 2, outputWidth: 600, outputHeight: 400 });
    const result = await renderPixels(bytes, parsed, false);
    expect(opaqueCount(result.layer)).toBe(2 * 512 * 512);
    expect(result.warnings).not.toContain(
      "Tile decode failed. Showing the composed image placed in the grid output. Pixels outside that rectangle are not available.",
    );
  });

  it("undoes a 90 degree rotation onto a 128x64 canvas", async () => {
    const bytes = load("irot-90.heic");
    const parsed = parseHeif(bytes);
    expect(parsed.items.find((item) => item.id === parsed.primaryItemId)?.properties.irot).toBe(1);
    expect(parsed.canvas).toEqual({ width: 128, height: 64 });
    const result = await renderPixels(bytes, parsed, false);
    expect(result.layer?.width).toBe(128);
    expect(result.layer?.height).toBe(64);
    expect(opaqueCount(result.layer)).toBe(128 * 64);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/decode.test.ts`

Expected: FAIL, `renderPixels` is not defined.

- [ ] **Step 3: Implement decoding**

`src/heif/libheif.d.ts`:

```typescript
declare module "libheif-js/wasm-bundle" {
  type Handle = object;
  type Context = object;
  const libheif: {
    heif_context_alloc(): Context;
    heif_context_free(context: Context): void;
    heif_context_read_from_memory(context: Context, data: Uint8Array): { code: { value: number }; message: string };
    heif_js_context_get_image_handle(context: Context, id: number): Handle | null;
    heif_image_handle_release(handle: Handle): void;
    heif_js_decode_image2(handle: Handle, colorspace: unknown, chroma: unknown): {
      code?: { value: number };
      image: object;
      width: number;
      height: number;
      channels: { id: unknown; stride: number; data: Uint8Array; width: number; height: number }[];
    };
    heif_image_release(image: object): void;
    heif_colorspace_RGB: unknown;
    heif_chroma_interleaved_RGBA: unknown;
    heif_channel_interleaved: unknown;
    heif_error_Ok: { value: number };
  };
  export default libheif;
}
```

`src/heif/decode.ts`:

```typescript
import libheif from "libheif-js/wasm-bundle";
import { messages } from "./messages";
import { expectedDecodedSize, undoImir, undoIrot } from "./orient";
import type { HeifFile, HeifItem, Rgba } from "./types";

export type PixelLayer = { width: number; height: number; rgba: Uint8ClampedArray };
export type PixelResult = { layer: PixelLayer | null; warnings: string[] };

const PIXEL_LIMIT = 16_000_000;
const EDGE_LIMIT = 8192;

function tooLarge(file: HeifFile): boolean {
  return file.canvas.width > EDGE_LIMIT || file.canvas.height > EDGE_LIMIT || file.canvas.width * file.canvas.height > PIXEL_LIMIT;
}

function fromChannel(decoded: {
  width: number;
  height: number;
  channels: { id: unknown; stride: number; data: Uint8Array }[];
}): Rgba {
  const channel =
    decoded.channels.find((item) => item.id === libheif.heif_channel_interleaved) ?? decoded.channels[0];
  if (!channel) throw new Error(messages.primaryDecode);
  const data = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  const rowBytes = decoded.width * 4;
  for (let y = 0; y < decoded.height; y += 1) {
    data.set(channel.data.subarray(y * channel.stride, y * channel.stride + rowBytes), y * rowBytes);
  }
  return { width: decoded.width, height: decoded.height, data };
}

function decodeItem(file: Uint8Array, itemId: number): Rgba {
  const context = libheif.heif_context_alloc();
  try {
    const error = libheif.heif_context_read_from_memory(context, file);
    if (error.code.value !== libheif.heif_error_Ok.value) throw new Error(messages.decoderLoad);
    const handle = libheif.heif_js_context_get_image_handle(context, itemId);
    if (!handle) throw new Error(messages.tileDecode);
    try {
      const decoded = libheif.heif_js_decode_image2(handle, libheif.heif_colorspace_RGB, libheif.heif_chroma_interleaved_RGBA);
      if (!decoded || decoded.code) throw new Error(messages.tileDecode);
      const image = fromChannel(decoded);
      libheif.heif_image_release(decoded.image);
      return image;
    } finally {
      libheif.heif_image_handle_release(handle);
    }
  } finally {
    libheif.heif_context_free(context);
  }
}

function blank(width: number, height: number): Uint8ClampedArray | null {
  try {
    return new Uint8ClampedArray(width * height * 4);
  } catch {
    return null;
  }
}

function blit(dest: Uint8ClampedArray, destWidth: number, src: Rgba, x: number, y: number) {
  const width = Math.min(src.width, destWidth - x);
  const height = Math.min(src.height, Math.floor(dest.length / 4 / destWidth) - y);
  if (width <= 0 || height <= 0 || x < 0 || y < 0) return;
  for (let row = 0; row < height; row += 1) {
    const from = row * src.width * 4;
    dest.set(src.data.subarray(from, from + width * 4), ((y + row) * destWidth + x) * 4);
  }
}

function childHasTransform(item: HeifItem | undefined): boolean {
  return Boolean(item?.properties.clap || item?.properties.irot !== undefined || item?.properties.imir !== undefined);
}

function compose(file: Uint8Array, parsed: HeifFile): PixelResult {
  const primary = parsed.items.find((item) => item.id === parsed.primaryItemId);
  if (!primary) return { layer: null, warnings: [messages.primaryDecode] };
  let decoded: Rgba;
  try {
    decoded = decodeItem(file, primary.id);
  } catch {
    return { layer: null, warnings: [messages.primaryDecode] };
  }
  const expected = expectedDecodedSize(parsed);
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    return { layer: null, warnings: [messages.decodedMismatch] };
  }
  if (primary.properties.imir !== undefined) decoded = undoImir(decoded, primary.properties.imir);
  if (primary.properties.irot !== undefined) decoded = undoIrot(decoded, primary.properties.irot);
  const rgba = blank(parsed.canvas.width, parsed.canvas.height);
  if (!rgba) return { layer: null, warnings: [messages.buffer] };
  const origin = parsed.clapRect ?? { x: 0, y: 0, width: decoded.width, height: decoded.height };
  blit(rgba, parsed.canvas.width, decoded, origin.x, origin.y);
  return { layer: { width: parsed.canvas.width, height: parsed.canvas.height, rgba }, warnings: [] };
}

export async function renderPixels(file: Uint8Array, parsed: HeifFile, force: boolean): Promise<PixelResult> {
  if (!force && tooLarge(parsed)) {
    return { layer: null, warnings: [messages.tooLarge(parsed.canvas.width, parsed.canvas.height)] };
  }
  const primary = parsed.items.find((item) => item.id === parsed.primaryItemId);
  if (primary?.kind === "iovl") return { layer: null, warnings: [messages.overlay] };

  const grid = parsed.grid;
  const children = primary?.children.map((id) => parsed.items.find((item) => item.id === id)) ?? [];
  const canTile =
    primary?.kind === "grid" &&
    grid !== null &&
    children.length === grid.rows * grid.columns &&
    children.every((item) => item && (item.kind === "hvc1" || item.kind === "hev1") && !childHasTransform(item));

  if (!canTile) {
    const warnings: string[] = [];
    if (primary?.kind === "grid" && grid) {
      if (children.length !== grid.rows * grid.columns) warnings.push(messages.tileCount);
      else if (children.some((item) => childHasTransform(item))) warnings.push(messages.tileTransform);
      else warnings.push(messages.tileDecode);
    }
    const composed = compose(file, parsed);
    return { layer: composed.layer, warnings: [...warnings, ...composed.warnings] };
  }

  const rgba = blank(parsed.canvas.width, parsed.canvas.height);
  if (!rgba || !grid) return { layer: null, warnings: [messages.buffer] };
  const warnings: string[] = [];
  for (const tile of grid.tiles) {
    let image: Rgba;
    try {
      image = decodeItem(file, tile.id);
    } catch {
      const composed = compose(file, parsed);
      return { layer: composed.layer, warnings: [messages.tileDecode, ...composed.warnings] };
    }
    if (image.width !== tile.storedWidth || image.height !== tile.storedHeight) {
      warnings.push(messages.tileSize(tile.id, image.width, image.height, tile.storedWidth, tile.storedHeight));
    }
    blit(rgba, parsed.canvas.width, image, tile.x, tile.y);
  }
  return { layer: { width: parsed.canvas.width, height: parsed.canvas.height, rgba }, warnings };
}
```

`renderPixels` is async because the UI awaits it; the body does not need `await`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/decode.test.ts`

Expected: PASS, 3 tests. If `heif_channel_interleaved` comparison fails, select the channel whose `data.length` is at least `width * height * 4` instead of comparing object identity, and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/heif/decode.ts src/heif/libheif.d.ts tests/decode.test.ts
git commit -m "$(cat <<'EOF'
Decode HEIC tiles and place them on the pre-transform canvas.

EOF
)"
```

---

### Task 7: Viewer UI

**Files:**
- Create: `src/ui/labels.ts`, `src/ui/Viewport.tsx`, `src/ui/SidePanel.tsx`, `tests/labels.test.ts`
- Modify: `src/ui/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `parseHeif`, `renderPixels`, `HeifFile`, `PixelLayer`, `messages`
- Produces: the English labels and the single-page shell

- [ ] **Step 1: Write the failing label test**

`tests/labels.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mirrorLabel, rotationLabel } from "../src/ui/labels";

describe("labels", () => {
  it("names rotations and mirrors", () => {
    expect(rotationLabel(1)).toBe("90° CCW");
    expect(rotationLabel(undefined)).toBe("0°");
    expect(mirrorLabel(0)).toBe("vertical axis");
    expect(mirrorLabel(undefined)).toBe("none");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/labels.test.ts`

Expected: FAIL, module missing.

- [ ] **Step 3: Implement labels, viewport, side panel, and app shell**

`src/ui/labels.ts`:

```typescript
export function rotationLabel(angle: 0 | 1 | 2 | 3 | undefined): string {
  if (angle === 1) return "90° CCW";
  if (angle === 2) return "180°";
  if (angle === 3) return "270° CCW";
  return "0°";
}

export function mirrorLabel(axis: 0 | 1 | undefined): string {
  if (axis === 0) return "vertical axis";
  if (axis === 1) return "horizontal axis";
  return "none";
}
```

`src/ui/Viewport.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { PixelLayer } from "../heif/decode";
import type { PixelRect, TileCell } from "../heif/types";

export function Viewport(props: {
  width: number;
  height: number;
  layer: PixelLayer | null;
  tiles: TileCell[];
  grid: { outputWidth: number; outputHeight: number } | null;
  clap: PixelRect | null;
  showTiles: boolean;
  showGrid: boolean;
  showClap: boolean;
  highlightId: number | null;
  zoom: number;
  pan: { x: number; y: number };
  fitToken: number;
  onZoom: (zoom: number, pan: { x: number; y: number }) => void;
  onPan: (pan: { x: number; y: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = props.layer;
    if (!canvas || !layer) return;
    canvas.width = layer.width;
    canvas.height = layer.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(layer.rgba, layer.width, layer.height), 0, 0);
  }, [props.layer]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || props.width === 0 || props.height === 0) return;
    const next = Math.min(
      32,
      Math.max(0.05, Math.min((frame.clientWidth - 32) / props.width, (frame.clientHeight - 32) / props.height)),
    );
    props.onZoom(next, { x: 16, y: 16 });
  }, [props.fitToken, props.width, props.height]);

  return (
    <div
      className="viewport"
      ref={frameRef}
      onWheel={(event) => {
        event.preventDefault();
        const next = Math.min(32, Math.max(0.05, props.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const scale = next / props.zoom;
        props.onZoom(next, { x: x - (x - props.pan.x) * scale, y: y - (y - props.pan.y) * scale });
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY, panX: props.pan.x, panY: props.pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        props.onPan({
          x: drag.current.panX + event.clientX - drag.current.x,
          y: drag.current.panY + event.clientY - drag.current.y,
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <div className="stage" style={{ transform: `translate(${props.pan.x}px, ${props.pan.y}px) scale(${props.zoom})` }}>
        <div className="sheet" style={{ width: props.width, height: props.height }}>
          {props.layer ? <canvas ref={canvasRef} /> : null}
          <svg viewBox={`0 0 ${props.width} ${props.height}`} width={props.width} height={props.height}>
            {props.showTiles
              ? props.tiles.map((tile) => (
                  <rect
                    key={tile.id}
                    x={tile.x}
                    y={tile.y}
                    width={tile.storedWidth}
                    height={tile.storedHeight}
                    className={tile.id === props.highlightId ? "tile hot" : "tile"}
                  />
                ))
              : null}
            {props.showGrid && props.grid ? (
              <rect className="grid" x={0} y={0} width={props.grid.outputWidth} height={props.grid.outputHeight} />
            ) : null}
            {props.showClap && props.clap ? (
              <rect className="clap" x={props.clap.x} y={props.clap.y} width={props.clap.width} height={props.clap.height} />
            ) : null}
          </svg>
        </div>
      </div>
    </div>
  );
}
```

`src/ui/SidePanel.tsx`:

```tsx
import type { HeifFile, TileCell } from "../heif/types";
import { mirrorLabel, rotationLabel } from "./labels";

function fraction(value: { numerator: bigint; denominator: bigint } | undefined): string {
  if (!value) return "none";
  return `${value.numerator.toString()}/${value.denominator.toString()}`;
}

export function SidePanel(props: {
  fileName: string;
  parsed: HeifFile;
  tiles: TileCell[];
  warnings: string[];
  tooLarge: boolean;
  onHighlight: (id: number | null) => void;
  onDecode: () => void;
}) {
  const primary = props.parsed.items.find((item) => item.id === props.parsed.primaryItemId);
  const ispe = primary?.properties.ispe;
  const clap = primary?.properties.clap;
  const rect = props.parsed.clapRect;
  return (
    <aside className="panel">
      <p><b>File</b> {props.fileName}</p>
      <p><b>Primary item</b> {primary ? `${primary.id} ${primary.kind}` : "none"}</p>
      <p><b>Stored size</b> {ispe ? `${ispe.width}×${ispe.height}` : "none"}</p>
      <p>
        <b>Clean aperture</b>{" "}
        {clap && rect
          ? `${fraction(clap.width)} × ${fraction(clap.height)}, offset ${fraction(clap.horizontalOffset)}, ${fraction(clap.verticalOffset)}, ${rect.x}, ${rect.y}, ${rect.width}×${rect.height}`
          : "none"}
      </p>
      <p><b>Rotation</b> {rotationLabel(primary?.properties.irot)}</p>
      <p><b>Mirror</b> {mirrorLabel(primary?.properties.imir)}</p>
      <p>
        <b>Grid</b>{" "}
        {props.parsed.grid
          ? `${props.parsed.grid.rows}×${props.parsed.grid.columns}, ${props.parsed.grid.outputWidth}×${props.parsed.grid.outputHeight}`
          : "none"}
      </p>
      <b>Tiles</b>
      <ul>
        {props.tiles.map((tile) => (
          <li key={tile.id} onMouseEnter={() => props.onHighlight(tile.id)} onMouseLeave={() => props.onHighlight(null)}>
            {tile.id} {tile.storedWidth}×{tile.storedHeight} at {tile.x},{tile.y}
          </li>
        ))}
      </ul>
      {props.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      {props.tooLarge ? <button type="button" onClick={props.onDecode}>Decode pixels anyway</button> : null}
    </aside>
  );
}
```

`src/ui/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { renderPixels, type PixelLayer } from "../heif/decode";
import { messages } from "../heif/messages";
import { parseHeif } from "../heif/parseHeif";
import type { HeifFile, TileCell } from "../heif/types";
import { HeifError } from "../heif/types";
import { SidePanel } from "./SidePanel";
import { Viewport } from "./Viewport";

const samples = [
  ["Clean aperture", "clap-odd.heic"],
  ["Grid", "grid-small-canvas.heic"],
  ["Rotation", "irot-90.heic"],
] as const;

type Ready = {
  name: string;
  bytes: Uint8Array;
  parsed: HeifFile;
  layer: PixelLayer | null;
  warnings: string[];
};

function tilesOf(parsed: HeifFile): TileCell[] {
  if (parsed.grid) return parsed.grid.tiles;
  const primary = parsed.items.find((item) => item.id === parsed.primaryItemId);
  if (!primary?.properties.ispe) return [];
  return [{
    id: primary.id,
    column: 0,
    row: 0,
    x: 0,
    y: 0,
    storedWidth: primary.properties.ispe.width,
    storedHeight: primary.properties.ispe.height,
  }];
}

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [force, setForce] = useState(false);
  const [showTiles, setShowTiles] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showClap, setShowClap] = useState(true);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 16, y: 16 });
  const [fitToken, setFitToken] = useState(0);

  async function openBuffer(bytes: Uint8Array, name: string, decodeForce: boolean) {
    try {
      const parsed = parseHeif(bytes);
      const pixels = await renderPixels(bytes, parsed, decodeForce);
      setError(null);
      setReady({ name, bytes, parsed, layer: pixels.layer, warnings: [...parsed.warnings, ...pixels.warnings] });
      setFitToken((value) => value + 1);
    } catch (caught) {
      setReady(null);
      setError(caught instanceof HeifError ? caught.message : messages.notHeif);
    }
  }

  useEffect(() => {
    void fetch(`${import.meta.env.BASE_URL}samples/grid-small-canvas.heic`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => openBuffer(new Uint8Array(buffer), "grid-small-canvas.heic", false));
  }, []);

  async function openSample(name: string) {
    setForce(false);
    const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
    await openBuffer(new Uint8Array(await response.arrayBuffer()), name, false);
  }

  const tooLarge = ready?.warnings.some((warning) => warning.startsWith("This image is too large")) ?? false;

  return (
    <div className="app">
      <header
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (!file) return;
          setForce(false);
          void file.arrayBuffer().then((buffer) => openBuffer(new Uint8Array(buffer), file.name, false));
        }}
      >
        <strong>HeicScope</strong>
        {samples.map(([label, name]) => (
          <button key={name} type="button" onClick={() => void openSample(name)}>{label}</button>
        ))}
        <label className="file">
          Open file
          <input
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setForce(false);
              void file.arrayBuffer().then((buffer) => openBuffer(new Uint8Array(buffer), file.name, false));
            }}
          />
        </label>
        <button type="button" onClick={() => setFitToken((value) => value + 1)}>Fit</button>
        <button type="button" onClick={() => setZoom(1)}>100%</button>
        <label><input type="checkbox" checked={showTiles} onChange={(event) => setShowTiles(event.target.checked)} /> Tile boundaries</label>
        <label><input type="checkbox" checked={showGrid} disabled={!ready?.parsed.grid} onChange={(event) => setShowGrid(event.target.checked)} /> Grid output</label>
        <label><input type="checkbox" checked={showClap} disabled={!ready?.parsed.clapRect} onChange={(event) => setShowClap(event.target.checked)} /> Clean aperture</label>
      </header>
      <main>
        {error ? <p className="error">{error}</p> : null}
        {ready ? (
          <Viewport
            width={ready.parsed.canvas.width}
            height={ready.parsed.canvas.height}
            layer={ready.layer}
            tiles={tilesOf(ready.parsed)}
            grid={ready.parsed.grid}
            clap={ready.parsed.clapRect}
            showTiles={showTiles}
            showGrid={showGrid}
            showClap={showClap}
            highlightId={highlight}
            zoom={zoom}
            pan={pan}
            fitToken={fitToken}
            onZoom={(next, nextPan) => { setZoom(next); setPan(nextPan); }}
            onPan={setPan}
          />
        ) : null}
        {ready ? (
          <SidePanel
            fileName={ready.name}
            parsed={ready.parsed}
            tiles={tilesOf(ready.parsed)}
            warnings={ready.warnings}
            tooLarge={tooLarge && !force}
            onHighlight={setHighlight}
            onDecode={() => {
              setForce(true);
              void openBuffer(ready.bytes, ready.name, true);
            }}
          />
        ) : null}
      </main>
      <footer>
        <a href="https://github.com/catdad-experiments/libheif-js">Decoder: libheif-js (LGPL-3.0)</a>
      </footer>
    </div>
  );
}
```

The fit effect runs when `fitToken`, `width`, or `height` changes, including the first time the viewport mounts. It sets zoom so the structural canvas fits inside the viewport with a 32px margin, clamped to `[0.05, 32]`.

Replace `src/styles.css` with:

```css
:root { color: #e8e8e8; background: #111; font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; }
button, label { font: inherit; color: inherit; }
.app { min-height: 100vh; display: flex; flex-direction: column; }
header, footer { display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: #1b1b1b; flex-wrap: wrap; }
header .file input { display: none; }
main { flex: 1; display: flex; min-height: 0; }
.viewport { flex: 1; overflow: hidden; background: #0c0c0c; touch-action: none; }
.stage { transform-origin: 0 0; }
.sheet { position: relative; background: repeating-linear-gradient(45deg, #222, #222 8px, #2a2a2a 8px, #2a2a2a 16px); }
.sheet canvas, .sheet svg { position: absolute; inset: 0; }
.tile { fill: none; stroke: #3dff9a; stroke-width: 2; }
.tile.hot { stroke-width: 6; }
.grid { fill: none; stroke: #ffcc00; stroke-width: 3; }
.clap { fill: none; stroke: #ff4d4d; stroke-width: 3; }
.panel { width: 320px; overflow: auto; padding: 12px; background: #181818; }
.panel ul { padding-left: 18px; }
.error { padding: 16px; }
footer a { color: #9ecbff; }
```

SVG stroke widths are in user units, so the lines scale with the image. That keeps tile edges visible when the view is fitted.


- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run && npx tsc --noEmit`

Expected: all tests PASS and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/ui src/styles.css tests/labels.test.ts
git commit -m "$(cat <<'EOF'
Show HEIC structure on a zoomable canvas with an English side panel.

EOF
)"
```

---

### Task 8: GitHub Pages

**Files:**
- Create: `.github/workflows/pages.yml`, `LICENSE`, `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Consumes: `npm test`, `npm run build`, `dist/`
- Produces: a workflow that deploys `main` to GitHub Pages

- [ ] **Step 1: Add the license, notice, and workflow**

`LICENSE`: MIT, copyright 2026, the repository owner.

`THIRD_PARTY_NOTICES.md`: state that the shipped decoder is libheif-js 1.23.5, which bundles libheif under LGPL-3.0, and link https://github.com/catdad-experiments/libheif-js and https://github.com/strukturag/libheif.

`.github/workflows/pages.yml`:

```yaml
name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Build locally**

Run: `npm test && npm run build`

Expected: tests pass and `dist/index.html` exists. `dist` contains no standalone `.wasm` file (`find dist -name '*.wasm'` prints nothing).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml LICENSE THIRD_PARTY_NOTICES.md
git commit -m "$(cat <<'EOF'
Deploy the static HEIC viewer to GitHub Pages.

EOF
)"
```

Do not create the GitHub repository or enable Pages in this task. The current branch may be `first`; the workflow still triggers on `main`.

---

### Task 9: Browser check

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open the printed local URL.

- [ ] **Step 2: Check the three samples and a bad file**

Confirm:

- The first view is Grid. The side panel shows output `600×400`, canvas tiles at 512, and two tile rows. Yellow grid rectangle and green tile edges are both visible, including tile pixels past the yellow rectangle. Hovering a tile row thickens that tile's edge.
- Clean aperture shows stored size `32×32` and rectangle `0, 0, 31×32`. There is no pixel layer, so the viewport is hatched. The warning is `The primary image could not be decoded. Showing geometry only.`
- Rotation shows `90° CCW`, stored size `128×64`, and a landscape image. The pixels are not shown already rotated to portrait.
- `100%` and Fit change the scale. The overlay stays aligned with the pixels while zooming and dragging.
- Opening a non-HEIC file (for example `package.json` through Open file) shows `This file is not a HEIF image.` and no canvas.
- The footer link target is the libheif-js repository.

- [ ] **Step 3: Stop the dev server**

No commit unless a check failed and the fix is part of the viewer. If you fix a defect, add a regression test when the defect is in the parser, geometry, or pixel placement, then commit that fix.
