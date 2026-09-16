/**
 * Fuente del logo del cliente para documentos imprimibles.
 *
 * Devuelve un data URI o URL absoluta. Se comparte con el membrete estandar
 * (que ya lee `EMPRESA_DOC.logoDataUri`): si `EMPRESA_DOC.logoDataUri` esta
 * poblado se usa, sino se cae a `EMPRESA_DOC.logoUrl`, sino `null` (el
 * renderer omite el `<img>` cuando recibe null).
 */
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

export function logoClienteSrc(): string | null {
  if (EMPRESA_DOC.logoDataUri) return EMPRESA_DOC.logoDataUri;
  if (EMPRESA_DOC.logoUrl) return EMPRESA_DOC.logoUrl;
  return null;
}
