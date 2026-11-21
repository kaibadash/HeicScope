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
});