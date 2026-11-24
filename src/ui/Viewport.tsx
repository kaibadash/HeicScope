import { useEffect, useRef } from "react";
import type { PixelLayer } from "../heif/decode";
import type { PixelRect, TileCell } from "../heif/types";

export function Viewport(props: {
  width: number;
  height: number;
  layer: PixelLayer | null;
  tiles: TileCell[];
  grid: { outputWidth: number; outputHeight: number } | null;
  clap: PixelRect | null;
  showTiles: boolean;
  showGrid: boolean;
  showClap: boolean;
  highlightId: number | null;
  zoom: number;
  pan: { x: number; y: number };
  fitToken: number;
  onZoom: (zoom: number, pan: { x: number; y: number }) => void;
  onPan: (pan: { x: number; y: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = props.layer;
    if (!canvas || !layer) return;
    canvas.width = layer.width;
    canvas.height = layer.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(layer.rgba as ImageData["data"], layer.width, layer.height), 0, 0);
  }, [props.layer]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || props.width === 0 || props.height === 0) return;
    const next = Math.min(
      32,
      Math.max(0.05, Math.min((frame.clientWidth - 32) / props.width, (frame.clientHeight - 32) / props.height)),
    );
    props.onZoom(next, { x: 16, y: 16 });
  }, [props.fitToken, props.width, props.height]);

  return (
    <div
      className="viewport relative min-h-0 min-w-0 flex-1 cursor-grab touch-none overflow-hidden bg-[#090b0e] active:cursor-grabbing"
      ref={frameRef}
      onWheel={(event) => {
        event.preventDefault();
        const next = Math.min(32, Math.max(0.05, props.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const scale = next / props.zoom;
        props.onZoom(next, { x: x - (x - props.pan.x) * scale, y: y - (y - props.pan.y) * scale });
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY, panX: props.pan.x, panY: props.pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        props.onPan({
          x: drag.current.panX + event.clientX - drag.current.x,
          y: drag.current.panY + event.clientY - drag.current.y,
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <div className="stage origin-top-left" style={{ transform: `translate(${props.pan.x}px, ${props.pan.y}px) scale(${props.zoom})` }}>
        <div className="sheet relative" style={{ width: props.width, height: props.height }}>
          {props.layer ? <canvas ref={canvasRef} /> : null}
          <svg viewBox={`0 0 ${props.width} ${props.height}`} width={props.width} height={props.height}>
            {props.showTiles
              ? props.tiles.map((tile) => (
                  <rect
                    key={tile.id}
                    x={tile.x}
                    y={tile.y}
                    width={tile.storedWidth}
                    height={tile.storedHeight}
                    className={tile.id === props.highlightId ? "tile hot" : "tile"}
                  />
                ))
              : null}
            {props.showGrid && props.grid ? (
              <rect className="grid" x={0} y={0} width={props.grid.outputWidth} height={props.grid.outputHeight} />
            ) : null}
            {props.showClap && props.clap ? (
              <rect className="clap" x={props.clap.x} y={props.clap.y} width={props.clap.width} height={props.clap.height} />
            ) : null}
          </svg>
        </div>
      </div>
    </div>
  );
}