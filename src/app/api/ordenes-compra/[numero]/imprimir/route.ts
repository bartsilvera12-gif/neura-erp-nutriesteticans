import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getOrdenCompra } from "@/lib/ordenes-compra/server/ordenes-compra-pg";
import { membreteA4 } from "@/lib/documentos/membrete";

/**
 * GET /api/ordenes-compra/[numero]/imprimir?auto=1
 *
 * HTML imprimible (A4) de la orden de compra. Documento interno NO fiscal:
 * es el pedido al proveedor, no reemplaza a su factura.
 * Con `auto=1` dispara el diálogo de impresión al abrir.
 */

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gs(n: unknown): string {
  const v = Number(n) || 0;
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}

function fecha(iso: unknown): string {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  recibida_parcial: "Recibida parcial",
  recibida_total: "Recibida total",
  cancelada: "Cancelada",
};

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ numero: string }> }) {
  const { numero } = await ctxParams.params;
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });

  const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
  const filas = await getOrdenCompra(schema, ctx.auth.empresa_id, numero);
  if (filas.length === 0) return new NextResponse("Orden de compra no encontrada", { status: 404 });

  const cab = filas[0] as unknown as Record<string, unknown>;
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const auto = url.searchParams.get("auto") === "1";

  const subtotal = filas.reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
  const iva = filas.reduce((s, l) => s + (Number(l.monto_iva) || 0), 0);
  const total = filas.reduce((s, l) => s + (Number(l.total) || 0), 0);

  const items = filas
    .map((l) => {
      const row = l as unknown as Record<string, unknown>;
      return `
      <tr>
        <td>${esc(row.producto_nombre)}</td>
        <td class="num">${esc(row.cantidad)} ${esc(row.unidad_medida ?? "")}</td>
        <td class="num">${gs(row.costo_unitario)}</td>
        <td class="num">${esc(row.iva_tipo ?? "")}</td>
        <td class="num">${gs(row.subtotal)}</td>
        <td class="num strong">${gs(row.total)}</td>
      </tr>`;
    })
    .join("");

  const tipoPago =
    String(cab.tipo_pago ?? "") === "credito"
      ? `Crédito${cab.plazo_dias ? ` · ${esc(cab.plazo_dias)} días` : ""}`
      : "Contado";

  const datosFactura =
    cab.numero_factura || cab.nro_timbrado
      ? `<div class="box">
           <div class="box-t">Datos de la factura del proveedor</div>
           <div><strong>N° factura:</strong> ${esc(cab.numero_factura ?? "—")}</div>
           <div><strong>Timbrado:</strong> ${esc(cab.nro_timbrado ?? "—")}</div>
         </div>`
      : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Orden de compra ${esc(numero)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;margin:0;padding:24px;font-size:12px}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:20px;margin:0 0 2px}
  .muted{color:#6b7280}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}
  .chip{display:inline-block;border:1px solid #4FAEB2;color:#2F6E71;background:#4FAEB215;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700}
  .grid{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .box{flex:1;min-width:220px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;line-height:1.7}
  .box-t{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;font-weight:700;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{background:#4FAEB210;border-bottom:2px solid #4FAEB2;text-align:left;padding:8px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#374151}
  td{border-bottom:1px solid #f1f5f9;padding:8px}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .strong{font-weight:700}
  tfoot td{border:0;padding:6px 8px}
  .tot{font-size:15px;font-weight:800}
  .firmas{display:flex;gap:40px;margin-top:48px}
  .firma{flex:1;border-top:1px solid #9ca3af;padding-top:6px;text-align:center;color:#6b7280;font-size:11px}
  .pie{margin-top:22px;font-size:10px;color:#9ca3af;text-align:center}
  @media print{body{padding:0}.noprint{display:none}}
</style></head>
<body><div class="wrap">
  ${membreteA4(origin)}

  <div class="head">
    <div>
      <h1>Orden de compra</h1>
      <div class="muted">Documento interno · no fiscal</div>
    </div>
    <div style="text-align:right">
      <div style="font-family:ui-monospace,monospace;font-size:18px;font-weight:800">${esc(numero)}</div>
      <div class="muted">${fecha(cab.created_at)}</div>
      <div style="margin-top:4px"><span class="chip">${esc(ESTADO_LABEL[String(cab.estado)] ?? cab.estado)}</span></div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <div class="box-t">Proveedor</div>
      <div class="strong">${esc(cab.proveedor_nombre)}</div>
    </div>
    <div class="box">
      <div class="box-t">Condiciones</div>
      <div><strong>Pago:</strong> ${tipoPago}</div>
      <div><strong>Moneda:</strong> ${esc(cab.moneda ?? "GS")}</div>
    </div>
    ${datosFactura}
  </div>

  <table>
    <thead><tr>
      <th>Producto</th><th class="num">Cantidad</th><th class="num">Costo unit.</th>
      <th class="num">IVA</th><th class="num">Subtotal</th><th class="num">Total</th>
    </tr></thead>
    <tbody>${items}</tbody>
    <tfoot>
      <tr><td colspan="4"></td><td class="num muted">Subtotal</td><td class="num">${gs(subtotal)}</td></tr>
      <tr><td colspan="4"></td><td class="num muted">IVA</td><td class="num">${gs(iva)}</td></tr>
      <tr><td colspan="4"></td><td class="num strong">TOTAL</td><td class="num tot">${gs(total)}</td></tr>
    </tfoot>
  </table>

  ${cab.observacion ? `<div class="box" style="margin-top:14px"><div class="box-t">Observaciones</div>${esc(cab.observacion)}</div>` : ""}

  <div class="firmas">
    <div class="firma">Solicitado por</div>
    <div class="firma">Autorizado por</div>
    <div class="firma">Recibido por (proveedor)</div>
  </div>

  <div class="pie">Orden de compra generada con Heraclio Gomes ERP · No válido como comprobante fiscal</div>

  <div class="noprint" style="margin-top:20px;text-align:center">
    <button onclick="window.print()" style="background:#4FAEB2;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer">Imprimir</button>
  </div>
</div>
${auto ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})</script>" : ""}
</body></html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
