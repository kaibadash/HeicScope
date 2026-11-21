import { messages } from "../heif/messages";
import { HeifError } from "../heif/types";

export type IsoBox = {
  type: string;
  start: number;
  header: number;
  size: number;
  dataStart: number;
  dataEnd: number;
};

function fourcc(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0);
}

export function readBoxes(data: Uint8Array, start: number, end: number): IsoBox[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) throw new HeifError(messages.truncated(offset));
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new HeifError(messages.truncated(offset));
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new HeifError(messages.truncated(offset));
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) throw new HeifError(messages.truncated(offset));
    boxes.push({
      type: fourcc(data, offset + 4),
      start: offset,
      header,
      size,
      dataStart: offset + header,
      dataEnd: offset + size,
    });
    offset += size;
  }
  return boxes;
}