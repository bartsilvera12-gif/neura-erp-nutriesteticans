/**
 * Cliente HTTP de la Consulta Publica de la SET.
 * Toma el APIKEY de la variable de entorno SET_CONSULTA_PUBLICA_APIKEY (server only).
 */
import {
  leerRespuestaConsultaRuc,
  partirRucParaConsulta,
  urlConsultaRuc,
  type ResultadoConsultaRuc,
} from "./consulta-ruc-parseo";

export type ConsultaRucResultado =
  | { ok: true; resultado: ResultadoConsultaRuc; httpStatus: number; consultado: { ruc: string; dv: string } }
  | { ok: false; mensaje: string; httpStatus: number };

/**
 * Consulta un RUC contra la SET. Devuelve la respuesta parseada o un mensaje
 * de error si algo falló en el transporte (timeout, HTTP != 200, JSON invalido).
 */
export async function consultarRuc(rucEntrada: string): Promise<ConsultaRucResultado> {
  const apiKey = process.env.SET_CONSULTA_PUBLICA_APIKEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      mensaje:
        "Falta la variable SET_CONSULTA_PUBLICA_APIKEY en el servidor. Cargarla en Coolify con el APIKEY entregado por la SET.",
      httpStatus: 0,
    };
  }

  let partes: { cuerpo: string; dv: string };
  try {
    partes = partirRucParaConsulta(rucEntrada);
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : String(e), httpStatus: 0 };
  }

  const url = urlConsultaRuc({ apiKey, ruc: partes.cuerpo, dv: partes.dv });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      mensaje: `No se pudo conectar a la SET: ${e instanceof Error ? e.message : String(e)}`,
      httpStatus: 0,
    };
  }

  const texto = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      mensaje: `SET respondió algo que no es JSON (HTTP ${res.status}). Cuerpo: ${texto.slice(0, 200)}`,
      httpStatus: res.status,
    };
  }

  return {
    ok: true,
    resultado: leerRespuestaConsultaRuc(json),
    httpStatus: res.status,
    consultado: { ruc: partes.cuerpo, dv: partes.dv },
  };
}
