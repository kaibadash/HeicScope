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
  if (imageWidth <= 0 || imageHeight <= 0 || imageWidth >= 2 ** 31 || imageHeight >= 2 ** 31) return null;

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