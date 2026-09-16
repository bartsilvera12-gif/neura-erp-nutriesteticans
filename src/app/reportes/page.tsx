"use client";

import { FileText, ShoppingCart } from "lucide-react";
import { SettingsModuleCard } from "@/components/config/SettingsModuleCard";

export default function ReportesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reportes</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Vistas consolidadas del negocio. Elegí un reporte para ver el detalle.
        </p>
      </div>

      <section aria-label="Reportes disponibles" className="space-y-4">
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          <li>
            <SettingsModuleCard
              title="Facturas"
              subtitle="COMERCIAL · DOCUMENTOS"
              description="Todas las facturas de la empresa: cliente, monto, saldo, estado y estado SIFEN, con filtros y acceso al detalle."
              icon={FileText}
              href="/reportes/facturas"
              actionLabel="Ver reporte"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Ventas por forma de pago"
              subtitle="COMERCIAL · CAJA"
              description="Cuánto entró por cada medio en el período, cruzando todas las cajas y turnos. Con detalle día por día y export a CSV."
              icon={ShoppingCart}
              href="/reportes/ventas"
              actionLabel="Ver reporte"
            />
          </li>
        </ul>
      </section>
    </div>
  );
}
