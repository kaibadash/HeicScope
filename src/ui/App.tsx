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
  ["Clean aperture", "clap-odd.heic"],
  ["Grid", "grid-small-canvas.heic"],
  ["Rotation", "irot-90.heic"],
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

  return (
    <div className="app">
      <header
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (!file) return;
          setForce(false);
          void file.arrayBuffer().then((buffer) => openBuffer(new Uint8Array(buffer), file.name, false));
        }}
      >
        <strong>HeicScope</strong>
        {samples.map(([label, name]) => (
          <button key={name} type="button" onClick={() => void openSample(name)}>{label}</button>
        ))}
        <label className="file">
          Open file
          <input
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setForce(false);
              void file.arrayBuffer().then((buffer) => openBuffer(new Uint8Array(buffer), file.name, false));
            }}
          />
        </label>
        <button type="button" onClick={() => setFitToken((value) => value + 1)}>Fit</button>
        <button type="button" onClick={() => setZoom(1)}>100%</button>
        <label><input type="checkbox" checked={showTiles} onChange={(event) => setShowTiles(event.target.checked)} /> Tile boundaries</label>
        <label><input type="checkbox" checked={showGrid} disabled={!ready?.parsed.grid} onChange={(event) => setShowGrid(event.target.checked)} /> Grid output</label>
        <label><input type="checkbox" checked={showClap} disabled={!ready?.parsed.clapRect} onChange={(event) => setShowClap(event.target.checked)} /> Clean aperture</label>
      </header>
      <main>
        {error ? <p className="error">{error}</p> : null}
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
      <footer>
        <a href="https://github.com/catdad-experiments/libheif-js">Decoder: libheif-js (LGPL-3.0)</a>
      </footer>
    </div>
  );
}