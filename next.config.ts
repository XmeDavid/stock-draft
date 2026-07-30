import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "financialmodelingprep.com",
        port: "",
        pathname: "/image-stock/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
