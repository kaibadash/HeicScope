export const messages = {
  notHeif: "This file is not a HEIF image.",
  truncated: (offset: number) => `Truncated box at offset ${offset}.`,
  limits: "This HEIF file exceeds the parser limits.",
  noImage: "This file has no image item.",
  primaryFallback: "Primary item was missing. Showing the first image item.",
  clapIgnored: "Clean aperture was ignored because it is malformed.",
  gridNoIspe: "The grid item has no stored size. The clean aperture uses the grid output size.",
  sizeDiffer: "Stored size and grid output size differ.",
  tileCount:
    "Tile count does not match the grid. Showing the composed image placed in the grid output.",
  tileTransform:
    "A tile has its own transformations. Showing the composed image placed in the grid output.",
  tileDecode:
    "Tile decode failed. Showing the composed image placed in the grid output. Pixels outside that rectangle are not available.",
  tileSize: (id: number, w: number, h: number, sw: number, sh: number) =>
    `Tile ${id} decoded at ${w}×${h}; stored size is ${sw}×${sh}.`,
  tileNoSize: (id: number) => `Tile ${id} has no stored size.`,
  decodedMismatch: "Decoded size does not match the clean aperture. Showing geometry only.",
  overlay: "Overlay images are not reconstructed.",
  decoderLoad: "Decoder failed to load.",
  primaryDecode: "The primary image could not be decoded. Showing geometry only.",
  tooLarge: (w: number, h: number) =>
    `This image is too large to decode in the browser (${w}×${h}). Showing geometry only.`,
  buffer: "The browser refused to allocate the pixel buffer.",
  gridUnread: "The grid image data could not be read.",
};