import type { Config } from "tailwindcss";

/**
 * Sistema de diseño — "ficha técnica de ferretería"
 *
 * Paleta: gris acero frío (no el beige cálido genérico) + un solo acento
 * ámbar de "advertencia de taller" para lo que necesita atención humana,
 * y un teal de precisión para lo confirmado. Nada de dark-mode-con-neón.
 *
 * Tipografía: Archivo Narrow para títulos/eyebrows (letra angosta tipo
 * chapa estampada), Inter para texto de lectura, IBM Plex Mono para
 * códigos y precios (que se lean como una ficha técnica, no como prosa).
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B1F23",
        steel: {
          50: "#F1F3F5",
          100: "#E4E8EC",
          200: "#CBD2D9",
          300: "#9AA5B1",
          600: "#52606D",
          800: "#2B333B",
        },
        amber: {
          50: "#FCF2E1",
          400: "#E8A33D",
          600: "#B87A1F",
        },
        teal: {
          50: "#E7F1EF",
          500: "#0F6E63",
          600: "#0B5850",
        },
        danger: {
          50: "#FBEAE6",
          500: "#C23B22",
        },
        success: {
          50: "#E9F3EC",
          500: "#2E7D46",
        },
        info: {
          50: "#E9F0FA",
          500: "#2C6FBB",
        },
        violet: {
          50: "#F1ECF7",
          500: "#7B5EA7",
        },
      },
      fontFamily: {
        display: ["'Archivo Narrow'", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      clipPath: {
        tag: "polygon(0 0, 100% 0, 100% 70%, 92% 100%, 0 100%)",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(27,31,35,0.06), 0 1px 0 rgba(27,31,35,0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
