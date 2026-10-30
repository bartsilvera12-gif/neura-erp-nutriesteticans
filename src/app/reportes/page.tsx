"use client";

import { Boxes, ShoppingCart } from "lucide-react";
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
              title="Ventas"
              subtitle="COMERCIAL · CAJA"
              description="Cuánto se vendió en el período y por qué medio de pago, con detalle día por día y export a CSV."
              icon={ShoppingCart}
              href="/reportes/ventas"
              actionLabel="Ver reporte"
            />
          </li>
          <li>
            <SettingsModuleCard
              title="Inventario"
              subtitle="PRODUCTOS · STOCK"
              description="Stock actual, productos sin stock o por reponer y valor de la mercadería, con export a Excel."
              icon={Boxes}
              href="/reportes/inventario"
              actionLabel="Ver reporte"
            />
          </li>
        </ul>
      </section>
    </div>
  );
}
