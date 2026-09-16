/**
 * Ventas por forma de pago.
 *
 * La pregunta que contesta: de todo lo que se vendio en estos dias, cuanto
 * entro por cada medio. Parece una suma simple y no lo es, por tres motivos:
 *
 *   1. Una venta puede estar pagada con MAS DE UN medio (parte con saldo a
 *      favor, el resto en efectivo). Esas viven en `ventas_pagos_detalle`, y
 *      sumarlas por la cabecera pondria el total entero en un solo medio.
 *   2. Una venta a CREDITO no entro por ningun medio todavia: su cobranza va
 *      por el modulo de creditos. Mezclarla con el efectivo infla el dia.
 *   3. Una entrega a domicilio que todavia no se cobro tampoco entro. Es
 *      plata prometida, no cobrada.
 *
 * Por eso el desglose separa "credito" y "sin cobrar" de los medios reales, y
 * deja a la vista "sin definir": lo que nadie clasifico. En los turnos nuevos
 * eso deberia ser cero, porque la caja no cierra hasta resolverlo.
 */

export const FORMAS = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "qr",
  "billetera",
  "saldo_favor",
  "otro",
  "credito",
  "pendiente",
  "sin_definir",
] as const;

export type Forma = (typeof FORMAS)[number];

/** Los medios que representan plata que efectivamente entro. */
export const MEDIOS_REALES: Forma[] = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "qr",
  "billetera",
  "saldo_favor",
  "otro",
];

export const ETIQUETA_FORMA: Record<Forma, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  qr: "QR",
  billetera: "Billetera",
  saldo_favor: "Saldo a favor",
  otro: "Otro",
  credito: "Crédito",
  pendiente: "Sin cobrar",
  sin_definir: "Sin definir",
};

export type VentaReporte = {
  id: string;
  numero_control: string | null;
  fecha: string;
  /** YYYY-MM-DD en Asunción; lo calcula el SQL, no el navegador. */
  dia: string;
  cliente: string | null;
  total: number;
  estado: string | null;
  tipo_venta: string | null;
  metodo_pago: string | null;
  cobro_diferido: boolean | null;
  cobrado_at: string | null;
  /** Suma por medio en `ventas_pagos_detalle`. Vacío = la venta no tiene detalle. */
  detalle: Partial<Record<Forma, number>>;
};

/* Diferencias de menos de 1 Gs. son redondeo, no un saldo sin clasificar. */
const TOLERANCIA = 1;

/** Cuánta plata de esta venta entró por cada forma. */
export function desglosarVenta(v: VentaReporte): Partial<Record<Forma, number>> {
  if (String(v.estado ?? "").trim().toLowerCase() === "anulada") return {};

  const total = Number(v.total) || 0;

  if (String(v.tipo_venta ?? "").trim().toUpperCase() === "CREDITO") {
    return { credito: total };
  }
  if (v.cobro_diferido === true && !v.cobrado_at) {
    return { pendiente: total };
  }

  const det: Partial<Record<Forma, number>> = {};
  let sumaDet = 0;
  for (const forma of MEDIOS_REALES) {
    const monto = Number(v.detalle?.[forma] ?? 0);
    if (!Number.isFinite(monto) || monto === 0) continue;
    det[forma] = (det[forma] ?? 0) + monto;
    sumaDet += monto;
  }

  if (sumaDet > 0) {
    /* Si el detalle no llega al total, lo que falta no se inventa a ningun
       medio: se muestra como sin definir, que es lo que es. */
    const resto = total - sumaDet;
    if (resto > TOLERANCIA) det.sin_definir = resto;
    return det;
  }

  const m = String(v.metodo_pago ?? "").trim().toLowerCase() as Forma;
  if (MEDIOS_REALES.includes(m)) return { [m]: total };
  return { sin_definir: total };
}

export type ResumenForma = {
  forma: Forma;
  etiqueta: string;
  monto: number;
  /** Ventas en las que participa esta forma (una venta combinada cuenta en las dos). */
  ventas: number;
  porcentaje: number;
};

export type ResumenVentas = {
  total_vendido: number;
  cantidad_ventas: number;
  anuladas: number;
  /** Lo que efectivamente entró: sin crédito, sin lo que falta cobrar. */
  total_cobrado: number;
  por_forma: ResumenForma[];
};

export function resumirPorForma(ventas: VentaReporte[]): ResumenVentas {
  const monto = new Map<Forma, number>();
  const cuenta = new Map<Forma, number>();
  let totalVendido = 0;
  let cantidad = 0;
  let anuladas = 0;

  for (const v of ventas) {
    if (String(v.estado ?? "").trim().toLowerCase() === "anulada") {
      anuladas++;
      continue;
    }
    cantidad++;
    totalVendido += Number(v.total) || 0;
    for (const [forma, m] of Object.entries(desglosarVenta(v)) as Array<[Forma, number]>) {
      if (!m) continue;
      monto.set(forma, (monto.get(forma) ?? 0) + m);
      cuenta.set(forma, (cuenta.get(forma) ?? 0) + 1);
    }
  }

  const totalCobrado = MEDIOS_REALES.reduce((s, f) => s + (monto.get(f) ?? 0), 0);

  const por_forma: ResumenForma[] = FORMAS.filter((f) => (monto.get(f) ?? 0) !== 0).map((f) => ({
    forma: f,
    etiqueta: ETIQUETA_FORMA[f],
    monto: monto.get(f) ?? 0,
    ventas: cuenta.get(f) ?? 0,
    porcentaje: totalVendido > 0 ? Math.round(((monto.get(f) ?? 0) / totalVendido) * 1000) / 10 : 0,
  }));
  por_forma.sort((a, b) => b.monto - a.monto);

  return {
    total_vendido: totalVendido,
    cantidad_ventas: cantidad,
    anuladas,
    total_cobrado: totalCobrado,
    por_forma,
  };
}

export type FilaDia = {
  dia: string;
  total: number;
  ventas: number;
  por_forma: Partial<Record<Forma, number>>;
};

/** El mismo desglose pero dia por dia, para ver el movimiento del periodo. */
export function resumirPorDia(ventas: VentaReporte[]): FilaDia[] {
  const dias = new Map<string, FilaDia>();
  for (const v of ventas) {
    if (String(v.estado ?? "").trim().toLowerCase() === "anulada") continue;
    const dia = v.dia || String(v.fecha ?? "").slice(0, 10);
    const fila = dias.get(dia) ?? { dia, total: 0, ventas: 0, por_forma: {} };
    fila.total += Number(v.total) || 0;
    fila.ventas += 1;
    for (const [forma, m] of Object.entries(desglosarVenta(v)) as Array<[Forma, number]>) {
      if (!m) continue;
      fila.por_forma[forma] = (fila.por_forma[forma] ?? 0) + m;
    }
    dias.set(dia, fila);
  }
  return [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Las ventas en las que participa una forma, para el detalle de la pantalla. */
export function ventasDeForma(ventas: VentaReporte[], forma: Forma): VentaReporte[] {
  return ventas.filter((v) => (desglosarVenta(v)[forma] ?? 0) > 0);
}
