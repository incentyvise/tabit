import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";
import fs from "node:fs";

const certDir = path.resolve(__dirname, "../../certs");
const https =
  fs.existsSync(path.join(certDir, "cert.pem")) &&
  fs.existsSync(path.join(certDir, "key.pem"))
    ? {
        cert: fs.readFileSync(path.join(certDir, "cert.pem")),
        key: fs.readFileSync(path.join(certDir, "key.pem")),
      }
    : undefined;

const isProd = process.env.NODE_ENV === "production";
const useDevProxy = !process.env.VITE_API_URL;

function getAllowedHosts(): string[] {
  const hosts = ["localhost"];
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL;
  if (adminUrl) {
    try {
      hosts.push(new URL(adminUrl).hostname);
    } catch {
      // ignore invalid URL
    }
  }
  return hosts;
}

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  preview: {
    allowedHosts: getAllowedHosts(),
  },
  server: {
    https: isProd ? undefined : https,
    proxy: useDevProxy
      ? {
          "/rpc": { target: "http://localhost:3001", changeOrigin: true },
          "/api/auth": { target: "http://localhost:3001", changeOrigin: true },
        }
      : undefined,
  },
});
