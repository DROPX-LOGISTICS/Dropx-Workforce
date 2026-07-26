"use client";

import { useMemo, useState } from "react";
import type { CapacityMapLayerFeature } from "@/lib/ops-pulse/capacity";

const WIDTH = 1000;
const HEIGHT = 560;
const TILE = 256;

function world(point: { lat: number; lng: number }, zoom: number) {
  const scale = TILE * (2 ** zoom);
  const lat = Math.max(Math.min(point.lat, 85.05112878), -85.05112878);
  const sin = Math.sin(lat * Math.PI / 180);
  return { x: (point.lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}
function fitZoom(points: Array<{ lat: number; lng: number }>) {
  for (let zoom = 17; zoom >= 6; zoom -= 1) {
    const projected = points.map((point) => world(point, zoom));
    const xs = projected.map((point) => point.x);
    const ys = projected.map((point) => point.y);
    if (Math.max(...xs) - Math.min(...xs) < WIDTH * .72 && Math.max(...ys) - Math.min(...ys) < HEIGHT * .68) return zoom;
  }
  return 6;
}

export function CapacityStationLayerMap({ stationCode, features }: { stationCode: string; features: CapacityMapLayerFeature[] }) {
  const pincodes = features.filter((feature) => /^\d{6}$/.test(feature.name));
  const [selected, setSelected] = useState("all");
  const [zoomOffset, setZoomOffset] = useState(0);
  const visible = selected === "all" ? features : features.filter((feature) => feature.name === selected);
  const points = visible.flatMap((feature) => feature.coordinates);
  const baseZoom = fitZoom(points);
  const zoom = Math.max(6, Math.min(18, baseZoom + zoomOffset));
  const center = {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length
  };
  const centerWorld = world(center, zoom);
  const left = centerWorld.x - WIDTH / 2;
  const top = centerWorld.y - HEIGHT / 2;
  const maxTile = 2 ** zoom;
  const tiles = useMemo(() => {
    const rows: Array<{ key: string; src: string; x: number; y: number }> = [];
    for (let x = Math.floor(left / TILE); x <= Math.floor((left + WIDTH) / TILE); x += 1) {
      for (let y = Math.floor(top / TILE); y <= Math.floor((top + HEIGHT) / TILE); y += 1) {
        if (y < 0 || y >= maxTile) continue;
        const wrapped = ((x % maxTile) + maxTile) % maxTile;
        rows.push({ key: `${zoom}-${x}-${y}`, src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${y}.png`, x: x * TILE - left, y: y * TILE - top });
      }
    }
    return rows;
  }, [left, maxTile, top, zoom]);
  const screen = (point: { lat: number; lng: number }) => {
    const projected = world(point, zoom);
    return { x: projected.x - left, y: projected.y - top };
  };

  return <div className="capacity-internal-map capacity-layer-map">
    <div className="capacity-map-toolbar"><div><strong>{stationCode} serviceable area</strong><span>{pincodes.length} mapped pincodes · station layer only</span></div><label>Pincode<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="all">All service pincodes</option>{pincodes.map((feature) => <option key={feature.name}>{feature.name}</option>)}</select></label><div className="capacity-map-zoom"><button type="button" onClick={() => setZoomOffset((value) => Math.min(4, value + 1))}>+</button><button type="button" onClick={() => setZoomOffset((value) => Math.max(-4, value - 1))}>−</button></div></div>
    <div className="capacity-map-canvas">
      {tiles.map((tile) => <img alt="" draggable={false} key={tile.key} src={tile.src} style={{ left: tile.x, top: tile.y }}/>)}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">{visible.map((feature, index) => {
        const plotted = feature.coordinates.map(screen);
        const first = plotted[0];
        const isArea = plotted.length > 2;
        return <g key={`${feature.name}-${index}`}>{isArea ? <polygon fill="rgba(234,88,12,.16)" points={plotted.map((point) => `${point.x},${point.y}`).join(" ")} stroke="#ea580c" strokeWidth={3}/> : <circle cx={first.x} cy={first.y} fill={/^\d{6}$/.test(feature.name) ? "#ea580c" : "#111827"} r={10} stroke="white" strokeWidth={3}/>}<text className={/^\d{6}$/.test(feature.name) ? "route-label" : "station-label"} x={first.x + 13} y={first.y - 9}>{feature.name}</text></g>;
      })}</svg>
      <small className="capacity-map-attribution">Service layer from Google My Maps · basemap © OpenStreetMap contributors</small>
    </div>
  </div>;
}
