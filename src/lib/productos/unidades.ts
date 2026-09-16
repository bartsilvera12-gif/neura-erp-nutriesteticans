/**
 * Reglas de cantidad según la unidad de medida del producto.
 *
 * La ferretería vende de dos formas distintas y el sistema tiene que respetar
 * las dos:
 *   - Por UNIDAD (un martillo, un tornillo): cantidades enteras. Permitir
 *     decimales acá solo habilita errores de tipeo.
 *   - Por peso o medida (clavos por kilo, manguera por metro): cantidades
 *     fraccionadas. Forzar enteros hace imposible vender medio kilo y deja el
 *     stock descuadrado contra la realidad física.
 */

/**
 * Unidades CONTINUAS: se miden por peso, volumen o longitud y admiten
 * fracciones. Todo lo que no esté acá (UNIDAD, PAR, CAJA, DOCENA…) es
 * discreto y solo acepta enteros.
 */
const FRACCIONABLES = new Set([
  "METRO", "METROS", "MT", "M",
  "KILOGRAMO", "KILOGRAMOS", "KILO", "KILOS", "KG",
  "LITRO", "LITROS", "LT", "L",
  "GRAMO", "GRAMOS", "GR", "G",
  "MILILITRO", "MILILITROS", "ML",
  "METRO CUADRADO", "METROS CUADRADOS", "M2", "MT2",
  "METRO CUBICO", "METROS CUBICOS", "M3", "MT3",
  "METRO LINEAL", "METROS LINEALES", "ML2",
  "CENTIMETRO", "CENTIMETROS", "CM",
  "TONELADA", "TONELADAS", "TN",
]);

function normalizar(unidad?: string | null): string {
  return String(unidad ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().trim();
}

/** ¿Este producto admite cantidades con decimales? */
export function permiteDecimales(unidad?: string | null): boolean {
  return FRACCIONABLES.has(normalizar(unidad));
}

/** Incremento de los botones +/- y del atributo `step` del input. */
export function pasoCantidad(unidad?: string | null): number {
  return permiteDecimales(unidad) ? 0.1 : 1;
}

/** Cantidad mínima. En continuas, el paso decimal más chico (0,001). */
export function minimoCantidad(unidad?: string | null): number {
  return permiteDecimales(unidad) ? 0.001 : 1;
}

/** Cuántos decimales se conservan al guardar (3 en continuas, 0 en discretas). */
export function decimalesCantidad(unidad?: string | null): number {
  return permiteDecimales(unidad) ? 3 : 0;
}

/**
 * Interpreta lo que el usuario escribió respetando la unidad.
 * Acepta coma O punto como separador decimal (acá se escribe "2,5" pero un
 * teclado numérico puede meter "2.5"): ambos dan el mismo número.
 * En unidades discretas se trunca a entero (un producto por UNIDAD no admite
 * "0,5"). Devuelve `null` si el texto todavía no es un número válido, para que
 * el input deje seguir escribiendo en vez de saltar a un valor por defecto.
 */
export function parseCantidad(raw: string, unidad?: string | null): number | null {
  // Coma y punto son intercambiables como separador decimal. Se normaliza a
  // punto tomando el ÚLTIMO separador como decimal (así "1.234,5" y "1,5" y
  // "1.5" funcionan). Cualquier separador anterior se descarta (miles).
  let txt = String(raw ?? "").trim();
  if (txt === "") return null;
  const ultimo = Math.max(txt.lastIndexOf(","), txt.lastIndexOf("."));
  if (ultimo >= 0) {
    const entero = txt.slice(0, ultimo).replace(/[.,]/g, "");
    const dec = txt.slice(ultimo + 1).replace(/[^\d]/g, "");
    txt = `${entero}.${dec}`;
  }
  const n = permiteDecimales(unidad) ? parseFloat(txt) : parseInt(txt, 10);
  if (!Number.isFinite(n)) return null;
  return redondearCantidad(n, unidad);
}

/** Ajusta a los decimales admitidos por la unidad. */
export function redondearCantidad(n: number, unidad?: string | null): number {
  const dec = decimalesCantidad(unidad);
  const f = 10 ** dec;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Aplica el mínimo de la unidad (para que nunca quede 0 o negativo). */
export function clampCantidad(n: number, unidad?: string | null): number {
  return Math.max(minimoCantidad(unidad), redondearCantidad(n, unidad));
}

/** Muestra la cantidad sin decimales sobrantes: 2 y no "2.00". */
export function formatCantidad(n: number, unidad?: string | null): string {
  if (!Number.isFinite(n)) return "0";
  return permiteDecimales(unidad)
    ? String(redondearCantidad(n, unidad))
    : String(Math.round(n));
}

/**
 * Formatea el STOCK igual que el catálogo del cliente.
 *
 * Su sistema exporta los productos por peso o medida con 3 decimales fijos
 * ("19.890" = 19,89 kg). Mostrarlo con menos decimales lo obliga a traducir
 * mentalmente entre su planilla y el ERP al hacer inventario, así que se
 * respeta ese formato tal cual.
 *
 * Los productos por UNIDAD van sin decimales: "19,890" para 19 martillos
 * sería confuso y además no es lo que muestra su catálogo.
 *
 * El separador sigue la convención local (es-PY): coma decimal y punto para
 * los miles, consistente con cómo se muestran los importes en todo el sistema.
 */
export function formatStock(valor: number, unidad?: string | null): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "0";
  if (permiteDecimales(unidad)) {
    return n.toLocaleString("es-PY", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  // Unidad no fraccionable. Si aun así el stock tiene decimales (pasa cuando el
  // catálogo de origen trae mal la unidad: "CABLE ... X METRO" marcado como
  // UNIDAD), se muestran igual. Ocultarlos mostraría un número distinto al
  // que está guardado, y el conteo físico nunca cerraría.
  return n.toLocaleString("es-PY", {
    maximumFractionDigits: n === Math.trunc(n) ? 0 : 3,
  });
}

/** Stock + unidad, listo para mostrar: "19,890 KG" / "59 UNIDAD". */
export function formatStockConUnidad(valor: number, unidad?: string | null): string {
  const u = String(unidad ?? "").trim();
  return u ? `${formatStock(valor, unidad)} ${u}` : formatStock(valor, unidad);
}
