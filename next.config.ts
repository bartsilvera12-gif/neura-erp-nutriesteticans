import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Quitar el header "X-Powered-By: Next.js".
  poweredByHeader: false,

  // gzip de respuestas en producción (default, explícito para evitar sorpresas
  // si Coolify/Traefik intentan re-comprimir).
  compress: true,

  // NO usamos output: "standalone": Coolify+Nixpacks corre `next start` con .next/
  // regular, no usa .next/standalone/.

  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  // CRÍTICO (Coolify): el step de TypeScript del build consume ~2GB de RAM y mata
  // el contenedor por OOM → el deploy falla y sigue corriendo el código viejo.
  // El chequeo de tipos se hace localmente con `tsc --noEmit` antes de cada commit.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Caching agresivo de assets fingerprinted + HSTS.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/_next/image(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
