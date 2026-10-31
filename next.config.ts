import type { NextConfig } from "next";
import { createSecurityHeaders } from "./src/lib/security-headers";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: createSecurityHeaders({
          nodeEnv: process.env.NODE_ENV,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          appUrl: process.env.APP_URL,
          vercel: process.env.VERCEL,
        }),
      },
    ];
  },
};
export default config;
