import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/Kimchanghee/sellerpilot-global/main/public/**",
      },
    ],
  },
};

export default nextConfig;
