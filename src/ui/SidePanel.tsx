import type { HeifFile, TileCell } from "../heif/types";
import { mirrorLabel, rotationLabel } from "./labels";

function fraction(value: { numerator: bigint; denominator: bigint } | undefined): string {
  if (!value) return "none";
  return `${value.numerator.toString()}/${value.denominator.toString()}`;
}

export function SidePanel(props: {
  fileName: string;
  parsed: HeifFile;
  tiles: TileCell[];
  warnings: string[];
  tooLarge: boolean;
  onHighlight: (id: number | null) => void;
  onDecode: () => void;
}) {
  const primary = props.parsed.items.find((item) => item.id === props.parsed.primaryItemId);
  const ispe = primary?.properties.ispe;
  const clap = primary?.properties.clap;
  const rect = props.parsed.clapRect;
  return (
    <aside className="panel">
      <p><b>File</b> {props.fileName}</p>
      <p><b>Primary item</b> {primary ? `${primary.id} ${primary.kind}` : "none"}</p>
      <p><b>Stored size</b> {ispe ? `${ispe.width}×${ispe.height}` : "none"}</p>
      <p>
        <b>Clean aperture</b>{" "}
        {clap && rect
          ? `${fraction(clap.width)} × ${fraction(clap.height)}, offset ${fraction(clap.horizontalOffset)}, ${fraction(clap.verticalOffset)}, ${rect.x}, ${rect.y}, ${rect.width}×${rect.height}`
          : "none"}
      </p>
      <p><b>Rotation</b> {rotationLabel(primary?.properties.irot)}</p>
      <p><b>Mirror</b> {mirrorLabel(primary?.properties.imir)}</p>
      <p>
        <b>Grid</b>{" "}
        {props.parsed.grid
          ? `${props.parsed.grid.rows}×${props.parsed.grid.columns}, ${props.parsed.grid.outputWidth}×${props.parsed.grid.outputHeight}`
          : "none"}
      </p>
      <b>Tiles</b>
      <ul>
        {props.tiles.map((tile) => (
          <li key={tile.id} onMouseEnter={() => props.onHighlight(tile.id)} onMouseLeave={() => props.onHighlight(null)}>
            {tile.id} {tile.storedWidth}×{tile.storedHeight} at {tile.x},{tile.y}
          </li>
        ))}
      </ul>
      {props.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      {props.tooLarge ? <button type="button" onClick={props.onDecode}>Decode pixels anyway</button> : null}
    </aside>
  );
}