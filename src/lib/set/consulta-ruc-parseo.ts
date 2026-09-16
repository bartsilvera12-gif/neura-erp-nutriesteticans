/**
 * Consulta Publica de la DNIT/SET — armado del pedido y lectura de la respuesta.
 *
 * NO es el web service SIFEN: es la "Consulta Publica" del Sistema Marangatu,
 * REST + APIKEY. Habilitada por la SET desde Marangatu > "Comunicar Uso De
 * Consultas Publicas".
 *
 * Endpoint:   https://servicios.set.gov.py/EsetApiWS/ApiWS/consultaRuc
 * Metodo:     GET, query params (apiKey, ruc, dv), respuesta JSON.
 * Servicios habilitados: consultaRuc, validezDocumentoTimbrado,
 * validezDocumentoMaquinaRegistradora.
 *
 * Este archivo es la parte PURA (sin red). El cliente HTTP vive en
 * ./consulta-ruc.ts, para poder probar el armado sin hablar con SET.
 */
export const SET_CONSULTA_PUBLICA_BASE = "https://servicios.set.gov.py/EsetApiWS/ApiWS";

export type ConsultaRucSalida = {
  cuerpo: string;
  dv: string;
};

/**
 * Toma lo que tipeo el operador (RUC con o sin guion, con puntos, con espacios)
 * y devuelve el cuerpo y el DV separados como pide la SET.
 *
 * Reglas:
 *   - Si viene "80168860-4" -> { cuerpo: "80168860", dv: "4" }.
 *   - Si viene "801688604" o sin guion -> el ULTIMO digito es el DV, el resto el cuerpo.
 *   - Puntos y espacios se descartan.
 *   - Con menos de 2 digitos no se puede consultar: se lanza error.
 *
 * OJO: la SET solo conoce contribuyentes. Una cedula suelta sin RUC no aparece
 * en este servicio (aunque tenga DV valido) — la SET responde "no registrado".
 */
export function partirRucParaConsulta(entrada: string): ConsultaRucSalida {
  const bruto = String(entrada ?? "").trim();
  if (!bruto) throw new Error("Ingresá un RUC para consultar (formato 00000000-0).");
  const conGuion = bruto.includes("-") ? bruto.split("-") : null;
  if (conGuion && conGuion.length === 2) {
    const cuerpo = (conGuion[0] ?? "").replace(/\D/g, "");
    const dv = (conGuion[1] ?? "").replace(/\D/g, "").slice(0, 1);
    if (cuerpo.length < 1 || dv.length !== 1) {
      throw new Error(`RUC con formato invalido: "${entrada}". Se espera "00000000-0".`);
    }
    return { cuerpo, dv };
  }
  const soloDigitos = bruto.replace(/\D/g, "");
  if (soloDigitos.length < 2) {
    throw new Error(`RUC demasiado corto: "${entrada}".`);
  }
  return {
    cuerpo: soloDigitos.slice(0, -1),
    dv: soloDigitos.slice(-1),
  };
}

/**
 * Arma la URL final del GET a la Consulta Publica. Los tres parametros
 * (apiKey, ruc, dv) van como query string, exactamente como pide la spec.
 */
export function urlConsultaRuc(params: { apiKey: string; ruc: string; dv: string }): string {
  const qs = new URLSearchParams({
    apiKey: params.apiKey,
    ruc: params.ruc,
    dv: params.dv,
  }).toString();
  return `${SET_CONSULTA_PUBLICA_BASE}/consultaRuc?${qs}`;
}

/** Detalle del contribuyente que devuelve el servicio cuando el RUC existe. */
export type ContribuyenteSet = {
  razonSocial: string | null;
  estado: string | null;
  categoria: string | null;
  mesCierre: string | null;
  tipoPersona: string | null;
  rucAnterior: string | null;
  tipoSociedad: string | null;
  nombreComercial: string | null;
};

export type ResultadoConsultaRuc =
  | {
      encontrado: true;
      estado: "VALIDO";
      codigo: string;
      mensaje: string | null;
      contribuyente: ContribuyenteSet;
    }
  | {
      encontrado: false;
      estado: string;
      codigo: string;
      mensaje: string;
      /** true si el codigo devuelto indica cuota agotada / servicio no activo / apikey invalida. */
      esErrorDeCuotaOApikey: boolean;
    };

/**
 * Codigos "ap001" cubren varios problemas del apikey/cuota: cuota agotada,
 * apikey no registrado, servicio no activo, usuario no activo. Los agrupamos
 * asi el llamador puede loguearlos distinto del "no encontrado".
 */
const CODIGOS_APIKEY_CUOTA = new Set(["ap001", "ap010"]);

export function leerRespuestaConsultaRuc(body: unknown): ResultadoConsultaRuc {
  const b = (body ?? {}) as Record<string, unknown>;
  const estado = String(b.estado ?? "").trim().toUpperCase();
  const codigo = String(b.codigo ?? "").trim();
  const mensaje = b.mensaje == null ? null : String(b.mensaje);

  if (estado === "VALIDO") {
    const c = (b.contribuyente ?? {}) as Record<string, unknown>;
    return {
      encontrado: true,
      estado: "VALIDO",
      codigo: codigo || "VALIDO",
      mensaje,
      contribuyente: {
        razonSocial: c.razonSocial == null ? null : String(c.razonSocial),
        estado: c.estado == null ? null : String(c.estado),
        categoria: c.categoria == null ? null : String(c.categoria),
        mesCierre: c.mesCierre == null ? null : String(c.mesCierre),
        tipoPersona: c.tipoPersona == null ? null : String(c.tipoPersona),
        rucAnterior: c.rucAnterior == null ? null : String(c.rucAnterior),
        tipoSociedad: c.tipoSociedad == null ? null : String(c.tipoSociedad),
        nombreComercial: c.nombreComercial == null ? null : String(c.nombreComercial),
      },
    };
  }

  return {
    encontrado: false,
    estado: estado || "INVALIDO",
    codigo: codigo || "INVALIDO",
    mensaje: mensaje ?? "SET no encontró el RUC consultado.",
    esErrorDeCuotaOApikey: CODIGOS_APIKEY_CUOTA.has(codigo.toLowerCase()),
  };
}
