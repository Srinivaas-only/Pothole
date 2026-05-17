import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

export default defineConfig({
  plugins: [
    react(),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/detect": { target: "http://localhost:8000", changeOrigin: true },
      "/reports": { target: "http://localhost:8000", changeOrigin: true },
      "/hazards": { target: "http://localhost:8000", changeOrigin: true },
      "/health": { target: "http://localhost:8000", changeOrigin: true },
      "/location": { target: "http://localhost:8000", changeOrigin: true },
      "/admin": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});