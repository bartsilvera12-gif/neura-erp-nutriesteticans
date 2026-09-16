export type TipoIvaVenta = "EXENTA" | "5%" | "10%";
export type TipoVenta   = "CONTADO" | "CREDITO";
export type MonedaVenta = "GS" | "USD";
export type MetodoPago  = "efectivo" | "tarjeta" | "transferencia" | "mixto";
/** Nivel de precio elegido para la línea de venta.
 *  'costo' se conserva SOLO como histórico (ventas viejas); ya no se ofrece en la UI. */
export type TipoPrecioVenta = "minorista" | "mayorista" | "distribuidor" | "costo";

/** Un ítem dentro de una venta (una línea de producto). */
export interface LineaVenta {
  /** Vacío ("") en las líneas manuales: el backend lo guarda como NULL. */
  producto_id:           string;
  producto_nombre:       string;
  sku:                   string;
  /**
   * Línea escrita a mano (un trabajo/servicio, ej. "Mantenimiento de compresor:
   * cambio de pistones, aceite y válvulas"). No sale del catálogo, no descuenta
   * stock y su costo se carga a mano en `costo_unitario`.
   */
  es_manual?:            boolean;
  /**
   * Costo por unidad cargado a mano (repuestos + mano de obra), solo en líneas
   * manuales. Sirve para calcular la ganancia del trabajo. En las líneas de
   * catálogo queda sin definir: ahí el costo real sale del movimiento de stock.
   */
  costo_unitario?:       number | null;
  /** Cantidad en la PRESENTACION elegida (ej. 2 = 2 cajas o 10 unidades). */
  cantidad:              number;
  /**
   * Unidad de medida del producto. Define si la cantidad admite decimales:
   * KILOGRAMO/METRO/LITRO sí (medio kilo de clavos), UNIDAD no.
   */
  unidad_medida?:        string | null;
  precio_venta_original: number;  // en la moneda elegida
  precio_venta:          number;  // siempre en GS, POR PRESENTACION
  tipo_iva:              TipoIvaVenta;
  /** Nivel de precio aplicado: minorista (precio_venta) | mayorista (precio_mayorista) | costo (costo_promedio). */
  tipo_precio?:          TipoPrecioVenta;
  // ── Reglas de precio por canal (para auto-cambiar de tipo según cantidad).
  // Snapshot del producto al agregar la línea; solo se usan en el cliente.
  precio_minorista?:        number | null;
  precio_mayorista?:        number | null;
  precio_distribuidor?:     number | null;
  cantidad_minima_mayorista?: number | null;
  /** true si el cajero fijó manualmente el tipo/precio: no auto-cambiar más. */
  precio_manual?:           boolean;
  subtotal:              number;  // precio_venta × cantidad
  monto_iva:             number;
  total_linea:           number;  // subtotal + monto_iva
  /**
   * Presentacion de venta elegida (Caja, Paquete, etc). Opcional para mantener
   * compatibilidad con flujos antiguos. Cuando viene, el backend descuenta
   * `cantidad * presentacion.cantidad_base` del stock. Cuando NO viene, usa
   * la default activa del producto (efecto: igual que antes).
   */
  presentacion_id?:           string | null;
  presentacion_nombre?:       string | null;
  presentacion_cantidad_base?: number | null;
}

/** Cabecera de venta: condiciones comerciales + totales consolidados. */
export interface Venta {
  /** UUID en base de datos (antes del bloque DB-first era numérico local). */
  id:             string;
  numero_control: string;   // VTA-000001, VTA-000002, …

  items: LineaVenta[];       // 1 o más productos

  moneda:      MonedaVenta;
  tipo_cambio: number;       // 1 si moneda === "GS"

  subtotal:  number;         // Σ subtotal de ítems
  monto_iva: number;         // Σ monto_iva de ítems
  total:     number;         // Σ total_linea de ítems

  tipo_venta: TipoVenta;
  plazo_dias?: number;       // solo si tipo_venta === "CREDITO"

  metodo_pago?: MetodoPago;  // En lo de Mari: efectivo/tarjeta/transferencia

  /**
   * Cliente de la venta. Si hay cliente, la venta se factura (se emite factura
   * autoimpresor); si es null, solo lleva ticket interno.
   */
  cliente_id?: string | null;

  /** La venta emite nota de remisión (documento no fiscal). */
  genera_nota_remision?: boolean;
  /** Número de nota de remisión (NR-XXXXXX) si genera_nota_remision. */
  nota_remision_numero?: string | null;

  fecha: string;             // ISO string, generado automáticamente

  /** Nombre del usuario que registró la venta (auditoría). */
  usuario_nombre?: string | null;

  /** Factura asociada (si la venta se facturó). Para acceder al detalle desde el listado. */
  factura_id?: string | null;
  /** Número de factura (ej. FAC-000003). */
  factura_numero?: string | null;
  /** Estado comercial de la factura (Pendiente/Pagado/Anulado). */
  factura_estado?: string | null;
  /** Estado del documento electrónico SIFEN (aprobado/rechazado/…). */
  factura_estado_sifen?: string | null;

  /** Estado de la venta: 'completada' (default) | 'anulada'. */
  estado?: string | null;
  /** Motivo registrado al anular la venta (auditoría). */
  anulacion_motivo?: string | null;
}
