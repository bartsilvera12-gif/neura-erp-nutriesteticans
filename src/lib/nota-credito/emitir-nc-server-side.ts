/**
 * Orquestador server-side: emite el DE de una Nota de Crédito al SET de forma
 * automática (procesar = xml → firmar → enviar recibe-lote, + una consulta-lote
 * best-effort), en segundo plano y sin lanzar. Se dispara al crear la NC, igual
 * que la facturación al confirmar la venta.
 *
 * Reutiliza los handlers existentes (que ya envían de verdad al SET) invocándolos
 * con un NextRequest sintético; el ambiente (producción/test) lo decide el servidor
 * según empresa_sifen_config.
 */
import { NextRequest } from "next/server";
import type { UsuarioConEmpresaYRol } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { handleNcSifenProcesarPost } from "./handle-nc-sifen-procesar-post";
import { handleNcSifenConsultaLotePost } from "./handle-nc-sifen-consulta-lote-post";

export async function emitirNcServerSide(args: {
  auth: UsuarioConEmpresaYRol;
  supabase: AppSupabaseClient;
  notaCreditoId: string;
}): Promise<void> {
  const { auth, supabase, notaCreditoId } = args;
  const req = new NextRequest("http://localhost/api/internal/nc-sifen");
  try {
    // 1) Procesar: genera XML, firma y envía el lote (recibe-lote) al SET.
    await handleNcSifenProcesarPost({
      request: req,
      auth,
      supabase,
      notaCreditoId,
      options: { soloAmbienteTest: false },
    });

    // 2) Consulta-lote best-effort para resolver aprobación (si el SET ya respondió).
    //    Si el lote sigue en proceso o el estado no permite consultar, el handler
    //    devuelve un NextResponse sin lanzar; queda reintentable desde el panel.
    await handleNcSifenConsultaLotePost(
      req,
      Promise.resolve({ id: notaCreditoId }),
      auth,
      { soloAmbienteTest: false }
    );
  } catch (e) {
    console.error("[emitirNcServerSide]", e instanceof Error ? e.message : e);
  }
}
