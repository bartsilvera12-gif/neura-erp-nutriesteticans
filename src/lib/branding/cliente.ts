/**
 * Identidad del cliente de esta instancia (monocliente): Nutriestéticans.
 *
 * Centraliza branding y colores para que ni el logo ni la paleta queden
 * hardcodeados en los documentos imprimibles. Los datos fiscales operativos
 * viven en `EMPRESA_DOC` (src/lib/documentos/membrete.ts) porque el resto del
 * ERP ya los lee de ahi.
 */

/** Nombre comercial visible en documentos. */
export const CLIENTE_NOMBRE = "Nutriestéticans";

/** Logo del cliente servido desde /public. `null` = sin logo cargado. */
export const CLIENTE_LOGO_URL: string | null = null;

/**
 * Paleta usada por el HTML de la nota de remision (bordes, franjas, tabla).
 * Se mantiene neutra (gris/negro) mientras no haya identidad de marca cargada.
 */
export const CLIENTE_COLORES = {
  primario: "#111827",
  primarioFill: "#F3F4F6",
  interior: "#4B5563",
  secundario: "#8C9196",
} as const;
