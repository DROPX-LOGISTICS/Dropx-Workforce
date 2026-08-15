"use client";

import { useMemo, useState } from "react";
import type { CapacityMapLayerFeature } from "@/lib/ops-pulse/capacity";
import styles from "./service-network-map.module.css";

type Metric = { pincode: string; delivered: number; volumetric: number; small: number; activeIds: number; bike: number | null; van: number | null };
const WIDTH = 1100, HEIGHT = 620, TILE = 256;
function world(point: { lat: number; lng: number }, zoom: number) { const scale = TILE * 2 ** zoom; const lat = Math.max(Math.min(point.lat, 85.05112878), -85.05112878); const sin = Math.sin(lat * Math.PI / 180); return { x: (point.lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale }; }
function fit(points: Array<{ lat: number; lng: number }>) { for (let zoom = 17; zoom >= 5; zoom--) { const p = points.map(x => world(x, zoom)); const xs = p.map(x => x.x), ys = p.map(x => x.y); if (Math.max(...xs) - Math.min(...xs) < WIDTH * .72 && Math.max(...ys) - Math.min(...ys) < HEIGHT * .7) return zoom; } return 5; }
function compact(value: number) { return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }

export function ServiceNetworkMap({ station, features, metrics, radiusKm, sectors = [] }: {
  station: { code: string; lat: number; lng: number } | null;
  features: CapacityMapLayerFeature[];
  metrics: Metric[];
  radiusKm: number | null;
  sectors?: Array<{ name: string; color: string; pincodes: string[] }>;
}) {
  const [selected, setSelected] = useState("all");
  const [layer, setLayer] = useState<"volume" | "mix" | "capacity" | "sector">("volume");
  const [zoomOffset, setZoomOffset] = useState(0);
  const metricByPincode = useMemo(() => new Map(metrics.map(row => [row.pincode, row])), [metrics]);
  const sectorByPincode = useMemo(() => new Map(sectors.flatMap(sector => sector.pincodes.map(pincode => [pincode, sector] as const))), [sectors]);
  const pincodeFeatures = features.filter(feature => /^\d{6}$/.test(feature.name));
  const visible = selected === "all" ? features : features.filter(feature => feature.name === selected || !/^\d{6}$/.test(feature.name));
  const points = visible.flatMap(feature => feature.coordinates).concat(station ? [station] : []);
  const zoom = Math.max(5, Math.min(18, (points.length ? fit(points) : 8) + zoomOffset));
  const center = points.length ? { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length } : { lat: 20.5937, lng: 78.9629 };
  const centerWorld = world(center, zoom), left = centerWorld.x - WIDTH / 2, top = centerWorld.y - HEIGHT / 2, maxTile = 2 ** zoom;
  const tiles = useMemo(() => { const rows: Array<{ key: string; src: string; x: number; y: number }> = []; for (let x = Math.floor(left / TILE); x <= Math.floor((left + WIDTH) / TILE); x++) for (let y = Math.floor(top / TILE); y <= Math.floor((top + HEIGHT) / TILE); y++) if (y >= 0 && y < maxTile) rows.push({ key: `${zoom}-${x}-${y}`, src: `https://tile.openstreetmap.org/${zoom}/${((x % maxTile) + maxTile) % maxTile}/${y}.png`, x: x * TILE - left, y: y * TILE - top }); return rows; }, [left, maxTile, top, zoom]);
  const screen = (point: { lat: number; lng: number }) => { const p = world(point, zoom); return { x: p.x - left, y: p.y - top }; };
  const maxVolume = Math.max(1, ...metrics.map(row => row.delivered));
  const radiusPixels = station && radiusKm ? Math.max(12, radiusKm / (40075016.686 * Math.cos(station.lat * Math.PI / 180) / 2 ** zoom / 256) * 1000) : 0;
  const color = (pincode: string, metric?: Metric) => layer === "sector" ? sectorByPincode.get(pincode)?.color ?? "#64748b" : !metric ? "#64748b" : layer === "mix" ? (metric.volumetric / Math.max(1, metric.delivered) >= .25 ? "#dc2626" : "#16a34a") : layer === "capacity" ? ((metric.bike ?? 0) + (metric.van ?? 0) > metric.activeIds ? "#dc2626" : "#2563eb") : "#ea580c";

  return <div className={styles.shell}>
    <div className={styles.toolbar}><div><strong>Jurisdiction & demand map</strong><span>{pincodeFeatures.length} plotted pincodes · {metrics.length} with shipment evidence · {sectors.length} planned sectors</span></div><div className={styles.controls}><select value={layer} onChange={event => setLayer(event.target.value as typeof layer)}><option value="sector">Sector ownership</option><option value="volume">Volume</option><option value="mix">Shipment mix</option><option value="capacity">Capacity gap</option></select><select value={selected} onChange={event => setSelected(event.target.value)}><option value="all">All pincodes</option>{pincodeFeatures.map(feature => <option key={feature.name}>{feature.name}</option>)}</select><button type="button" onClick={() => setZoomOffset(v => Math.min(4, v + 1))}>+</button><button type="button" onClick={() => setZoomOffset(v => Math.max(-4, v - 1))}>−</button></div></div>
    <div className={styles.canvas}>{tiles.map(tile => <img alt="" draggable={false} key={tile.key} src={tile.src} style={{ left: tile.x, top: tile.y }}/>) }<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
      {station && radiusPixels ? (() => { const p = screen(station); return <circle cx={p.x} cy={p.y} fill="rgba(37,99,235,.05)" r={radiusPixels} stroke="#2563eb" strokeDasharray="8 7" strokeWidth="2"/>; })() : null}
      {visible.map((feature, index) => { const plotted = feature.coordinates.map(screen), first = plotted[0], metric = metricByPincode.get(feature.name), area = plotted.length > 2, fill = color(feature.name, metric), sector = sectorByPincode.get(feature.name); const label = layer === "sector" ? sector?.name ?? "Unassigned sector" : metric ? layer === "capacity" ? `${metric.bike ?? "?"}B · ${metric.van ?? "?"}V` : layer === "mix" ? `${Math.round(metric.volumetric / Math.max(1, metric.delivered) * 100)}% vol` : compact(metric.delivered) : "No data"; return <g key={`${feature.name}-${index}`}>{area ? <polygon fill={`${fill}26`} points={plotted.map(p => `${p.x},${p.y}`).join(" ")} stroke={fill} strokeWidth="3"/> : <circle cx={first.x} cy={first.y} fill={fill} r={metric ? 7 + 10 * Math.sqrt(metric.delivered / maxVolume) : 8} stroke="white" strokeWidth="3"/>}<text className={styles.name} x={first.x + 13} y={first.y - 7}>{feature.name}</text><text className={styles.value} x={first.x + 13} y={first.y + 10}>{label}</text></g>; })}
      {station ? (() => { const p = screen(station); return <g><circle cx={p.x} cy={p.y} fill="#111827" r="11" stroke="white" strokeWidth="4"/><text className={styles.station} x={p.x + 16} y={p.y + 5}>{station.code}</text></g>; })() : null}
    </svg>{!features.length ? <div className={styles.empty}>No approved station boundary is available. Add or sync its reference layer in Network Planning Master.</div> : null}<small>Approved service boundary · basemap © OpenStreetMap contributors</small></div>
  </div>;
}
