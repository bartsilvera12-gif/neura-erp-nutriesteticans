/**
 * Documento imprimible de la nota de remisión de una venta.
 *
 * SOLO presentación: no consulta la base ni toca datos de negocio.
 */
import { EMPRESA_DOC } from "@/lib/documentos/membrete";
import { CLIENTE_COLORES } from "@/lib/branding/cliente";

export interface RemisionHtmlLinea {
  producto_nombre: string;
  sku: string | null;
  cantidad_vendida: number;
  en_esta_remision: number;
  pendiente: number;
  observacion: string | null;
}

export interface RemisionHtmlData {
  remision: {
    numero: string;
    estado: string;
    fecha: string;
    numero_control?: string | null;
    numero_orden_compra: string | null;
    factura_numero?: string | null;
    factura_cdc?: string | null;
    factura_estado_sifen?: string | null;
    cliente_nombre: string | null;
    observacion: string | null;
    usuario_creador_nombre: string | null;
    anulada_motivo: string | null;
  };
  lineas: RemisionHtmlLinea[];
}

const ESTADO_LABEL: Record<string, string> = { confirmada: "Confirmada", anulada: "Anulada", borrador: "Borrador" };

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function fmt(n: number): string {
  return Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
}

function fechaCorta(v: string): string {
  try {
    return new Date(String(v)).toLocaleDateString("es-PY");
  } catch {
    return esc(v);
  }
}

export function renderRemisionVentaHTML(data: RemisionHtmlData, logoSrc: string | null = null): string {
  const r = data.remision;
  const entregadas = data.lineas.filter((l) => l.en_esta_remision > 0);
  const pendientes = data.lineas.filter((l) => l.pendiente > 0);
  const totalEntregado = entregadas.reduce((a, l) => a + l.en_esta_remision, 0);

  const filas = entregadas
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.producto_nombre)}${l.sku ? `<span class="sku">${esc(l.sku)}</span>` : ""}</td>
        <td class="r strong">${fmt(l.en_esta_remision)}</td>
        <td class="r muted">${fmt(l.cantidad_vendida)}</td>
        <td>${esc(l.observacion ?? "")}</td>
      </tr>`,
    )
    .join("");

  const filasPend = pendientes
    .map((l) => `<tr><td>${esc(l.producto_nombre)}</td><td class="r strong">${fmt(l.pendiente)}</td></tr>`)
    .join("");

  const logo = logoSrc
    ? `<img class="logo" src="${logoSrc}" alt="${esc(EMPRESA_DOC.nombre)}" />`
    : "";

  const emisorLineas = [
    ...(EMPRESA_DOC.direccion ?? []),
    ...(EMPRESA_DOC.telefono ? [`Tel.: ${EMPRESA_DOC.telefono}`] : []),
  ]
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Nota de remisión ${esc(r.numero)}</title>
<style>
  :root {
    --marca: ${CLIENTE_COLORES.primario};
    --marca-fill: ${CLIENTE_COLORES.primarioFill};
    --marca-int: ${CLIENTE_COLORES.interior};
    --gris: ${CLIENTE_COLORES.secundario};
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, sans-serif; color: #111827; margin: 0; padding: 26px 30px; font-size: 12px; }

  .head { display: flex; justify-content: space-between; align-items: stretch; border: 1.5px solid var(--marca); border-radius: 6px; overflow: hidden; }
  .head .left { display: flex; gap: 14px; padding: 12px 14px; flex: 1; align-items: flex-start; }
  .logo { max-width: 120px; max-height: 68px; object-fit: contain; }
  .emisor .nombre { font-size: 13px; font-weight: 700; }
  .emisor div { line-height: 1.45; color: #374151; }
  .head .right { width: 232px; border-left: 1.5px solid var(--marca); padding: 12px 14px; background: var(--marca-fill); }
  .doc-tipo { font-size: 13px; font-weight: 800; letter-spacing: .06em; color: var(--marca); }
  .doc-num { font-family: ui-monospace, Menlo, monospace; font-size: 16px; font-weight: 700; margin-top: 2px; }
  .badge { display: inline-block; margin-top: 6px; border-radius: 999px; padding: 2px 10px; font-size: 10px; font-weight: 700; background: #fff; border: 1px solid var(--marca); color: var(--marca); }
  .badge.anulada { border-color: #b91c1c; color: #b91c1c; background: #fef2f2; }

  .sec { margin: 16px 0 6px; background: var(--marca-fill); border-left: 4px solid var(--marca-int); padding: 5px 9px; font-size: 10px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--marca-int); }
  .caja { border: 1px solid #d1d5db; border-radius: 5px; padding: 10px 12px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 26px; }
  .kv { display: flex; gap: 6px; line-height: 1.6; }
  .kv b { color: #4b5563; font-weight: 600; min-width: 108px; }

  table { width: 100%; border-collapse: collapse; }
  thead th { background: var(--marca-int); color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 7px 8px; text-align: left; }
  tbody td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .c { text-align: center; } .r { text-align: right; }
  .strong { font-weight: 700; }
  .muted { color: #6b7280; }
  .sku { display: block; color: var(--gris); font-size: 10px; }
  .total-linea { margin-top: 8px; text-align: right; font-size: 12px; }
  .total-linea b { color: var(--marca-int); font-size: 14px; }

  .pend { border: 1px solid #fbbf24; background: #fffbeb; border-radius: 5px; padding: 10px 12px; margin-top: 6px; }
  .pend table thead th { background: #b45309; }
  .obs { margin-top: 10px; color: #4b5563; }
  .cdc { margin-top: 6px; border: 1px solid #d1d5db; border-radius: 5px; padding: 8px 12px; display: flex; gap: 10px; align-items: baseline; }
  .cdc b { color: #4b5563; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
  .cdc span { font-family: ui-monospace, Menlo, monospace; font-size: 11px; letter-spacing: .02em; word-break: break-all; }

  .firmas { display: flex; gap: 52px; margin-top: 54px; }
  .firma { flex: 1; text-align: center; }
  .firma .linea { border-top: 1px solid #374151; margin-top: 42px; padding-top: 5px; font-size: 11px; color: #4b5563; }
  .pie { margin-top: 22px; border-top: 1px solid #e5e7eb; padding-top: 8px; font-size: 10px; color: var(--gris); text-align: center; }
  .actions { text-align: center; margin-top: 22px; }
  .actions button { padding: 8px 18px; font-size: 13px; cursor: pointer; border: 1px solid var(--marca); background: var(--marca); color: #fff; border-radius: 6px; }
  @media print { body { padding: 0; } .actions { display: none; } }
</style></head><body>

  <div class="head">
    <div class="left">
      ${logo}
      <div class="emisor">
        <div class="nombre">${esc(EMPRESA_DOC.nombre)}</div>
        ${emisorLineas}
      </div>
    </div>
    <div class="right">
      <div class="doc-tipo">NOTA DE REMISIÓN</div>
      <div class="doc-num">${esc(r.numero)}</div>
      <div class="muted" style="font-size:11px;margin-top:3px">${fechaCorta(r.fecha)}</div>
      <span class="badge ${r.estado === "anulada" ? "anulada" : ""}">${esc(ESTADO_LABEL[r.estado] ?? r.estado)}</span>
    </div>
  </div>

  <div class="sec">Datos de la entrega y del cliente</div>
  <div class="caja grid2">
    <div class="kv"><b>Destinatario</b><span>${esc(r.cliente_nombre ?? "—")}</span></div>
    ${r.numero_control ? `<div class="kv"><b>Venta</b><span>${esc(r.numero_control)}</span></div>` : ""}
    ${r.factura_numero ? `<div class="kv"><b>Factura</b><span>${esc(r.factura_numero)}</span></div>` : ""}
    ${r.numero_orden_compra ? `<div class="kv"><b>Orden de compra</b><span>${esc(r.numero_orden_compra)}</span></div>` : ""}
    <div class="kv"><b>Entregado por</b><span>${esc(r.usuario_creador_nombre ?? "—")}</span></div>
  </div>

  ${r.factura_cdc ? `<div class="cdc"><b>CDC de la factura electrónica</b><span>${esc(r.factura_cdc)}</span></div>` : ""}

  <div class="sec">Mercadería entregada</div>
  <table>
    <thead>
      <tr>
        <th class="c" style="width:34px">#</th>
        <th>Descripción</th>
        <th class="r" style="width:88px">Entregado</th>
        <th class="r" style="width:78px">Vendido</th>
        <th style="width:170px">Observación</th>
      </tr>
    </thead>
    <tbody>${filas || `<tr><td colspan="5" class="c muted">Sin ítems entregados</td></tr>`}</tbody>
  </table>
  <div class="total-linea">Total entregado: <b>${fmt(totalEntregado)}</b></div>

  ${
    filasPend
      ? `<div class="sec">Pendiente de entrega</div>
         <div class="pend">
           <table>
             <thead><tr><th>Descripción</th><th class="r" style="width:110px">Cantidad</th></tr></thead>
             <tbody>${filasPend}</tbody>
           </table>
         </div>`
      : ""
  }

  ${r.observacion ? `<div class="obs"><b>Observaciones:</b> ${esc(r.observacion)}</div>` : ""}
  ${r.estado === "anulada" && r.anulada_motivo ? `<div class="obs"><b>Motivo de anulación:</b> ${esc(r.anulada_motivo)}</div>` : ""}

  <div class="firmas">
    <div class="firma"><div class="linea">Entregado por</div></div>
    <div class="firma"><div class="linea">Recibido conforme</div></div>
  </div>

  <div class="pie">
    Documento interno de entrega — no sustituye a la nota de remisión electrónica ni al comprobante fiscal.
  </div>

  <div class="actions"><button type="button" onclick="window.print()">Imprimir</button></div>
  <script>if (new URL(location.href).searchParams.get('auto')) setTimeout(function(){window.print();}, 300);</script>
</body></html>`;
}
