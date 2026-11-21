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