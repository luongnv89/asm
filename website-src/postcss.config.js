import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: [
    tailwindcss({ config: resolve(here, "tailwind.config.js") }),
    autoprefixer(),
  ],
};
