import type { ReactNode } from "react";
import type { HeifFile, TileCell } from "../heif/types";
import { mirrorLabel, rotationLabel } from "./labels";

function fraction(value: { numerator: bigint; denominator: bigint } | undefined): string {
  if (!value) return "none";
  return `${value.numerator.toString()}/${value.denominator.toString()}`;
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-white/10 py-1.5">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{props.label}</div>
      <div className="mt-1 font-mono text-[13px] leading-5 break-words text-zinc-50">{props.children}</div>
    </div>
  );
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
    <aside className="panel h-full min-h-0 w-80 shrink-0 overflow-auto border-l border-white/10 bg-[#12161c] px-4 py-3">
      <Field label="File">{props.fileName}</Field>
      <Field label="Primary item">{primary ? `${primary.id} ${primary.kind}` : "none"}</Field>
      <Field label="Stored size">{ispe ? `${ispe.width}×${ispe.height}` : "none"}</Field>
      <Field label="Clean aperture">
        {clap && rect
          ? `${fraction(clap.width)} × ${fraction(clap.height)}, offset ${fraction(clap.horizontalOffset)}, ${fraction(clap.verticalOffset)}, ${rect.x}, ${rect.y}, ${rect.width}×${rect.height}`
          : "none"}
      </Field>
      <Field label="Rotation">{rotationLabel(primary?.properties.irot)}</Field>
      <Field label="Mirror">{mirrorLabel(primary?.properties.imir)}</Field>
      <Field label="Grid">
        {props.parsed.grid
          ? `${props.parsed.grid.rows}×${props.parsed.grid.columns}, ${props.parsed.grid.outputWidth}×${props.parsed.grid.outputHeight}`
          : "none"}
      </Field>
      {props.warnings.map((warning) => (
        <p key={warning} className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[13px] leading-5 text-amber-100">
          {warning}
        </p>
      ))}
      <div className="pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">Tiles</div>
      <ul className="mt-1">
        {props.tiles.map((tile) => (
          <li
            key={tile.id}
            className="cursor-default rounded-md px-2 py-1.5 font-mono text-[13px] text-zinc-200 hover:bg-[#3dff9a]/10"
            onMouseEnter={() => props.onHighlight(tile.id)}
            onMouseLeave={() => props.onHighlight(null)}
          >
            {tile.id} {tile.storedWidth}×{tile.storedHeight} at {tile.x},{tile.y}
          </li>
        ))}
      </ul>
      {props.tooLarge ? (
        <button
          type="button"
          className="mt-3 w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200"
          onClick={props.onDecode}
        >
          Decode pixels anyway
        </button>
      ) : null}
    </aside>
  );
}
