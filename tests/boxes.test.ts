import { describe, expect, it } from "vitest";
import { readBoxes } from "../src/isobmff/boxes";
import { HeifError } from "../src/heif/types";

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  return out;
}

describe("readBoxes", () => {
  it("reads a size-0 box as extending to the parent end", () => {
    const payload = box("free", new Uint8Array([1, 2, 3, 4]));
    const wrapped = new Uint8Array(8 + payload.length);
    wrapped.set(new TextEncoder().encode("test"), 4);
    wrapped.set(payload, 8);
    const boxes = readBoxes(wrapped, 8, wrapped.length);
    expect(boxes.map((item) => item.type)).toEqual(["free"]);
    expect(boxes[0]?.dataEnd - boxes[0]?.dataStart).toBe(4);
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