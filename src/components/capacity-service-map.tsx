"use client";

import { useMemo, useState } from "react";
import type { CapacityServiceRoute } from "@/lib/ops-pulse/capacity";

const WIDTH = 1000;
const HEIGHT = 560;
const TILE = 256;

function world(point: { lat: number; lng: number }, zoom: number) {
  const scale = TILE * (2 ** zoom);
  const lat = Math.max(Math.min(point.lat, 85.05112878), -85.05112878);
  const sin = Math.sin(lat * Math.PI / 180);
  return { x: (point.lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}
function zoomFor(points: Array<{ lat: number; lng: number }>) {
  for (let zoom = 16; zoom >= 7; zoom -= 1) {
    const xs = points.map((point) => world(point, zoom).x);
    const ys = points.map((point) => world(point, zoom).y);
    if (Math.max(...xs) - Math.min(...xs) < WIDTH * .78 && Math.max(...ys) - Math.min(...ys) < HEIGHT * .72) return zoom;
  }
  return 7;
}

export function CapacityServiceMap({ routes, station }: {
  routes: CapacityServiceRoute[];
  station?: { lat: number; lng: number; label: string } | null;
}) {
  const [vehicle, setVehicle] = useState("all");
  const [pincode, setPincode] = useState("all");
  const [zoomOffset, setZoomOffset] = useState(0);
  const pincodes = [...new Set(routes.map((route) => route.pincode))].sort();
  const visible = routes.filter((route) => (vehicle === "all" || route.vehicleType === vehicle) && (pincode === "all" || route.pincode === pincode));
  const points = visible.flatMap((route) => route.coordinates);
  if (station) points.push(station);
  const baseZoom = points.length ? zoomFor(points) : 10;
  const zoom = Math.max(7, Math.min(18, baseZoom + zoomOffset));
  const center = points.length ? {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length
  } : { lat: 20.5937, lng: 78.9629 };
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

  return <div className="capacity-internal-map">
    <div className="capacity-map-toolbar"><div><strong>Internal service-area map</strong><span>{visible.length} routes · {new Set(visible.map((route) => route.daId)).size} DAs</span></div><label>Vehicle<select value={vehicle} onChange={(event) => setVehicle(event.target.value)}><option value="all">Bike + van</option><option value="bike">Bike</option><option value="van">Van</option></select></label><label>Pincode<select value={pincode} onChange={(event) => setPincode(event.target.value)}><option value="all">All pincodes</option>{pincodes.map((code) => <option key={code}>{code}</option>)}</select></label><div className="capacity-map-zoom"><button type="button" onClick={() => setZoomOffset((value) => Math.min(4, value + 1))}>+</button><button type="button" onClick={() => setZoomOffset((value) => Math.max(-4, value - 1))}>−</button></div></div>
    <div className="capacity-map-canvas">
      {tiles.map((tile) => <img alt="" draggable={false} key={tile.key} src={tile.src} style={{ left: tile.x, top: tile.y }}/>)}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        {visible.map((route) => {
          const plotted = route.coordinates.map(screen);
          const last = plotted.at(-1);
          return <g key={`${route.stationCode}-${route.routeName}-${route.daId}`}><polyline fill="none" points={plotted.map((point) => `${point.x},${point.y}`).join(" ")} stroke={route.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={route.vehicleType === "van" ? 6 : 4}/>{last ? <><circle cx={last.x} cy={last.y} fill={route.color} r={9} stroke="white" strokeWidth={3}/><text x={last.x + 12} y={last.y - 8}>{route.daName || route.daId}</text><text className="route-label" x={last.x + 12} y={last.y + 9}>{route.vehicleType.toUpperCase()} · {route.routeName} · {route.pincode}</text></> : null}</g>;
        })}
        {station ? (() => { const marker = screen(station); return <g><circle cx={marker.x} cy={marker.y} fill="#111827" r={12} stroke="white" strokeWidth={4}/><text className="station-label" x={marker.x + 16} y={marker.y + 5}>{station.label}</text></g>; })() : null}
      </svg>
      {!visible.length ? <div className="capacity-map-no-routes">Add route coordinates and DA assignments in Capacity Master.</div> : null}
      <small className="capacity-map-attribution">© OpenStreetMap contributors</small>
    </div>
    <div className="capacity-map-legend">{visible.map((route) => <span key={`${route.routeName}-${route.daId}`}><i style={{ background: route.color }}/><b>{route.vehicleType.toUpperCase()}</b> {route.routeName} · {route.daName || route.daId} · {route.pincode}</span>)}</div>
  </div>;
}
