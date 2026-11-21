export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(payload, 8);
  return out;
}

export function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + payload.length);
  body[0] = version;
  body[1] = (flags >> 16) & 0xff;
  body[2] = (flags >> 8) & 0xff;
  body[3] = flags & 0xff;
  body.set(payload, 4);
  return box(type, body);
}

export function ftyp(major: string, compatible: string[]): Uint8Array {
  const payload = new Uint8Array(8 + compatible.length * 4);
  payload.set(ascii(major), 0);
  let offset = 8;
  for (const brand of compatible) {
    payload.set(ascii(brand), offset);
    offset += 4;
  }
  return box("ftyp", payload);
}

export function infe(id: number, type: string, hidden = false): Uint8Array {
  const payload = new Uint8Array(9);
  const view = new DataView(payload.buffer);
  view.setUint16(0, id);
  view.setUint16(2, 0);
  payload.set(ascii(type), 4);
  return fullBox("infe", 2, hidden ? 1 : 0, payload);
}

export function iinf(items: Uint8Array[]): Uint8Array {
  const count = new Uint8Array(2);
  new DataView(count.buffer).setUint16(0, items.length);
  return fullBox("iinf", 0, 0, concatBytes([count, ...items]));
}

export function pitm(id: number): Uint8Array {
  const payload = new Uint8Array(2);
  new DataView(payload.buffer).setUint16(0, id);
  return fullBox("pitm", 0, 0, payload);
}

export function hdlr(): Uint8Array {
  const payload = new Uint8Array(21);
  payload.set(ascii("pict"), 4);
  return fullBox("hdlr", 0, 0, payload);
}

export function ispe(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  return fullBox("ispe", 0, 0, payload);
}

export function clapBox(
  widthN: number,
  widthD: number,
  heightN: number,
  heightD: number,
  horizN: number,
  horizD: number,
  vertN: number,
  vertD: number,
): Uint8Array {
  const payload = new Uint8Array(32);
  const view = new DataView(payload.buffer);
  view.setUint32(0, widthN);
  view.setUint32(4, widthD);
  view.setUint32(8, heightN);
  view.setUint32(12, heightD);
  view.setInt32(16, horizN);
  view.setUint32(20, horizD);
  view.setInt32(24, vertN);
  view.setUint32(28, vertD);
  return box("clap", payload);
}

export function irot(angle: number): Uint8Array {
  return box("irot", Uint8Array.of(angle));
}

export function imir(axis: number): Uint8Array {
  return box("imir", Uint8Array.of(axis));
}

export function ipma(entries: { id: number; indexes: number[] }[]): Uint8Array {
  let size = 4;
  for (const entry of entries) size += 3 + entry.indexes.length;
  const payload = new Uint8Array(size);
  const view = new DataView(payload.buffer);
  view.setUint32(0, entries.length);
  let offset = 4;
  for (const entry of entries) {
    view.setUint16(offset, entry.id);
    offset += 2;
    payload[offset] = entry.indexes.length;
    offset += 1;
    for (const index of entry.indexes) payload[offset++] = index & 0x7f;
  }
  return fullBox("ipma", 0, 0, payload);
}

export function dimg(from: number, to: number[]): Uint8Array {
  const body = new Uint8Array(4 + to.length * 2);
  const view = new DataView(body.buffer);
  view.setUint16(0, from);
  view.setUint16(2, to.length);
  to.forEach((id, index) => view.setUint16(4 + index * 2, id));
  return fullBox("iref", 0, 0, box("dimg", body));
}

export function imageGrid(rows: number, columns: number, width: number, height: number, wide: boolean): Uint8Array {
  if (!wide) {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    payload[0] = 0;
    payload[1] = 0;
    payload[2] = rows - 1;
    payload[3] = columns - 1;
    view.setUint16(4, width);
    view.setUint16(6, height);
    return payload;
  }
  const payload = new Uint8Array(12);
  const view = new DataView(payload.buffer);
  payload[0] = 0;
  payload[1] = 1;
  payload[2] = rows - 1;
  payload[3] = columns - 1;
  view.setUint32(4, width);
  view.setUint32(8, height);
  return payload;
}

export function ilocInIdat(itemId: number, length: number): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  payload[0] = 0x44;
  payload[1] = 0x00;
  view.setUint16(2, 1);
  view.setUint16(4, itemId);
  view.setUint16(6, 1);
  view.setUint16(8, 0);
  view.setUint16(10, 1);
  view.setUint32(12, 0);
  view.setUint32(16, length);
  return fullBox("iloc", 1, 0, payload);
}

export type ItemSpec = {
  id: number;
  type: string;
  hidden?: boolean;
  properties: Uint8Array[];
};

export function assemble(options: {
  brands?: string[];
  pitm?: number | null;
  items: ItemSpec[];
  dimg?: { from: number; to: number[] };
  grid?: { itemId: number; body: Uint8Array };
}): Uint8Array {
  const properties: Uint8Array[] = [];
  const associations: { id: number; indexes: number[] }[] = [];
  for (const item of options.items) {
    const indexes: number[] = [];
    for (const property of item.properties) {
      properties.push(property);
      indexes.push(properties.length);
    }
    associations.push({ id: item.id, indexes });
  }
  const children = [
    hdlr(),
    ...(options.pitm === null ? [] : [pitm(options.pitm ?? options.items[0]?.id ?? 1)]),
    ...(options.grid ? [box("idat", options.grid.body), ilocInIdat(options.grid.itemId, options.grid.body.length)] : []),
    iinf(options.items.map((item) => infe(item.id, item.type, item.hidden))),
    box("iprp", concatBytes([box("ipco", concatBytes(properties)), ipma(associations)])),
    ...(options.dimg ? [dimg(options.dimg.from, options.dimg.to)] : []),
  ];
  const brands = options.brands ?? ["mif1", "heic"];
  return concatBytes([ftyp(brands[0] ?? "heic", brands), fullBox("meta", 0, 0, concatBytes(children))]);
}