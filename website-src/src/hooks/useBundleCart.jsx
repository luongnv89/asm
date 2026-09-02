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
 * The cart is the storefront's shopping cart: skills are added from
 * cards, product pages, and bundles ("add all"), then "checked out" as
 * an installable bundle from the cart drawer.
 *
 * Persistence key is versioned (`asm-bundle-cart:v1`) so a future
 * schema change can migrate instead of silently corrupting older
 * carts. Reads are guarded against localStorage exceptions (Safari
 * private mode, quota errors, server-side render).
 *
 * `notice` is a transient "added to cart" message consumed by the
 * toast; it is never persisted.
 */
const STORAGE_KEY = "asm-bundle-cart:v1";

const BundleCartContext = createContext({
  items: [],
  meta: { name: "", description: "", author: "", tags: "" },
  notice: null,
  add: () => {},
  addMany: () => 0,
  remove: () => {},
  clear: () => {},
  setMeta: () => {},
  has: () => false,
  dismissNotice: () => {},
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

function toCartItem(skill) {
  return {
    id: skill.id,
    name: skill.name,
    installUrl: skill.installUrl,
    description: skill.description || "",
    version: skill.version || "",
    owner: skill.owner || "",
    repo: skill.repo || "",
  };
}

export function BundleCartProvider({ children }) {
  const [items, setItems] = useState(() => loadInitial().items);
  const [meta, setMetaState] = useState(() => loadInitial().meta);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, meta }));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [items, meta]);

  const ids = useMemo(() => new Set(items.map((s) => s.id)), [items]);
  const has = useCallback((id) => ids.has(id), [ids]);

  const add = useCallback(
    (skill) => {
      if (!skill || !skill.id || !skill.installUrl) return;
      if (ids.has(skill.id)) return;
      setItems((prev) => [...prev, toCartItem(skill)]);
      setNotice({ ts: Date.now(), text: `${skill.name} added to cart` });
    },
    [ids],
  );

  /** Add every valid, not-yet-carted skill; returns how many were added. */
  const addMany = useCallback(
    (skills, label) => {
      const fresh = (skills || []).filter(
        (s) => s && s.id && s.installUrl && !ids.has(s.id),
      );
      if (fresh.length === 0) {
        setNotice({
          ts: Date.now(),
          text: label
            ? `Everything in ${label} is already in your cart`
            : "Already in your cart",
        });
        return 0;
      }
      setItems((prev) => [...prev, ...fresh.map(toCartItem)]);
      setNotice({
        ts: Date.now(),
        text: `${fresh.length} ${fresh.length === 1 ? "skill" : "skills"} added to cart${label ? ` from ${label}` : ""}`,
      });
      return fresh.length;
    },
    [ids],
  );

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const setMeta = useCallback((patch) => {
    setMetaState((prev) => ({ ...prev, ...patch }));
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(
    () => ({
      items,
      meta,
      notice,
      add,
      addMany,
      remove,
      clear,
      setMeta,
      has,
      dismissNotice,
    }),
    [
      items,
      meta,
      notice,
      add,
      addMany,
      remove,
      clear,
      setMeta,
      has,
      dismissNotice,
    ],
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
