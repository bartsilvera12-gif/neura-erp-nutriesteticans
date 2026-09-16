/**
 * Membrete (encabezado) común para todos los documentos imprimibles del ERP.
 * Devuelve HTML con estilos inline para no depender del CSS de cada endpoint.
 *
 * SOLO presentación: no toca datos de negocio.
 *
 * Nutriestéticans: por ahora sin logo. Cuando se cargue un logo real, poblar
 * `EMPRESA_DOC.logoDataUri` con un data URI (o `logoUrl` con la ruta pública)
 * y el `<img>` se renderiza automáticamente.
 */

export const EMPRESA_DOC = {
  nombre: "NUTRIESTÉTICANS",
  actividad: [] as string[],
  telefono: "",
  email: "",
  direccion: [] as string[],
  /** Data URI del logo. Vacío → no se renderiza `<img>`. */
  logoDataUri: "",
  /** Fallback si no hay data URI (URL pública). Vacío → no se renderiza `<img>`. */
  logoUrl: "",
};

/** Fuente del logo. Devuelve "" si no hay ningún logo cargado. */
function resolveLogoSrc(origin: string): string {
  if (EMPRESA_DOC.logoDataUri) return EMPRESA_DOC.logoDataUri;
  if (EMPRESA_DOC.logoUrl) return origin ? `${origin}${EMPRESA_DOC.logoUrl}` : EMPRESA_DOC.logoUrl;
  return "";
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Membrete A4: logo a la izquierda (si hay), datos comerciales a la derecha, línea divisoria.
 * `origin` opcional para URL absoluta del logo.
 */
export function membreteA4(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = resolveLogoSrc(origin);
  const actividadHtml = e.actividad.length
    ? e.actividad.map((a) => `<div style="color:#6b7280;">${esc(a)}</div>`).join("")
    : "";
  const telHtml = e.telefono ? `<div style="margin-top:4px;"><strong>Tel:</strong> ${esc(e.telefono)}</div>` : "";
  const emailHtml = e.email ? `<div><strong>Email:</strong> ${esc(e.email)}</div>` : "";
  const dirHtml = e.direccion.length ? `<div>${e.direccion.map(esc).join(" · ")}</div>` : "";
  const logoHtml = logo
    ? `<div style="flex:0 0 auto;">
         <img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:240px;max-height:130px;width:auto;height:auto;object-fit:contain;display:block;" />
       </div>`
    : "";
  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:2px solid #1e3a8a;padding-bottom:12px;margin-bottom:16px;">
    ${logoHtml}
    <div style="flex:1;min-width:0;text-align:${logo ? "right" : "left"};font-size:11px;color:#374151;line-height:1.55;">
      <div style="font-size:18px;font-weight:800;color:#1f2937;">${esc(e.nombre)}</div>
      ${actividadHtml}
      ${telHtml}
      ${emailHtml}
      ${dirHtml}
    </div>
  </div>`;
}

/**
 * Membrete compacto para ticket angosto (58/80mm): logo arriba si hay, datos centrados.
 */
export function membreteTicket(origin = ""): string {
  const e = EMPRESA_DOC;
  const logo = resolveLogoSrc(origin);
  const telHtml = e.telefono ? `<div style="font-size:10px;">Tel: ${esc(e.telefono)}</div>` : "";
  const emailHtml = e.email ? `<div style="font-size:10px;word-break:break-all;">${esc(e.email)}</div>` : "";
  const dirHtml = e.direccion.length
    ? e.direccion.map((d) => `<div style="font-size:10px;">${esc(d)}</div>`).join("")
    : "";
  const logoHtml = logo
    ? `<img src="${esc(logo)}" alt="${esc(e.nombre)}" style="max-width:210px;max-height:110px;width:auto;height:auto;object-fit:contain;display:inline-block;margin:0 auto 4px;" />`
    : "";
  return `
  <div style="text-align:center;padding-bottom:6px;margin-bottom:6px;border-bottom:1px dashed #000;">
    ${logoHtml}
    <div style="font-weight:700;font-size:13px;">${esc(e.nombre)}</div>
    ${dirHtml}
    ${telHtml}
    ${emailHtml}
  </div>`;
}
