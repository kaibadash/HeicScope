import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const samples = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");
mkdirSync(samples, { recursive: true });

function png(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (tag, data) => {
    const type = Buffer.from(tag);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 0);
    return Buffer.concat([len, type, data, sum]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function run(args, cwd) {
  const result = spawnSync("heif-enc", args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`heif-enc failed: ${args.join(" ")}`);
}

function boxes(buf, start, end) {
  const out = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    out.push({ type: buf.toString("latin1", offset + 4, offset + 8), start: offset, size, ps: offset + header, pe: offset + size });
    offset += size;
  }
  return out;
}

function makeBox(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, "latin1");
  payload.copy(out, 8);
  return out;
}

function metaOf(buf) {
  const top = boxes(buf, 0, buf.length);
  const meta = top.find((box) => box.type === "meta");
  const children = boxes(buf, meta.ps + 4, meta.pe);
  const iprp = children.find((box) => box.type === "iprp");
  const inner = boxes(buf, iprp.ps, iprp.pe);
  return { top, meta, children, iprp, inner, ipco: inner.find((box) => box.type === "ipco"), ipma: inner.find((box) => box.type === "ipma") };
}

function readIpma(buf, ipma) {
  const version = buf[ipma.ps];
  const flags = buf.readUIntBE(ipma.ps + 1, 3);
  if (flags & 1) throw new Error("unexpected 16-bit ipma indexes");
  let at = ipma.ps + 4;
  const count = buf.readUInt32BE(at);
  at += 4;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const id = version >= 1 ? buf.readUInt32BE(at) : buf.readUInt16BE(at);
    at += version >= 1 ? 4 : 2;
    const associations = buf[at];
    at += 1;
    const list = [];
    for (let item = 0; item < associations; item += 1) {
      const value = buf[at];
      at += 1;
      list.push({ index: value & 0x7f, essential: value >> 7 });
    }
    entries.push({ id, list });
  }
  return { version, flags, entries };
}

function writeIpma(version, flags, entries) {
  const parts = [Buffer.alloc(8)];
  parts[0][0] = version;
  parts[0].writeUIntBE(flags, 1, 3);
  parts[0].writeUInt32BE(entries.length, 4);
  for (const entry of entries) {
    const id = Buffer.alloc(version >= 1 ? 4 : 2);
    if (version >= 1) id.writeUInt32BE(entry.id, 0);
    else id.writeUInt16BE(entry.id, 0);
    parts.push(id, Buffer.from([entry.list.length]));
    for (const association of entry.list) parts.push(Buffer.from([(association.essential << 7) | association.index]));
  }
  return makeBox("ipma", Buffer.concat(parts));
}

function patchBaseOffsets(buf, shift) {
  if (shift === 0) return buf;
  const { meta, children } = metaOf(buf);
  const iloc = children.find((box) => box.type === "iloc");
  const version = buf[iloc.ps];
  let at = iloc.ps + 4;
  const first = buf[at];
  at += 1;
  const second = buf[at];
  at += 1;
  const offsetSize = first >> 4;
  const lengthSize = first & 0x0f;
  const baseSize = second >> 4;
  const indexSize = version >= 1 ? second & 0x0f : 0;
  const count = version < 2 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
  at += version < 2 ? 2 : 4;
  for (let index = 0; index < count; index += 1) {
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version === 1 || version === 2) {
      method = buf.readUInt16BE(at) & 0x0f;
      at += 2;
    }
    at += 2;
    const baseAt = at;
    if (baseSize) at += baseSize;
    const extents = buf.readUInt16BE(at);
    at += 2;
    for (let extent = 0; extent < extents; extent += 1) {
      if ((version === 1 || version === 2) && indexSize) at += indexSize;
      at += offsetSize + lengthSize;
    }
    if (baseSize && method === 0) {
      const base = buf.readUIntBE(baseAt, baseSize);
      buf.writeUIntBE(base + shift, baseAt, baseSize);
    }
  }
  void meta;
  return buf;
}

function rebuild(buf, newIpco, newIpma) {
  const { top, meta, children, inner } = metaOf(buf);
  const iprpParts = inner.map((box) => {
    if (box.type === "ipco") return newIpco;
    if (box.type === "ipma") return newIpma;
    return buf.subarray(box.start, box.pe);
  });
  const newIprp = makeBox("iprp", Buffer.concat(iprpParts));
  const metaParts = [buf.subarray(meta.ps, meta.ps + 4)];
  for (const child of children) metaParts.push(child.type === "iprp" ? newIprp : buf.subarray(child.start, child.pe));
  const newMeta = makeBox("meta", Buffer.concat(metaParts));
  const ftyp = top.find((box) => box.type === "ftyp");
  const mdat = top.find((box) => box.type === "mdat");
  const out = Buffer.concat([buf.subarray(ftyp.start, ftyp.pe), newMeta, buf.subarray(mdat.start, mdat.pe)]);
  return patchBaseOffsets(out, newMeta.length - meta.size);
}

function writeClap() {
  const dir = mkdtempSync(join(tmpdir(), "heicscope-"));
  const source = join(dir, "solid.png");
  writeFileSync(source, png(32, 32, (x, y) => [(x * 8) & 255, (y * 8) & 255, 80]));
  const encoded = join(dir, "clap.heic");
  run(["-q", "40", "-o", encoded, source]);
  const buf = Buffer.from(readFileSync(encoded));
  const located = metaOf(buf);
  const props = boxes(buf, located.ipco.ps, located.ipco.pe);
  const ispe = props.find((box) => box.type === "ispe");
  const clap = props.find((box) => box.type === "clap");
  if (!ispe || !clap) throw new Error("clap sample is missing ispe or clap");
  buf.writeUInt32BE(32, ispe.ps + 4);
  buf.writeUInt32BE(32, ispe.ps + 8);
  [31, 1, 32, 1, -1, 2, 0, 1].forEach((value, index) => buf.writeInt32BE(value, clap.ps + index * 4));
  writeFileSync(join(samples, "clap-odd.heic"), buf);
  rmSync(dir, { recursive: true, force: true });
}

const glyphs = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
};

function writeRotation() {
  const dir = mkdtempSync(join(tmpdir(), "heicscope-"));
  const source = join(dir, "wide.png");
  const letters = ["A", "B", "C"];
  const colors = [[255, 77, 77], [255, 204, 0], [61, 255, 154]];
  const scale = 5;
  const glyphWidth = 5 * scale;
  const glyphHeight = 7 * scale;
  const gap = 6;
  const displayWidth = 64;
  const displayHeight = 128;
  const originX = Math.floor((displayWidth - glyphWidth) / 2);
  const originY = Math.floor((displayHeight - (letters.length * glyphHeight + (letters.length - 1) * gap)) / 2);
  // irot 1 turns this 128×64 bitmap 90° CCW into a 64×128 display. Draw the glyphs
  // in that display space so it reads A, B, C from top to bottom.
  writeFileSync(source, png(128, 64, (x, y) => {
    const displayX = y;
    const displayY = displayHeight - 1 - x;
    for (let index = 0; index < letters.length; index += 1) {
      const top = originY + index * (glyphHeight + gap);
      const column = Math.floor((displayX - originX) / scale);
      const row = Math.floor((displayY - top) / scale);
      const bits = glyphs[letters[index]];
      if (column >= 0 && row >= 0 && row < bits.length && column < bits[row].length && bits[row][column] === "1") return colors[index];
    }
    return [32, 36, 42];
  }));
  const encoded = join(dir, "rot.heic");
  run(["-L", "-o", encoded, source]);
  const buf = Buffer.from(readFileSync(encoded));
  const located = metaOf(buf);
  const props = boxes(buf, located.ipco.ps, located.ipco.pe);
  if (props.some((box) => box.type === "clap")) throw new Error("128x64 encode unexpectedly contains clap");
  const ispe = props.find((box) => box.type === "ispe");
  if (buf.readUInt32BE(ispe.ps + 4) !== 128 || buf.readUInt32BE(ispe.ps + 8) !== 64) throw new Error("unexpected ispe");
  const ipma = readIpma(buf, located.ipma);
  const chunks = props.map((box) => buf.subarray(box.start, box.pe));
  chunks.push(makeBox("irot", Buffer.from([1])));
  const irotIndex = props.length + 1;
  const entries = ipma.entries.map((entry) => ({
    id: entry.id,
    list: entry.id === 1 ? [...entry.list, { index: irotIndex, essential: 1 }] : entry.list,
  }));
  const rebuilt = rebuild(buf, makeBox("ipco", Buffer.concat(chunks)), writeIpma(ipma.version, ipma.flags, entries));
  writeFileSync(join(samples, "irot-90.heic"), rebuilt);
  rmSync(dir, { recursive: true, force: true });
}

function writeGrid() {
  const dir = mkdtempSync(join(tmpdir(), "heicscope-"));
  writeFileSync(join(dir, "tile-01-01.png"), png(512, 512, () => [200, 40, 40]));
  writeFileSync(join(dir, "tile-01-02.png"), png(512, 512, () => [40, 160, 70]));
  const encoded = join(dir, "grid.heic");
  run(["-q", "40", "--tiled-input", "--tiled-image-width", "600", "--tiled-image-height", "400", "-o", encoded, "tile-01-01.png"], dir);
  const buf = Buffer.from(readFileSync(encoded));
  const located = metaOf(buf);
  const props = boxes(buf, located.ipco.ps, located.ipco.pe);
  const ipma = readIpma(buf, located.ipma);
  const clapIndexes = new Set(props.map((box, index) => (box.type === "clap" ? index + 1 : 0)).filter(Boolean));
  const gridEntry = ipma.entries.find((entry) => entry.id === 1);
  const gridIspe = gridEntry.list.map((item) => props[item.index - 1]).find((box) => box?.type === "ispe");
  if (buf.readUInt32BE(gridIspe.ps + 4) !== 600 || buf.readUInt32BE(gridIspe.ps + 8) !== 400) {
    throw new Error("grid ispe is not 600x400");
  }
  for (const entry of ipma.entries.filter((item) => item.id !== 1)) {
    if (entry.list.some((item) => clapIndexes.has(item.index))) throw new Error(`tile ${entry.id} has clap`);
    const tileIspe = entry.list.map((item) => props[item.index - 1]).find((box) => box?.type === "ispe");
    if (buf.readUInt32BE(tileIspe.ps + 4) !== 512 || buf.readUInt32BE(tileIspe.ps + 8) !== 512) {
      throw new Error(`tile ${entry.id} ispe is not 512x512`);
    }
  }
  const idat = located.children.find((box) => box.type === "idat");
  const grid = buf.subarray(idat.ps, idat.pe);
  if (grid.length !== 8 || grid[2] !== 0 || grid[3] !== 1 || grid.readUInt16BE(4) !== 600 || grid.readUInt16BE(6) !== 400) {
    throw new Error("ImageGrid is not 1x2 of 600x400");
  }
  writeFileSync(join(samples, "grid-small-canvas.heic"), buf);
  rmSync(dir, { recursive: true, force: true });
}

const wanted = new Set(process.argv.slice(2));
const selected = (name) => wanted.size === 0 || wanted.has(name);
if (selected("clap")) writeClap();
if (selected("rotation")) writeRotation();
if (selected("grid")) writeGrid();