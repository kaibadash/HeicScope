import { readBoxes, type IsoBox } from "../isobmff/boxes";
import { cleanApertureRect } from "./clap";
import { messages } from "./messages";
import type { Clap, Grid, HeifFile, HeifItem, ItemKind, TileCell } from "./types";
import { HeifError } from "./types";

const HEIF_BRANDS = new Set(["mif1", "heic", "heix", "hevc"]);
const MAX_ITEMS = 512;

function fourcc(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0);
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function u16(data: Uint8Array, offset: number): number {
  return view(data).getUint16(offset);
}

function u32(data: Uint8Array, offset: number): number {
  return view(data).getUint32(offset);
}

function i32(data: Uint8Array, offset: number): number {
  return view(data).getInt32(offset);
}

function payloadOf(data: Uint8Array, box: IsoBox): { version: number; flags: number; at: number } {
  if (box.dataStart + 4 > box.dataEnd) throw new HeifError(messages.truncated(box.start));
  const flags = (data[box.dataStart + 1] << 16) | (data[box.dataStart + 2] << 8) | data[box.dataStart + 3];
  return { version: data[box.dataStart], flags, at: box.dataStart + 4 };
}

function kindOf(type: string): ItemKind {
  if (type === "grid" || type === "hvc1" || type === "hev1" || type === "iovl") return type;
  return "other";
}

function findBox(boxes: IsoBox[], type: string): IsoBox | undefined {
  return boxes.find((box) => box.type === type);
}

type RawProperty =
  | { type: "ispe"; width: number; height: number }
  | { type: "clap"; clap: Clap }
  | { type: "irot"; angle: 0 | 1 | 2 | 3 }
  | { type: "imir"; axis: 0 | 1 }
  | { type: "other" };

function readProperty(data: Uint8Array, box: IsoBox): RawProperty {
  if (box.type === "ispe") {
    const body = payloadOf(data, box);
    return { type: "ispe", width: u32(data, body.at), height: u32(data, body.at + 4) };
  }
  if (box.type === "clap") {
    return {
      type: "clap",
      clap: {
        width: { numerator: BigInt(u32(data, box.dataStart)), denominator: BigInt(u32(data, box.dataStart + 4)) },
        height: { numerator: BigInt(u32(data, box.dataStart + 8)), denominator: BigInt(u32(data, box.dataStart + 12)) },
        horizontalOffset: { numerator: BigInt(i32(data, box.dataStart + 16)), denominator: BigInt(u32(data, box.dataStart + 20)) },
        verticalOffset: { numerator: BigInt(i32(data, box.dataStart + 24)), denominator: BigInt(u32(data, box.dataStart + 28)) },
      },
    };
  }
  if (box.type === "irot") return { type: "irot", angle: (data[box.dataStart] & 3) as 0 | 1 | 2 | 3 };
  if (box.type === "imir") return { type: "imir", axis: (data[box.dataStart] & 1) as 0 | 1 };
  return { type: "other" };
}

type Extent = { method: number; offset: number; length: number };

function readIloc(data: Uint8Array, box: IsoBox): Map<number, Extent[]> {
  const body = payloadOf(data, box);
  let at = body.at;
  const offsetSize = data[at] >> 4;
  const lengthSize = data[at] & 0x0f;
  at += 1;
  const baseSize = data[at] >> 4;
  const indexSize = body.version >= 1 ? data[at] & 0x0f : 0;
  at += 1;
  const count = body.version < 2 ? u16(data, at) : u32(data, at);
  at += body.version < 2 ? 2 : 4;
  if (count > MAX_ITEMS) throw new HeifError(messages.limits);
  const map = new Map<number, Extent[]>();
  const readN = (size: number) => {
    let value = 0;
    for (let i = 0; i < size; i += 1) value = value * 256 + data[at + i];
    at += size;
    return value;
  };
  for (let index = 0; index < count; index += 1) {
    const id = body.version < 2 ? u16(data, at) : u32(data, at);
    at += body.version < 2 ? 2 : 4;
    let method = 0;
    if (body.version === 1 || body.version === 2) {
      method = u16(data, at) & 0x0f;
      at += 2;
    }
    at += 2;
    const base = baseSize ? readN(baseSize) : 0;
    const extents = u16(data, at);
    at += 2;
    const list: Extent[] = [];
    for (let extent = 0; extent < extents; extent += 1) {
      if ((body.version === 1 || body.version === 2) && indexSize) at += indexSize;
      const offset = (offsetSize ? readN(offsetSize) : 0) + base;
      const length = lengthSize ? readN(lengthSize) : 0;
      list.push({ method, offset, length });
    }
    map.set(id, list);
  }
  return map;
}

function readItemBytes(data: Uint8Array, extents: Extent[], idat: IsoBox | undefined): Uint8Array | null {
  const parts: Uint8Array[] = [];
  for (const extent of extents) {
    if (extent.method === 1) {
      if (!idat) return null;
      const start = idat.dataStart + extent.offset;
      const end = start + extent.length;
      if (end > idat.dataEnd) return null;
      parts.push(data.slice(start, end));
    } else if (extent.method === 0) {
      const end = extent.offset + extent.length;
      if (extent.offset < 0 || end > data.length) return null;
      parts.push(data.slice(extent.offset, end));
    } else {
      return null;
    }
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function layoutTiles(
  columns: number,
  rows: number,
  children: { id: number; width: number; height: number }[],
  outputWidth: number,
  outputHeight: number,
): { canvas: { width: number; height: number }; tiles: TileCell[] } {
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  for (let column = 0; column < columns; column += 1) columnWidths.push(children[column]?.width ?? 0);
  for (let row = 0; row < rows; row += 1) rowHeights.push(children[row * columns]?.height ?? 0);
  const tiles: TileCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const child = children[row * columns + column];
      if (!child) continue;
      const x = columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0);
      const y = rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0);
      tiles.push({
        id: child.id,
        column,
        row,
        x,
        y,
        storedWidth: child.width,
        storedHeight: child.height,
      });
    }
  }
  const tiledWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const tiledHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  return {
    canvas: { width: Math.max(tiledWidth, outputWidth), height: Math.max(tiledHeight, outputHeight) },
    tiles,
  };
}

export function parseHeif(data: Uint8Array): HeifFile {
  const top = readBoxes(data, 0, data.length);
  const ftyp = findBox(top, "ftyp");
  if (!ftyp) throw new HeifError(messages.notHeif);
  const major = fourcc(data, ftyp.dataStart);
  const compatible: string[] = [];
  for (let offset = ftyp.dataStart + 8; offset + 4 <= ftyp.dataEnd; offset += 4) compatible.push(fourcc(data, offset));
  if (![major, ...compatible].some((brand) => HEIF_BRANDS.has(brand))) throw new HeifError(messages.notHeif);

  const meta = findBox(top, "meta");
  if (!meta) throw new HeifError(messages.noImage);
  const metaBody = payloadOf(data, meta);
  const metaBoxes = readBoxes(data, metaBody.at, meta.dataEnd);
  const warnings: string[] = [];

  const iinf = findBox(metaBoxes, "iinf");
  if (!iinf) throw new HeifError(messages.noImage);
  const iinfBody = payloadOf(data, iinf);
  const entryCount = iinfBody.version === 0 ? u16(data, iinfBody.at) : u32(data, iinfBody.at);
  if (entryCount > MAX_ITEMS) throw new HeifError(messages.limits);
  const infeBoxes = readBoxes(data, iinfBody.at + (iinfBody.version === 0 ? 2 : 4), iinf.dataEnd);
  const items = new Map<number, HeifItem>();
  for (const infe of infeBoxes) {
    if (infe.type !== "infe") continue;
    const body = payloadOf(data, infe);
    const id = body.version >= 3 ? u32(data, body.at) : u16(data, body.at);
    const typeAt = body.version >= 3 ? body.at + 6 : body.at + 4;
    items.set(id, {
      id,
      kind: kindOf(fourcc(data, typeAt)),
      hidden: (body.flags & 1) === 1,
      properties: {},
      children: [],
    });
  }

  const iref = findBox(metaBoxes, "iref");
  if (iref) {
    const body = payloadOf(data, iref);
    for (const reference of readBoxes(data, body.at, iref.dataEnd)) {
      if (reference.type !== "dimg") continue;
      const wide = body.version >= 1;
      const from = wide ? u32(data, reference.dataStart) : u16(data, reference.dataStart);
      const countAt = reference.dataStart + (wide ? 4 : 2);
      const count = u16(data, countAt);
      const children: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const at = countAt + 2 + index * (wide ? 4 : 2);
        children.push(wide ? u32(data, at) : u16(data, at));
      }
      const parent = items.get(from);
      if (parent) parent.children = children;
    }
  }

  const iprp = findBox(metaBoxes, "iprp");
  if (iprp) {
    const inner = readBoxes(data, iprp.dataStart, iprp.dataEnd);
    const ipco = findBox(inner, "ipco");
    const ipma = findBox(inner, "ipma");
    const properties = ipco ? readBoxes(data, ipco.dataStart, ipco.dataEnd).map((box) => readProperty(data, box)) : [];
    if (ipma) {
      const body = payloadOf(data, ipma);
      let at = body.at;
      const entries = u32(data, at);
      at += 4;
      const wideId = body.version >= 1;
      const wideIndex = (body.flags & 1) === 1;
      for (let index = 0; index < entries; index += 1) {
        const id = wideId ? u32(data, at) : u16(data, at);
        at += wideId ? 4 : 2;
        const count = data[at] ?? 0;
        at += 1;
        const item = items.get(id);
        for (let assoc = 0; assoc < count; assoc += 1) {
          let propertyIndex = 0;
          if (wideIndex) {
            propertyIndex = u16(data, at) & 0x7fff;
            at += 2;
          } else {
            propertyIndex = (data[at] ?? 0) & 0x7f;
            at += 1;
          }
          const property = properties[propertyIndex - 1];
          if (!item || !property) continue;
          if (property.type === "ispe") item.properties.ispe = { width: property.width, height: property.height };
          if (property.type === "clap") item.properties.clap = property.clap;
          if (property.type === "irot") item.properties.irot = property.angle;
          if (property.type === "imir") item.properties.imir = property.axis;
        }
      }
    }
  }

  const imageItems = [...items.values()].filter((item) => item.kind === "grid" || item.kind === "hvc1" || item.kind === "hev1");
  const pitmBox = findBox(metaBoxes, "pitm");
  let primaryId = pitmBox
    ? (() => {
        const body = payloadOf(data, pitmBox);
        return body.version === 0 ? u16(data, body.at) : u32(data, body.at);
      })()
    : 0;
  if (!items.has(primaryId)) {
    const fallback =
      imageItems.find((item) => item.kind === "grid" && !item.hidden) ??
      imageItems.find((item) => (item.kind === "hvc1" || item.kind === "hev1") && !item.hidden) ??
      imageItems[0];
    if (!fallback) throw new HeifError(messages.noImage);
    primaryId = fallback.id;
    warnings.push(messages.primaryFallback);
  }
  const primary = items.get(primaryId);
  if (!primary) throw new HeifError(messages.noImage);

  let grid: Grid | null = null;
  let canvas = primary.properties.ispe ?? { width: 0, height: 0 };
  if (primary.kind === "grid") {
    const idat = findBox(metaBoxes, "idat");
    const iloc = findBox(metaBoxes, "iloc");
    const extents = iloc ? readIloc(data, iloc).get(primary.id) : undefined;
    const bytes = extents ? readItemBytes(data, extents, idat) : null;
    if (!bytes || bytes.length < 4 || bytes[0] !== 0) {
      warnings.push(messages.gridUnread);
    } else {
      const flags = bytes[1] ?? 0;
      const rows = (bytes[2] ?? 0) + 1;
      const columns = (bytes[3] ?? 0) + 1;
      const wide = (flags & 1) === 1;
      const outputWidth = wide ? u32(bytes, 4) : u16(bytes, 4);
      const outputHeight = wide ? u32(bytes, 8) : u16(bytes, 6);
      const childItems = primary.children.map((id) => items.get(id));
      const missingSize = childItems.find((item) => item && !item.properties.ispe);
      if (missingSize) warnings.push(messages.tileNoSize(missingSize.id));
      const layout = layoutTiles(
        columns,
        rows,
        childItems.map((item) => ({
          id: item?.id ?? 0,
          width: item?.properties.ispe?.width ?? 0,
          height: item?.properties.ispe?.height ?? 0,
        })),
        outputWidth,
        outputHeight,
      );
      grid = { rows, columns, outputWidth, outputHeight, tiles: layout.tiles };
      canvas = layout.canvas;
      if (!primary.properties.ispe) warnings.push(messages.gridNoIspe);
      else if (primary.properties.ispe.width !== outputWidth || primary.properties.ispe.height !== outputHeight) {
        warnings.push(messages.sizeDiffer);
      }
    }
  }

  const reference = primary.properties.ispe ?? (grid ? { width: grid.outputWidth, height: grid.outputHeight } : canvas);
  let clapRect = null;
  if (primary.properties.clap) {
    clapRect = cleanApertureRect(primary.properties.clap, reference.width, reference.height);
    if (!clapRect) warnings.push(messages.clapIgnored);
  }

  return {
    primaryItemId: primary.id,
    items: [...items.values()],
    grid,
    canvas,
    clapRect,
    warnings,
  };
}