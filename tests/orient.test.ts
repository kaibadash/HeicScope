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