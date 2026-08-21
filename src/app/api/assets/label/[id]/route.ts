import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function escape(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthorization();
  if (!auth?.companyId || !hasPermission(auth, "assets", "access") || !supabaseAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await supabaseAdmin.from("assets").select("id,asset_code,barcode_value,manufacturer,model,serial_number,location_id,asset_types(name),stations(station_code)").eq("company_id", auth.companyId).eq("id", params.id).maybeSingle();
  if (!result.data || (!auth.hasAllLocationAccess && result.data.location_id && !auth.locationScopeIds.includes(result.data.location_id))) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  const asset = result.data as Record<string, any>;
  const qr = await QRCode.toDataURL(asset.barcode_value, { errorCorrectionLevel: "H", margin: 1, width: 320 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(asset.asset_code)} label</title><style>@page{size:62mm 38mm;margin:2mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#111}.label{width:58mm;height:34mm;border:1px solid #111;border-radius:2mm;padding:2mm;display:grid;grid-template-columns:24mm 1fr;gap:2mm;align-items:center}.label img{width:23mm;height:23mm}.brand{font-size:9px;color:#e64a19;font-weight:800;letter-spacing:.08em}.code{font-size:15px;font-weight:900;margin:2px 0;word-break:break-all}.meta{font-size:8px;line-height:1.35}.hint{font-size:6.5px;color:#555;margin-top:2px}@media screen{body{padding:20px}.label{box-shadow:0 8px 30px #ddd}.print{margin-top:18px;padding:9px 16px;background:#e84b20;color:white;border:0;border-radius:7px;font-weight:700}}@media print{.print{display:none}}</style></head><body><div class="label"><img src="${qr}" alt="Asset QR code"><div><div class="brand">DROPX ASSET</div><div class="code">${escape(asset.asset_code)}</div><div class="meta">${escape(asset.asset_types?.name)} · ${escape([asset.manufacturer, asset.model].filter(Boolean).join(" "))}<br>Serial: ${escape(asset.serial_number || "—")}<br>Location: ${escape(asset.stations?.station_code || "CENTRAL")}</div><div class="hint">Scan for audit, issue, return or history</div></div></div><button class="print" onclick="window.print()">Print label</button></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" } });
}
