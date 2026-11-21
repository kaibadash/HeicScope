export class HeifError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeifError";
  }
}

export type Fraction = { numerator: bigint; denominator: bigint };

export type Clap = {
  width: Fraction;
  height: Fraction;
  horizontalOffset: Fraction;
  verticalOffset: Fraction;
};

export type PixelRect = { x: number; y: number; width: number; height: number };

export type ItemKind = "grid" | "hvc1" | "hev1" | "iovl" | "other";

export type ItemProperties = {
  ispe?: { width: number; height: number };
  clap?: Clap;
  irot?: 0 | 1 | 2 | 3;
  imir?: 0 | 1;
};

export type HeifItem = {
  id: number;
  kind: ItemKind;
  hidden: boolean;
  properties: ItemProperties;
  children: number[];
};

export type TileCell = {
  id: number;
  column: number;
  row: number;
  x: number;
  y: number;
  storedWidth: number;
  storedHeight: number;
};

export type Grid = {
  rows: number;
  columns: number;
  outputWidth: number;
  outputHeight: number;
  tiles: TileCell[];
};

export type HeifFile = {
  primaryItemId: number;
  items: HeifItem[];
  grid: Grid | null;
  canvas: { width: number; height: number };
  clapRect: PixelRect | null;
  warnings: string[];
};

export type Rgba = { width: number; height: number; data: Uint8ClampedArray };