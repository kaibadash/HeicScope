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