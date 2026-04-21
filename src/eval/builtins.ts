import { registerBuiltins } from "./providers";
import {
  list as listEvalProviders,
  resolve as resolveEvalProvider,
} from "./registry";

let builtinsRegistered = false;

export function ensureEvalBuiltins(): void {
  if (builtinsRegistered) return;
  registerBuiltins();
  builtinsRegistered = true;
}

export function getEvalProviders() {
  ensureEvalBuiltins();
  return listEvalProviders();
}

export function getEvalProvider(id: string, range: string) {
  ensureEvalBuiltins();
  return resolveEvalProvider(id, range);
}
