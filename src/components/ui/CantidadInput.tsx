"use client";

/**
 * Input de CANTIDAD que respeta la unidad del producto y acepta decimales
 * mientras se tipea, con coma O punto como separador.
 *
 * Por qué no un <input type="number"> controlado por un número: al reformatear
 * el valor en cada tecla, estados intermedios como "0." o "0,8" se colapsan a 0
 * y no se puede escribir el decimal ("no deja avanzar"). Acá se mantiene un
 * buffer de texto local: se deja escribir libremente, se emite el número válido
 * en caliente y se normaliza (clamp + redondeo a los decimales de la unidad) al
 * salir del campo. Así el cálculo de stock nunca recibe algo mal formado.
 */
import { useEffect, useRef, useState } from "react";
import {
  parseCantidad,
  clampCantidad,
  permiteDecimales,
  decimalesCantidad,
  formatCantidad,
} from "@/lib/productos/unidades";

export default function CantidadInput({
  value,
  unidad,
  onChange,
  className,
  ariaLabel,
}: {
  value: number;
  unidad?: string | null;
  /** Se llama con el número ya parseado (en caliente al tipear y al salir). */
  onChange: (n: number) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const dec = permiteDecimales(unidad);
  const maxDec = decimalesCantidad(unidad);
  const [raw, setRaw] = useState<string>(() => formatCantidad(value, unidad));
  const editing = useRef(false);

  // Si el valor externo cambia (botones +/-, carga de pedido…) y no estamos
  // editando, reflejarlo en el texto.
  useEffect(() => {
    if (!editing.current) setRaw(formatCantidad(value, unidad));
  }, [value, unidad]);

  function sanitize(input: string): string {
    let v = input.replace(/[^\d.,]/g, "");
    if (!dec) return v.replace(/[.,]/g, "");
    // Dejar solo el PRIMER separador; los siguientes se descartan.
    const i = v.search(/[.,]/);
    if (i >= 0) {
      const sep = v[i];
      const entero = v.slice(0, i).replace(/[.,]/g, "");
      const decimales = v.slice(i + 1).replace(/[.,]/g, "").slice(0, maxDec);
      v = `${entero}${sep}${decimales}`;
    }
    return v;
  }

  return (
    <input
      type="text"
      inputMode={dec ? "decimal" : "numeric"}
      value={raw}
      aria-label={ariaLabel}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => {
        const v = sanitize(e.target.value);
        setRaw(v);
        const n = parseCantidad(v, unidad);
        if (n !== null) onChange(n);
      }}
      onBlur={(e) => {
        editing.current = false;
        const n = parseCantidad(e.target.value, unidad);
        const c = clampCantidad(n ?? 0, unidad);
        onChange(c);
        setRaw(formatCantidad(c, unidad));
      }}
      className={className}
    />
  );
}
