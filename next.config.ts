import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@google-cloud/speech",
    "@google-cloud/translate",
    "@google-cloud/text-to-speech",
  ],
};

export default nextConfig;
