import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The @hiero-ledger/sdk is a heavy server-only dependency (gRPC/protobuf). Keep it
  // external to the server bundle so Next does not try to bundle it for the browser.
  serverExternalPackages: ["@hiero-ledger/sdk", "tlock-js"],
  // The Ledger DMK packages ship pre-built ESM with no CJS fallback; a standalone Next
  // app must transpile them (and their transport) or webpack fails to resolve them.
  transpilePackages: [
    "@ledgerhq/device-management-kit",
    "@ledgerhq/device-transport-kit-web-hid",
  ],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // A stray /Users/jasper/package-lock.json makes Next mis-infer the workspace root;
  // pin it to this project so file tracing + the dev overlay behave.
  outputFileTracingRoot: projectRoot,
  // Keep the dev overlay button out of the corner (it overlaps the countdown watch).
  devIndicators: false,
};

export default nextConfig;
