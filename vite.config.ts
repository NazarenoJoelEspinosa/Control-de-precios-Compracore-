import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // GitHub Pages sirve el sitio bajo /<nombre-del-repo>/, no en la raíz del
  // dominio. Sin esto, los assets (JS/CSS) se piden mal y la página queda en blanco.
  base: "/Control-de-precios-Compracore-/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
});
