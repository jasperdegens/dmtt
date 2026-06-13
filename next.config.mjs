/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The @hiero-ledger/sdk is a heavy server-only dependency (gRPC/protobuf). Keep it
  // external to the server bundle so Next does not try to bundle it for the browser.
  serverExternalPackages: ["@hiero-ledger/sdk", "tlock-js"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
