import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * Bundle cart state + localStorage persistence (#238). Mirrors the
 * `useCatalog` context pattern so consumers can subscribe from any
 * route without prop-drilling.
 *
 * Persistence key is versioned (`asm-bundle-cart:v1`) so a future
 * schema change can migrate instead of silently corrupting older
 * carts. Reads are guarded against localStorage exceptions (Safari
 * private mode, quota errors, server-side render).
 */
const STORAGE_KEY = "asm-bundle-cart:v1";

const BundleCartContext = createContext({
  items: [],
  meta: { name: "", description: "", author: "", tags: "" },
  add: () => {},
  remove: () => {},
  clear: () => {},
  setMeta: () => {},
  has: () => false,
});

const DEFAULT_META = { name: "", description: "", author: "", tags: "" };

function loadInitial() {
  if (typeof localStorage === "undefined") {
    return { items: [], meta: { ...DEFAULT_META } };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], meta: { ...DEFAULT_META } };
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items)
      ? parsed.items.filter(isValidCartItem)
      : [];
    const meta =
      parsed?.meta && typeof parsed.meta === "object"
        ? {
            name: stringField(parsed.meta.name),
            description: stringField(parsed.meta.description),
            author: stringField(parsed.meta.author),
            tags: stringField(parsed.meta.tags),
          }
        : { ...DEFAULT_META };
    return { items, meta };
  } catch {
    return { items: [], meta: { ...DEFAULT_META } };
  }
}

function stringField(v) {
  return typeof v === "string" ? v : "";
}

function isValidCartItem(item) {
  return (
    item &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.installUrl === "string"
  );
}

export function BundleCartProvider({ children }) {
  const [items, setItems] = useState(() => loadInitial().items);
  const [meta, setMetaState] = useState(() => loadInitial().meta);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, meta }));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [items, meta]);

  const add = useCallback((skill) => {
    if (!skill || !skill.id) return;
    setItems((prev) => {
      if (prev.some((s) => s.id === skill.id)) return prev;
      return [
        ...prev,
        {
          id: skill.id,
          name: skill.name,
          installUrl: skill.installUrl,
          description: skill.description || "",
          version: skill.version || "",
          owner: skill.owner || "",
          repo: skill.repo || "",
        },
      ];
    });
  }, []);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const setMeta = useCallback((patch) => {
    setMetaState((prev) => ({ ...prev, ...patch }));
  }, []);

  const ids = useMemo(() => new Set(items.map((s) => s.id)), [items]);
  const has = useCallback((id) => ids.has(id), [ids]);

  const value = useMemo(
    () => ({ items, meta, add, remove, clear, setMeta, has }),
    [items, meta, add, remove, clear, setMeta, has],
  );

  return (
    <BundleCartContext.Provider value={value}>
      {children}
    </BundleCartContext.Provider>
  );
}

export function useBundleCart() {
  return useContext(BundleCartContext);
}
