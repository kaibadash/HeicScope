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