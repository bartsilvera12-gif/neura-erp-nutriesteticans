import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { membreteA4 } from "@/lib/documentos/membrete";

/**
 * GET /api/notas-remision/[id]/imprimir?auto=1
 *
 * HTML imprimible A4 de la Nota de Remisión (comprobante interno, no fiscal).
 * Sirve tanto al flujo talonario (nueva) como al viejo con depósitos: usa las
 * mismas columnas del detalle y arma el layout con `membreteA4`.
 *
 * `auto=1` dispara `window.print()` al cargar para que el operador solo tenga
 * que confirmar en el diálogo del navegador.
 */

const COLS =
  "id, empresa_id, numero, fecha, emisor, ubicacion_origen_id, ubicacion_destino_id, motivo, estado, motivo_rechazo, transportista, ruc_transportista, conductor, ci_conductor, chapa, fecha_inicio_traslado, fecha_fin_traslado, observaciones, destino_tipo, cliente_id, destino_nombre, destino_direccion, destino_ciudad, modo, motivo_traslado, direccion_origen, direccion_destino";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtFecha(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return String(iso);
  }
}
function fmtFechaHora(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${fmtFecha(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return String(iso);
  }
}
function fmt(n: number): string {
  return (Number(n) || 0).toLocaleString("es-PY");
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const auto = url.searchParams.get("auto") === "1";
  const origin = `${url.protocol}//${url.host}`;

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const { supabase, auth } = ctx;

  const nrQ = await supabase
    .from("notas_remision")
    .select(COLS)
    .eq("empresa_id", auth.empresa_id)
    .eq("id", id)
    .maybeSingle();
  if (nrQ.error) return new NextResponse(`Error: ${nrQ.error.message}`, { status: 500 });
  if (!nrQ.data) return new NextResponse("NR no encontrada", { status: 404 });
  const nr = nrQ.data as Record<string, unknown>;

  const itemsQ = await supabase
    .from("notas_remision_items")
    .select("producto_id, cantidad, descripcion, unidad_medida")
    .eq("nota_remision_id", id);
  if (itemsQ.error) return new NextResponse(`Error items: ${itemsQ.error.message}`, { status: 500 });
  const itemsRaw = (itemsQ.data ?? []) as Array<{
    producto_id: string | null;
    cantidad: number;
    descripcion: string | null;
    unidad_medida: string | null;
  }>;

  // Nombres de productos (solo NR viejas con producto_id).
  const prodIds = Array.from(new Set(itemsRaw.map((i) => i.producto_id).filter((x): x is string => !!x)));
  const prodMap = new Map<string, { nombre: string; sku: string }>();
  if (prodIds.length > 0) {
    const pQ = await supabase
      .from("productos")
      .select("id, nombre, sku")
      .eq("empresa_id", auth.empresa_id)
      .in("id", prodIds);
    if (!pQ.error) {
      for (const p of (pQ.data ?? []) as Array<{ id: string; nombre: string; sku: string | null }>) {
        prodMap.set(p.id, { nombre: p.nombre, sku: p.sku ?? "" });
      }
    }
  }

  // Nombres de depósitos (solo NR viejas).
  let origenNombreDep: string | null = null;
  let destinoNombreDep: string | null = null;
  const ubIds = [nr.ubicacion_origen_id, nr.ubicacion_destino_id].filter(
    (x): x is string => typeof x === "string" && !!x
  );
  if (ubIds.length > 0) {
    const ubQ = await supabase
      .from("inventario_ubicaciones")
      .select("id, nombre")
      .eq("empresa_id", auth.empresa_id)
      .in("id", ubIds);
    if (!ubQ.error) {
      const map = new Map((ubQ.data ?? []).map((u: { id: string; nombre: string }) => [u.id, u.nombre]));
      origenNombreDep = map.get(String(nr.ubicacion_origen_id ?? "")) ?? null;
      destinoNombreDep = map.get(String(nr.ubicacion_destino_id ?? "")) ?? null;
    }
  }

  const esTalonario = String(nr.modo ?? "") === "talonario";
  const numero = String(nr.numero ?? "");
  const totalCant = itemsRaw.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);

  const origenNombre = esTalonario ? "HERACLIO GOMES" : origenNombreDep ?? "—";
  const origenDireccion = esTalonario ? String(nr.direccion_origen ?? "") : "";
  const destinoNombre = esTalonario || nr.destino_tipo === "cliente"
    ? String(nr.destino_nombre ?? "") || "—"
    : destinoNombreDep ?? "—";
  const destinoDireccion = esTalonario
    ? String(nr.direccion_destino ?? nr.destino_direccion ?? "")
    : String(nr.destino_direccion ?? "");
  const motivoTexto = esTalonario ? String(nr.motivo_traslado ?? "") : String(nr.motivo ?? "");

  const filasHtml = itemsRaw.length === 0
    ? `<tr><td colspan="4" style="padding:24px;text-align:center;color:#94a3b8;font-style:italic;">Sin ítems cargados.</td></tr>`
    : itemsRaw
        .map((it, idx) => {
          const p = it.producto_id ? prodMap.get(it.producto_id) : undefined;
          const descripcion = p?.nombre ?? it.descripcion ?? "—";
          const sku = p?.sku ?? "—";
          const unidad = it.unidad_medida ?? "—";
          const bg = idx % 2 === 1 ? "background:#f8fafc;" : "";
          return `<tr style="${bg}">
            <td style="padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#475569;">${esc(sku)}</td>
            <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;">${esc(fmt(Number(it.cantidad)))}</td>
            <td style="padding:6px 8px;color:#1f2937;">${esc(descripcion)}</td>
            <td style="padding:6px 8px;color:#64748b;">${esc(unidad)}</td>
          </tr>`;
        })
        .join("");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Nota de Remisión ${esc(numero)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { size: A4; margin: 12mm; }
  html, body { background:#f1f5f9; margin:0; padding:0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color:#1f2937; font-feature-settings:"tnum"; }
  .toolbar { position:sticky; top:0; z-index:10; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 16px; background:#ffffffcc; backdrop-filter:blur(6px); border-bottom:1px solid #e2e8f0; }
  .toolbar a, .toolbar button { font-size:13px; padding:6px 12px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; color:#334155; text-decoration:none; cursor:pointer; }
  .toolbar .primary { background:#0f172a; color:#fff; border-color:#0f172a; }
  .page { max-width: 210mm; margin: 16px auto; background:#fff; padding:16mm; box-shadow:0 4px 24px rgba(15,23,42,0.08); }
  @media print {
    body { background:#fff; }
    .toolbar { display:none !important; }
    .page { box-shadow:none; margin:0; padding:0; max-width:none; }
  }
  h1 { font-size:15px; margin:0; text-transform:uppercase; letter-spacing:0.05em; }
  table.items { width:100%; border-collapse:collapse; font-size:12px; }
  table.items thead th { border-top:2px solid #0f172a; border-bottom:2px solid #0f172a; padding:8px; text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#334155; }
  table.items tfoot td { border-top:2px solid #0f172a; padding:8px; font-weight:700; }
  .campo { display:block; font-size:9px; text-transform:uppercase; letter-spacing:0.15em; color:#64748b; }
  .valor { display:block; font-size:12px; font-weight:600; color:#1f2937; margin-top:2px; }
  .grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px 24px; }
  .grid2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
  .box { border:1px solid #cbd5e1; border-radius:6px; padding:10px 14px; }
  .doc-title { border:1px solid #94a3b8; border-radius:6px; padding:8px 14px; text-align:right; }
  .doc-title .numero { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:17px; font-weight:700; margin-top:4px; }
  .divider { height:1px; background:#e2e8f0; margin:18px 0; }
  .obs { border:1px solid #cbd5e1; border-radius:6px; padding:10px 14px; white-space:pre-wrap; font-size:12px; color:#1f2937; }
  .firmas { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:32px; margin-top:64px; font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#475569; }
  .firmas > div { border-top:1px solid #0f172a; padding-top:4px; text-align:center; }
  .footer-nota { margin-top:24px; text-align:center; font-size:9px; color:#94a3b8; }
</style>
</head>
<body>
  <div class="toolbar">
    <a href="/notas-remision">← Volver al historial</a>
    <button class="primary" onclick="window.print()">Imprimir</button>
  </div>

  <div class="page">
    ${membreteA4(origin)}

    <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
      <div>
        <h1>Nota de Remisión</h1>
        <div style="font-size:10px;color:#64748b;margin-top:4px;">Documento no fiscal · constancia interna de traslado</div>
      </div>
      <div class="doc-title">
        <div class="campo" style="text-align:right;">Número</div>
        <div class="numero">${esc(numero)}</div>
        <div class="campo" style="text-align:right;margin-top:6px;">Estado: <strong style="color:#334155;">${esc(String(nr.estado ?? "").toUpperCase())}</strong></div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="grid3">
      <div><span class="campo">Fecha de emisión</span><span class="valor">${esc(fmtFechaHora(nr.fecha as string | null))}</span></div>
      <div><span class="campo">Inicio del traslado</span><span class="valor">${esc(fmtFecha(nr.fecha_inicio_traslado as string | null))}</span></div>
      <div><span class="campo">Fin del traslado</span><span class="valor">${esc(fmtFecha(nr.fecha_fin_traslado as string | null))}</span></div>
      <div style="grid-column:1/4;"><span class="campo">Motivo del traslado</span><span class="valor">${esc(motivoTexto || "—")}</span></div>
    </div>

    <div class="grid2" style="margin-top:16px;">
      <div class="box">
        <span class="campo">Punto de partida</span>
        <span class="valor">${esc(origenNombre)}</span>
        <div style="font-size:10px;color:#64748b;margin-top:4px;">Dirección: ${esc(origenDireccion || "—")}</div>
      </div>
      <div class="box">
        <span class="campo">Punto de llegada</span>
        <span class="valor">${esc(destinoNombre)}</span>
        <div style="font-size:10px;color:#64748b;margin-top:4px;">Dirección: ${esc(destinoDireccion || "—")}</div>
      </div>
    </div>

    <div style="margin-top:20px;">
      <table class="items">
        <thead>
          <tr>
            <th style="width:90px;">Código</th>
            <th style="width:90px;text-align:right;">Cantidad</th>
            <th>Descripción</th>
            <th style="width:120px;">Unidad</th>
          </tr>
        </thead>
        <tbody>${filasHtml}</tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums;">${esc(fmt(totalCant))}</td>
            <td colspan="2" style="font-weight:400;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;">unidades / renglones</td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${nr.observaciones ? `<div style="margin-top:18px;"><span class="campo" style="margin-bottom:6px;">Observaciones</span><div class="obs">${esc(nr.observaciones)}</div></div>` : ""}

    <div class="firmas">
      <div>Firma</div>
      <div>Aclaración</div>
      <div>Fecha</div>
    </div>

    <div class="footer-nota">Documento no fiscal · válido únicamente como constancia interna de traslado de mercadería.</div>
  </div>

  ${auto ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>` : ""}
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
