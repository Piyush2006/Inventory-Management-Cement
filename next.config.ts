import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: ["ims-cement.iocompute.ai"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "img.icons8.com" }],
  },
};

export default nextConfig;
