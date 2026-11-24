/// <reference types="vite/client" />
import { useEffect, useState } from "react";
import { renderPixels, type PixelLayer } from "../heif/decode";
import { messages } from "../heif/messages";
import { parseHeif } from "../heif/parseHeif";
import type { HeifFile, TileCell } from "../heif/types";
import { HeifError } from "../heif/types";
import { SidePanel } from "./SidePanel";
import { Viewport } from "./Viewport";

const samples = [
  ["Clean aperture", "clap-odd.heic", "Sample file with an odd clean aperture"],
  ["Grid", "grid-small-canvas.heic", "Sample file whose tiles are larger than the grid"],
  ["Rotation", "irot-90.heic", "Sample file rotated 90°"],
] as const;

const overlays = [
  ["Tile boundaries", "#3dff9a"],
  ["Grid output", "#ffcc00"],
  ["Clean aperture", "#ff4d4d"],
] as const;

type Ready = {
  name: string;
  bytes: Uint8Array;
  parsed: HeifFile;
  layer: PixelLayer | null;
  warnings: string[];
};

function tilesOf(parsed: HeifFile): TileCell[] {
  if (parsed.grid) return parsed.grid.tiles;
  const primary = parsed.items.find((item) => item.id === parsed.primaryItemId);
  if (!primary?.properties.ispe) return [];
  return [{
    id: primary.id,
    column: 0,
    row: 0,
    x: 0,
    y: 0,
    storedWidth: primary.properties.ispe.width,
    storedHeight: primary.properties.ispe.height,
  }];
}

function Swatch({ color, on }: { color: string; on: boolean }) {
  return (
    <span
      className="size-2.5 shrink-0 rounded-[3px] border"
      style={{ borderColor: color, background: on ? color : "transparent" }}
    />
  );
}

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [force, setForce] = useState(false);
  const [showTiles, setShowTiles] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showClap, setShowClap] = useState(true);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 16, y: 16 });
  const [fitToken, setFitToken] = useState(0);
  const [dropping, setDropping] = useState(false);

  async function openBuffer(bytes: Uint8Array, name: string, decodeForce: boolean) {
    try {
      const parsed = parseHeif(bytes);
      const pixels = await renderPixels(bytes, parsed, decodeForce);
      setError(null);
      setReady({ name, bytes, parsed, layer: pixels.layer, warnings: [...parsed.warnings, ...pixels.warnings] });
      setFitToken((value) => value + 1);
    } catch (caught) {
      setReady(null);
      setError(caught instanceof HeifError ? caught.message : messages.notHeif);
    }
  }

  useEffect(() => {
    void fetch(`${import.meta.env.BASE_URL}samples/grid-small-canvas.heic`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => openBuffer(new Uint8Array(buffer), "grid-small-canvas.heic", false));
  }, []);

  async function openSample(name: string) {
    setForce(false);
    const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
    await openBuffer(new Uint8Array(await response.arrayBuffer()), name, false);
  }

  const tooLarge = ready?.warnings.some((warning) => warning.startsWith("This image is too large")) ?? false;
  const tool = "rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[13px] text-zinc-100 hover:bg-white/10";

  return (
    <div className="flex h-dvh flex-col bg-[#0c0e12] text-zinc-100">
      <header
        className={`shrink-0 border-b border-white/10 bg-[#14181e] ${dropping ? "ring-1 ring-inset ring-[#3dff9a]" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const file = event.dataTransfer.files[0];
          if (!file) return;
          setForce(false);
          void file.arrayBuffer().then((buffer) => openBuffer(new Uint8Array(buffer), file.name, false));
        }}
      >
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          <strong className="inline-flex items-center gap-2 text-sm tracking-tight">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.25" y="1.25" width="13.5" height="13.5" fill="none" stroke="#3dff9a" strokeWidth="1.4" />
              <rect x="3.5" y="2.75" width="9" height="10.5" fill="none" stroke="#ff4d4d" strokeWidth="1.4" />
            </svg>
            HeicScope
          </strong>
          <div className="flex rounded-lg bg-black/30 p-0.5" role="group" aria-label="Sample files">
            {samples.map(([label, name, hint]) => (
              <button
                key={name}
                type="button"
                title={hint}
                className={`rounded-md px-2.5 py-1 text-[13px] ${ready?.name === name ? "bg-white font-medium text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
                onClick={() => void openSample(name)}
              >
                Sample: {label}
              </button>
            ))}
          </div>
          <label className={`${tool} cursor-pointer`}>
            Open file
            <input
              className="hidden"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                setForce(false);
                void file.arrayBuffer().then((buffer) => openBuffer(new Uint8Array(buffer), file.name, false));
              }}
            />
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" className={tool} onClick={() => setFitToken((value) => value + 1)}>Fit</button>
            <button type="button" className={tool} onClick={() => setZoom(1)}>100%</button>
            <span className="min-w-12 text-right font-mono text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-white/10 px-3 py-1.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-white/5">
            <input type="checkbox" className="sr-only" checked={showTiles} onChange={(event) => setShowTiles(event.target.checked)} />
            <Swatch color={overlays[0][1]} on={showTiles} />
            {overlays[0][0]}
          </label>
          <label className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-[13px] ${ready?.parsed.grid ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-35"}`}>
            <input type="checkbox" className="sr-only" checked={showGrid} disabled={!ready?.parsed.grid} onChange={(event) => setShowGrid(event.target.checked)} />
            <Swatch color={overlays[1][1]} on={showGrid && Boolean(ready?.parsed.grid)} />
            {overlays[1][0]}
          </label>
          <label className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-[13px] ${ready?.parsed.clapRect ? "cursor-pointer hover:bg-white/5" : "cursor-not-allowed opacity-35"}`}>
            <input type="checkbox" className="sr-only" checked={showClap} disabled={!ready?.parsed.clapRect} onChange={(event) => setShowClap(event.target.checked)} />
            <Swatch color={overlays[2][1]} on={showClap && Boolean(ready?.parsed.clapRect)} />
            {overlays[2][0]}
          </label>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {error ? (
          <p className="m-auto max-w-md rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</p>
        ) : null}
        {ready ? (
          <Viewport
            width={ready.parsed.canvas.width}
            height={ready.parsed.canvas.height}
            layer={ready.layer}
            tiles={tilesOf(ready.parsed)}
            grid={ready.parsed.grid}
            clap={ready.parsed.clapRect}
            showTiles={showTiles}
            showGrid={showGrid}
            showClap={showClap}
            highlightId={highlight}
            zoom={zoom}
            pan={pan}
            fitToken={fitToken}
            onZoom={(next, nextPan) => { setZoom(next); setPan(nextPan); }}
            onPan={setPan}
          />
        ) : null}
        {ready ? (
          <SidePanel
            fileName={ready.name}
            parsed={ready.parsed}
            tiles={tilesOf(ready.parsed)}
            warnings={ready.warnings}
            tooLarge={tooLarge && !force}
            onHighlight={setHighlight}
            onDecode={() => {
              setForce(true);
              void openBuffer(ready.bytes, ready.name, true);
            }}
          />
        ) : null}
      </main>
      <footer className="shrink-0 border-t border-white/10 bg-[#14181e] px-3 py-1.5 text-xs text-zinc-500">
        <a className="text-sky-300/80 hover:text-sky-200" href="https://github.com/catdad-experiments/libheif-js">Decoder: libheif-js (LGPL-3.0)</a>
      </footer>
    </div>
  );
}
