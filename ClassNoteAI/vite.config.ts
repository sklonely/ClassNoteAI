import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Wrapper scripts (e.g. `npm run dev:ephemeral`) inject a chosen free
// port via VITE_DEV_PORT / VITE_HMR_PORT。沒設 = fallback 到歷史的
// 1420/1421 (單機 solo 開發者習慣)。
// @ts-expect-error process is a nodejs global
const devPort = Number.parseInt(process.env.VITE_DEV_PORT ?? '1420', 10);
// @ts-expect-error process is a nodejs global
const hmrPort = Number.parseInt(process.env.VITE_HMR_PORT ?? '1421', 10);

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // 啟用詳細日誌
  logLevel: 'info',
  build: {
    // 顯示構建詳情
    minify: false,
    sourcemap: true,
  },
}));
