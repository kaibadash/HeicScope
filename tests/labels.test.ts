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