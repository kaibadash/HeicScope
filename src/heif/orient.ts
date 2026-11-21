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