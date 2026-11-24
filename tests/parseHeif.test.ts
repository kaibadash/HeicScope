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