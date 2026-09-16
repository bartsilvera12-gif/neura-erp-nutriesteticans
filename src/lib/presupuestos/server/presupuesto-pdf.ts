/**
 * Genera el PDF de un presupuesto (pdf-lib, A4) con un diseño formal, pensado
 * para que el cliente lo presente ante una empresa. Membrete con datos del
 * emisor, cajas de cliente/detalle, tabla de ítems con ajuste de línea, totales
 * con acento, condiciones comerciales, observaciones y área de firmas.
 *
 * Documento NO fiscal. No toca SIFEN ni stock.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

// Paleta sobria (formal): base gris/negro + un único acento turquesa.
const ACENTO = rgb(63 / 255, 142 / 255, 145 / 255);     // turquesa oscuro
const ACENTO_SUAVE = rgb(0.898, 0.957, 0.957);          // turquesa muy claro
const TINTA = rgb(0.12, 0.15, 0.19);                    // casi negro (slate 900)
const SLATE = rgb(0.22, 0.27, 0.34);                    // slate 700
const GRIS = rgb(0.42, 0.45, 0.5);
const GRIS_CLARO = rgb(0.85, 0.87, 0.89);
const GRIS_LINEA = rgb(0.91, 0.93, 0.94);

const A4: [number, number] = [595.28, 841.89];
const MX = 48;
const TOP = 800;
const BOTTOM = 92; // deja lugar para firmas + pie

export interface PresupuestoPdfData {
  numero_control: string;
  fecha: string;
  fecha_vencimiento: string | null;
  validez_dias: number | null;
  condicion: "contado" | "credito";
  moneda: string;
  forma_pago: string | null;
  plazo_entrega: string | null;
  observaciones: string | null;
  cliente: { nombre: string; ruc: string | null; telefono: string | null; direccion: string | null };
  items: Array<{
    producto_nombre: string;
    sku: string | null;
    cantidad: number;
    unidad_medida: string | null;
    precio_unitario: number;
    iva_tipo: string;
    descuento: number;
    total: number;
  }>;
  subtotal: number;
  monto_iva: number;
  descuento_total: number;
  total: number;
}

export interface PresupuestoEmisor {
  nombre: string;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  actividad: string | null;
}

function money(v: number, moneda: string): string {
  const n = Number(v) || 0;
  const sim = moneda === "USD" ? "USD " : "Gs. ";
  return sim + n.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}
function fecha(iso: string | null): string {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
const IVA_LABEL: Record<string, string> = { EXENTA: "Exenta", "5%": "5%", "10%": "10%" };

/** Recorta el texto a `max` puntos con elipsis. */
function fit(t: string, f: PDFFont, size: number, max: number): string {
  let s = String(t ?? "");
  if (f.widthOfTextAtSize(s, size) <= max) return s;
  while (s.length > 1 && f.widthOfTextAtSize(s + "…", size) > max) s = s.slice(0, -1);
  return s + "…";
}
/** Parte un texto en líneas que entran en `max` puntos (word-wrap). */
function wrap(t: string, f: PDFFont, size: number, max: number): string[] {
  const words = String(t ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(tryLine, size) <= max) {
      cur = tryLine;
    } else {
      if (cur) lines.push(cur);
      // palabra sola más larga que la columna → recortar
      cur = f.widthOfTextAtSize(w, size) > max ? fit(w, f, size, max) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Logo de la instancia. Devuelve los bytes y el formato para embeberlo. */
function logoBytes(): { bytes: Uint8Array; tipo: "png" | "jpg" } | null {
  const candidatos: { archivo: string; tipo: "png" | "jpg" }[] = [
    { archivo: "instemaq-logo.jpeg", tipo: "jpg" },
    { archivo: "instemaq-logo.png", tipo: "png" },
  ];
  for (const c of candidatos) {
    try {
      const p = path.join(process.cwd(), "public", "brand", c.archivo);
      if (fs.existsSync(p)) return { bytes: new Uint8Array(fs.readFileSync(p)), tipo: c.tipo };
    } catch { /* probamos el siguiente */ }
  }
  return null;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  reg: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  emisor: PresupuestoEmisor;
}

function membrete(c: Ctx) {
  const { page, bold, reg, emisor } = c;
  const rightX = A4[0] - MX;
  let ly = c.y;

  if (c.logo) {
    const w = 104;
    const h = (c.logo.height / c.logo.width) * w;
    const hh = Math.min(h, 48);
    page.drawImage(c.logo, { x: MX, y: c.y - hh + 4, width: (hh / h) * w, height: hh });
  }

  // Datos del emisor a la derecha (alineados a la derecha).
  const drawR = (t: string, size: number, f: PDFFont, color = GRIS) => {
    const tw = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: rightX - tw, y: ly, size, font: f, color });
  };
  drawR(fit(emisor.nombre, bold, 13, 320), 13, bold, TINTA);
  ly -= 15;
  if (emisor.actividad) { drawR(fit(emisor.actividad, reg, 7.5, 320), 7.5, reg); ly -= 11; }
  if (emisor.ruc) { drawR(`RUC: ${emisor.ruc}`, 8, reg); ly -= 11; }
  if (emisor.direccion) { drawR(fit(emisor.direccion, reg, 8, 320), 8, reg); ly -= 11; }
  if (emisor.telefono) { drawR(`Tel: ${emisor.telefono}`, 8, reg); ly -= 11; }

  c.y -= 58;
  // Regla fina bajo el membrete.
  page.drawRectangle({ x: MX, y: c.y, width: A4[0] - MX * 2, height: 1.4, color: TINTA });
  c.y -= 26;
}

function pie(doc: PDFDocument, reg: PDFFont) {
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    p.drawRectangle({ x: MX, y: 60, width: A4[0] - MX * 2, height: 0.6, color: GRIS_LINEA });
    const nota = "Presupuesto sujeto a disponibilidad de stock y a la validez indicada · Documento no fiscal, no válido como factura.";
    const nw = reg.widthOfTextAtSize(nota, 7);
    p.drawText(nota, { x: (A4[0] - nw) / 2, y: 48, size: 7, font: reg, color: GRIS });
    const pg = `Página ${i + 1} de ${paginas.length}`;
    const pw = reg.widthOfTextAtSize(pg, 7);
    p.drawText(pg, { x: A4[0] - MX - pw, y: 48, size: 7, font: reg, color: GRIS });
  });
}

export async function buildPresupuestoPdf(
  data: PresupuestoPdfData,
  emisor: PresupuestoEmisor
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lb = logoBytes();
  const logo = lb ? (lb.tipo === "jpg" ? await doc.embedJpg(lb.bytes) : await doc.embedPng(lb.bytes)) : null;
  const moneda = data.moneda === "USD" ? "USD" : "PYG";

  const c: Ctx = { doc, page: doc.addPage(A4), y: TOP, reg, bold, logo, emisor };
  const W = A4[0] - MX * 2;
  membrete(c);

  // ── Título + meta ──────────────────────────────────────────────────────────
  c.page.drawText("PRESUPUESTO", { x: MX, y: c.y - 6, size: 24, font: bold, color: TINTA });
  c.page.drawText("COTIZACIÓN COMERCIAL", { x: MX + 2, y: c.y - 20, size: 8, font: reg, color: GRIS });

  // Caja meta a la derecha.
  const metaW = 210;
  const metaX = A4[0] - MX - metaW;
  const metaRows: Array<[string, string]> = [
    ["N° de presupuesto", data.numero_control],
    ["Fecha de emisión", fecha(data.fecha)],
    ["Válido hasta", data.fecha_vencimiento ? fecha(data.fecha_vencimiento) : (data.validez_dias ? `${data.validez_dias} día(s)` : "—")],
    ["Condición", data.condicion === "credito" ? "Crédito" : "Contado"],
  ];
  const metaH = 14 + metaRows.length * 15 + 6;
  c.page.drawRectangle({ x: metaX, y: c.y - 6 - metaH + 20, width: metaW, height: metaH, color: ACENTO_SUAVE });
  c.page.drawRectangle({ x: metaX, y: c.y - 6 - metaH + 20, width: 3, height: metaH, color: ACENTO });
  let my = c.y + 6;
  for (const [k, v] of metaRows) {
    c.page.drawText(k.toUpperCase(), { x: metaX + 12, y: my, size: 6.5, font: bold, color: GRIS });
    const vw = bold.widthOfTextAtSize(v, 9);
    c.page.drawText(fit(v, bold, 9, metaW - 24 - 4), { x: metaX + metaW - 12 - Math.min(vw, metaW - 24 - 4), y: my - 1, size: 9, font: bold, color: TINTA });
    my -= 15;
  }
  c.y -= Math.max(34, metaH - 6) + 22;

  // ── Cliente + detalles ──────────────────────────────────────────────────────
  const colW = (W - 16) / 2;
  const boxTop = c.y;

  // Columna izquierda: PREPARADO PARA
  c.page.drawText("PREPARADO PARA", { x: MX, y: boxTop, size: 7.5, font: bold, color: ACENTO });
  c.page.drawRectangle({ x: MX, y: boxTop - 5, width: colW, height: 0.8, color: GRIS_CLARO });
  let ly = boxTop - 20;
  c.page.drawText(fit(data.cliente.nombre, bold, 11, colW), { x: MX, y: ly, size: 11, font: bold, color: TINTA });
  ly -= 14;
  const cli = [
    data.cliente.ruc ? `RUC / CI: ${data.cliente.ruc}` : "",
    data.cliente.telefono ? `Tel: ${data.cliente.telefono}` : "",
    data.cliente.direccion ?? "",
  ].filter(Boolean);
  for (const l of cli) {
    c.page.drawText(fit(l, reg, 9, colW), { x: MX, y: ly, size: 9, font: reg, color: SLATE });
    ly -= 12.5;
  }
  const leftBottom = ly;

  // Columna derecha: DETALLES
  const rx = MX + colW + 16;
  c.page.drawText("DETALLES", { x: rx, y: boxTop, size: 7.5, font: bold, color: ACENTO });
  c.page.drawRectangle({ x: rx, y: boxTop - 5, width: colW, height: 0.8, color: GRIS_CLARO });
  let ry = boxTop - 20;
  const det: Array<[string, string]> = [
    ["Moneda", moneda === "USD" ? "Dólares (USD)" : "Guaraníes (PYG)"],
  ];
  if (data.validez_dias != null) det.push(["Validez", `${data.validez_dias} día(s)`]);
  if (data.forma_pago) det.push(["Forma de pago", data.forma_pago]);
  if (data.plazo_entrega) det.push(["Plazo de entrega", data.plazo_entrega]);
  for (const [k, v] of det) {
    c.page.drawText(`${k}:`, { x: rx, y: ry, size: 9, font: bold, color: SLATE });
    const kw = bold.widthOfTextAtSize(`${k}: `, 9);
    c.page.drawText(fit(v, reg, 9, colW - kw), { x: rx + kw, y: ry, size: 9, font: reg, color: SLATE });
    ry -= 13;
  }
  c.y = Math.min(leftBottom, ry) - 16;

  // ── Tabla de ítems ──────────────────────────────────────────────────────────
  // Cant · Descripción · P.Unit · IVA · Desc · Total
  const cw = [52, 0, 82, 40, 54, 82];
  cw[1] = W - (cw[0] + cw[2] + cw[3] + cw[4] + cw[5]);
  const cx: number[] = [];
  let acc = MX;
  for (const w of cw) { cx.push(acc); acc += w; }

  const drawHeader = () => {
    c.page.drawRectangle({ x: MX, y: c.y - 6, width: W, height: 20, color: TINTA });
    const th = (t: string, i: number, align: "l" | "r" | "c" = "l") => {
      const tw = bold.widthOfTextAtSize(t, 7.5);
      const x = align === "r" ? cx[i] + cw[i] - tw - 8 : align === "c" ? cx[i] + (cw[i] - tw) / 2 : cx[i] + 8;
      c.page.drawText(t, { x, y: c.y, size: 7.5, font: bold, color: rgb(1, 1, 1) });
    };
    th("CANT.", 0, "c");
    th("DESCRIPCIÓN", 1, "l");
    th("P. UNIT.", 2, "r");
    th("IVA", 3, "c");
    th("DESC.", 4, "r");
    th("TOTAL", 5, "r");
    c.y -= 24;
  };
  drawHeader();

  const NAME_LH = 12; // alto de línea del nombre
  const SKU_LH = 11;  // alto de la línea del SKU
  const PAD = 9;      // padding vertical de la fila
  for (const it of data.items) {
    const nameLines = wrap(it.producto_nombre, reg, 9.5, cw[1] - 16);
    const skuTxt = it.sku ? String(it.sku) : "";
    const rowH = nameLines.length * NAME_LH + (skuTxt ? SKU_LH : 0) + PAD;
    // salto de página (el pie y la numeración se dibujan al final, en pie()).
    if (c.y - rowH < BOTTOM + 40) {
      c.page = doc.addPage(A4);
      c.y = TOP;
      membrete(c);
      drawHeader();
    }

    // Línea base de la primera fila (las columnas numéricas se alinean con el nombre).
    const baseY = c.y - 3;
    // Cant (centrada)
    const cantTxt = fit(`${Number(it.cantidad).toLocaleString("es-PY", { maximumFractionDigits: 3 })}${it.unidad_medida ? " " + it.unidad_medida : ""}`, reg, 8.5, cw[0] - 8);
    c.page.drawText(cantTxt, { x: cx[0] + (cw[0] - reg.widthOfTextAtSize(cantTxt, 8.5)) / 2, y: baseY, size: 8.5, font: reg, color: SLATE });
    // Descripción: nombre en negrita (una o más líneas) + SKU en gris debajo.
    let dy = baseY;
    for (const ln of nameLines) {
      c.page.drawText(ln, { x: cx[1] + 8, y: dy, size: 9.5, font: bold, color: TINTA });
      dy -= NAME_LH;
    }
    if (skuTxt) c.page.drawText(fit(skuTxt, reg, 8, cw[1] - 16), { x: cx[1] + 8, y: dy, size: 8, font: reg, color: GRIS });
    // P.Unit
    const pu = money(it.precio_unitario, moneda);
    c.page.drawText(pu, { x: cx[2] + cw[2] - reg.widthOfTextAtSize(pu, 8.5) - 8, y: baseY, size: 8.5, font: reg, color: SLATE });
    // IVA
    const iva = IVA_LABEL[String(it.iva_tipo)] ?? String(it.iva_tipo);
    c.page.drawText(iva, { x: cx[3] + (cw[3] - reg.widthOfTextAtSize(iva, 8.5)) / 2, y: baseY, size: 8.5, font: reg, color: SLATE });
    // Desc
    const desc = Number(it.descuento) > 0 ? money(it.descuento, moneda) : "—";
    c.page.drawText(desc, { x: cx[4] + cw[4] - reg.widthOfTextAtSize(desc, 8.5) - 8, y: baseY, size: 8.5, font: reg, color: SLATE });
    // Total
    const tot = money(it.total, moneda);
    c.page.drawText(tot, { x: cx[5] + cw[5] - bold.widthOfTextAtSize(tot, 8.5) - 8, y: baseY, size: 8.5, font: bold, color: TINTA });

    c.y -= rowH;
    c.page.drawRectangle({ x: MX, y: c.y + 4, width: W, height: 0.6, color: GRIS_LINEA });
  }

  // ── Totales ─────────────────────────────────────────────────────────────────
  const totW = 250;
  const totX = A4[0] - MX - totW;
  if (c.y < BOTTOM + 96) { c.page = doc.addPage(A4); c.y = TOP; membrete(c); }
  c.y -= 16; // aire después de la tabla
  const totLine = (k: string, v: string) => {
    c.page.drawText(k, { x: totX, y: c.y, size: 9.5, font: reg, color: GRIS });
    c.page.drawText(v, { x: A4[0] - MX - reg.widthOfTextAtSize(v, 9.5), y: c.y, size: 9.5, font: reg, color: SLATE });
    c.y -= 16;
  };
  totLine("Subtotal (sin IVA)", money(data.subtotal, moneda));
  totLine("IVA", money(data.monto_iva, moneda));
  if (Number(data.descuento_total) > 0) totLine("Descuentos", "- " + money(data.descuento_total, moneda));
  // Barra TOTAL: se dibuja HACIA ABAJO desde c.y, sin pisar las líneas de arriba.
  c.y -= 6;
  const barH = 32;
  c.page.drawRectangle({ x: totX - 14, y: c.y - barH, width: totW + 14, height: barH, color: ACENTO });
  const barMid = c.y - barH / 2;
  c.page.drawText("TOTAL", { x: totX, y: barMid - 4.5, size: 12, font: bold, color: rgb(1, 1, 1) });
  const totalTxt = money(data.total, moneda);
  c.page.drawText(totalTxt, { x: A4[0] - MX - bold.widthOfTextAtSize(totalTxt, 14), y: barMid - 5, size: 14, font: bold, color: rgb(1, 1, 1) });
  c.y -= barH + 24;

  // ── Condiciones + observaciones ─────────────────────────────────────────────
  const condiciones: string[] = [];
  condiciones.push(`Condición de venta: ${data.condicion === "credito" ? "Crédito" : "Contado"}.`);
  if (data.validez_dias) condiciones.push(`Validez de la oferta: ${data.validez_dias} día(s)${data.fecha_vencimiento ? ` (vence el ${fecha(data.fecha_vencimiento)})` : ""}.`);
  if (data.forma_pago) condiciones.push(`Forma de pago: ${data.forma_pago}.`);
  if (data.plazo_entrega) condiciones.push(`Plazo de entrega: ${data.plazo_entrega}.`);

  const needCond = 20 + condiciones.length * 12 + (data.observaciones ? 40 : 0);
  if (c.y - needCond < BOTTOM + 60) { c.page = doc.addPage(A4); c.y = TOP; membrete(c); }

  c.page.drawText("CONDICIONES COMERCIALES", { x: MX, y: c.y, size: 8, font: bold, color: ACENTO });
  c.y -= 15;
  for (const cd of condiciones) {
    c.page.drawText("•", { x: MX, y: c.y, size: 9, font: bold, color: ACENTO });
    for (const ln of wrap(cd, reg, 9, W - 16)) {
      c.page.drawText(ln, { x: MX + 12, y: c.y, size: 9, font: reg, color: SLATE });
      c.y -= 12;
    }
  }
  if (data.observaciones) {
    c.y -= 6;
    c.page.drawText("OBSERVACIONES", { x: MX, y: c.y, size: 8, font: bold, color: ACENTO });
    c.y -= 14;
    for (const ln of wrap(data.observaciones, reg, 9, W)) {
      if (c.y < BOTTOM + 60) { c.page = doc.addPage(A4); c.y = TOP; membrete(c); }
      c.page.drawText(ln, { x: MX, y: c.y, size: 9, font: reg, color: SLATE });
      c.y -= 12;
    }
  }

  pie(doc, reg);
  return await doc.save();
}
