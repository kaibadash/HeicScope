export function rotationLabel(angle: 0 | 1 | 2 | 3 | undefined): string {
  if (angle === 1) return "90° CCW";
  if (angle === 2) return "180°";
  if (angle === 3) return "270° CCW";
  return "0°";
}

export function mirrorLabel(axis: 0 | 1 | undefined): string {
  if (axis === 0) return "vertical axis";
  if (axis === 1) return "horizontal axis";
  return "none";
}