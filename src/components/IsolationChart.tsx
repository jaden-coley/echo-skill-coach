"use client";

import { useState } from "react";

/*
 * Isolation over the session: how much of the finger motion came from the
 * index + middle fingers. One series, so no legend — the title names it.
 * 2px line, recessive grid, a labeled "good" reference line, crosshair +
 * tooltip on hover, and a table view for anyone who can't use the plot.
 */

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 22, left: 34 };
// Validated against the dark surface (lightness band + contrast).
const SERIES_COLOR = "#059669";

export interface IsolationPoint {
  time: number;
  isolation: number;
}

export default function IsolationChart({
  points,
  goodThreshold,
}: {
  points: IsolationPoint[];
  goodThreshold: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">
        Start opening and closing the chopsticks — your technique will chart here live.
      </p>
    );
  }

  const start = points[0].time;
  const span = Math.max(points[points.length - 1].time - start, 1);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - start) / span) * plotW;
  const y = (value: number) => PAD.top + (1 - value / 100) * plotH;

  const path = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.time).toFixed(1)},${y(p.isolation).toFixed(1)}`)
    .join(" ");
  const active = hover === null ? null : points[hover];

  // Snap the crosshair to the nearest sample — readers aim at a moment in
  // time, not at a 2px line.
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.time) - px) < Math.abs(x(points[nearest].time) - px)) nearest = i;
    });
    setHover(nearest);
  };

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`Finger control over the session, latest ${Math.round(
            points[points.length - 1].isolation,
          )}%`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#27272a"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(tick) + 3}
                textAnchor="end"
                className="fill-zinc-500 text-[10px]"
              >
                {tick}%
              </text>
            </g>
          ))}

          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(goodThreshold)}
            y2={y(goodThreshold)}
            stroke="#71717a"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={WIDTH - PAD.right}
            y={y(goodThreshold) - 4}
            textAnchor="end"
            className="fill-zinc-400 text-[10px]"
          >
            good ≥ {goodThreshold}%
          </text>

          <path
            d={path}
            fill="none"
            stroke={SERIES_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {active && (
            <g>
              <line
                x1={x(active.time)}
                x2={x(active.time)}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
                stroke="#a1a1aa"
                strokeWidth={1}
              />
              <circle
                cx={x(active.time)}
                cy={y(active.isolation)}
                r={4}
                fill={SERIES_COLOR}
                stroke="#09090b"
                strokeWidth={2}
              />
            </g>
          )}

          <text x={PAD.left} y={HEIGHT - 6} className="fill-zinc-500 text-[10px]">
            start
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 6}
            textAnchor="end"
            className="fill-zinc-500 text-[10px]"
          >
            now
          </text>
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute top-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs shadow-lg"
            style={{
              left: `${(x(active.time) / WIDTH) * 100}%`,
              transform: x(active.time) > WIDTH / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <p className="font-mono font-semibold text-zinc-100">
              {Math.round(active.isolation)}%
            </p>
            <p className="text-zinc-400">
              finger control · {new Date(active.time).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
        )}
      </div>

      <details className="mt-2 text-xs text-zinc-500">
        <summary className="cursor-pointer hover:text-zinc-300">View as table</summary>
        <table className="mt-2 w-full text-left font-mono">
          <thead>
            <tr className="text-zinc-400">
              <th className="py-1 font-normal">Time</th>
              <th className="py-1 font-normal">Finger control</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.time} className="border-t border-zinc-800">
                <td className="py-1">{new Date(p.time).toLocaleTimeString()}</td>
                <td className="py-1">{Math.round(p.isolation)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
