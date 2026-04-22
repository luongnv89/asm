import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Tailwind config for the React site.
 *
 * Content globs must be absolute (not relative) because Vite runs tailwind
 * from the repo root, not from `website-src/`. Relative globs produced the
 * infamous "content missing" warning and shipped a stylesheet without any
 * utility classes.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: [resolve(here, "app.html"), resolve(here, "src/**/*.{js,jsx}")],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {},
  },
  plugins: [],
};
