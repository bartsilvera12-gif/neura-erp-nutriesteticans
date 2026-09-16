"use client";

import { useCallback, useState } from "react";

/**
 * Hook para consultar un RUC en la SET (Consulta Publica de Marangatu) desde
 * un formulario. Encapsula el estado de "consultando", el aviso al operador
 * (verde/rojo/gris) y el llamado a /api/set/consulta-ruc.
 *
 * Uso:
 *   const { consultar, consultando, aviso, resetAviso } = useConsultaRucSet();
 *   ...
 *   const res = await consultar(rucBruto);
 *   if (res?.razon_social) setRazonSocial(res.razon_social);
 *
 * La API valida el APIKEY en el servidor: el hook nunca ve ni maneja el APIKEY.
 */
export type ConsultaRucSetOk = {
  encontrado: true;
  ruc: string;
  razon_social: string | null;
  estado: string | null;
  categoria: string | null;
  tipo_persona: string | null;
  nombre_comercial: string | null;
};

export type AvisoSet = { tono: "ok" | "info" | "error"; texto: string };

type RespuestaApi = {
  success?: boolean;
  error?: string;
  data?: {
    encontrado?: boolean;
    ruc?: string;
    razon_social?: string | null;
    estado?: string | null;
    categoria?: string | null;
    tipo_persona?: string | null;
    nombre_comercial?: string | null;
    mensaje?: string | null;
  };
};

export function useConsultaRucSet() {
  const [consultando, setConsultando] = useState(false);
  const [aviso, setAviso] = useState<AvisoSet | null>(null);

  const resetAviso = useCallback(() => setAviso(null), []);

  const consultar = useCallback(async (rucBruto: string): Promise<ConsultaRucSetOk | null> => {
    if (rucBruto.replace(/\D/g, "").length < 3) {
      setAviso({ tono: "error", texto: "Cargá primero el RUC (o el documento) del cliente." });
      return null;
    }
    setConsultando(true);
    setAviso(null);
    try {
      const res = await fetch("/api/set/consulta-ruc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruc: rucBruto }),
      });
      const json = (await res.json()) as RespuestaApi;
      if (!res.ok || !json.success) {
        setAviso({ tono: "error", texto: json.error || "No se pudo consultar la SET." });
        return null;
      }
      const d = json.data ?? {};
      if (!d.encontrado || !d.razon_social) {
        setAviso({
          tono: "info",
          texto: d.mensaje || "La SET no encontró ningún contribuyente con ese número.",
        });
        return null;
      }
      const razon = String(d.razon_social).toUpperCase();
      const partes = [razon];
      if (d.estado) partes.push(String(d.estado).toUpperCase());
      if (d.categoria) partes.push(String(d.categoria).toUpperCase());
      if (d.nombre_comercial) partes.push(`"${d.nombre_comercial}"`);
      setAviso({ tono: "ok", texto: `SET: ${partes.join(" · ")}` });
      return {
        encontrado: true,
        ruc: d.ruc ?? "",
        razon_social: razon,
        estado: d.estado ?? null,
        categoria: d.categoria ?? null,
        tipo_persona: d.tipo_persona ?? null,
        nombre_comercial: d.nombre_comercial ?? null,
      };
    } catch (err) {
      setAviso({
        tono: "error",
        texto: err instanceof Error ? err.message : "No se pudo consultar la SET.",
      });
      return null;
    } finally {
      setConsultando(false);
    }
  }, []);

  return { consultar, consultando, aviso, resetAviso, setAviso };
}
