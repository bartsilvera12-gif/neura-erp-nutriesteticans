import { redirect } from "next/navigation";

/**
 * /compras/[numero] → redirige a la pantalla de edición (única vista de detalle
 * actual). Evita el 404 cuando alguien escribe /compras/COMP-XXXX sin "/editar".
 */
export default async function CompraDetalleRedirect({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  redirect(`/compras/${encodeURIComponent(decodeURIComponent(numero))}/editar`);
}
