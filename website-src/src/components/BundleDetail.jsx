import { Link } from "react-router-dom";
import { Layers, ShoppingCart } from "lucide-react";
import { encodeSkillId } from "../lib/utils.js";
import { useBundleCart } from "../hooks/useBundleCart.jsx";
import AddToCartButton from "./AddToCartButton.jsx";
import CopyButton from "./CopyButton.jsx";
import { Badge } from "./ui/badge.jsx";

/**
 * Product page for a curated bundle: description and the list of
 * included skills on the left, a sticky buy box on the right with the
 * install command and an "Add all to cart" action. Each included skill
 * can also be added on its own.
 *
 * Props:
 *   - bundle: a row from bundles.json#bundles (required)
 */
export default function BundleDetail({ bundle }) {
  const { addMany, has } = useBundleCart();
  if (!bundle) return null;
  const skills = bundle.skills || [];
  const tags = bundle.tags || [];
  const installCmd = "asm bundle install " + (bundle.name || "");
  const cartable = skills.filter((s) => s.id && s.installUrl);
  const allInCart = cartable.length > 0 && cartable.every((s) => has(s.id));

  return (
    <div className="shop grid gap-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] items-start">
      <div className="flex flex-col gap-6 min-w-0">
        <header className="flex flex-col gap-3">
          <div className="shop-kicker">
            <span className="dot" aria-hidden="true" />
            Bundle{bundle.author ? ` · by ${bundle.author}` : ""}
          </div>
          <h1 className="shop-product-title">{bundle.name}</h1>
          {bundle.description && (
            <p className="shop-lede">{bundle.description}</p>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} tone="cat">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </header>

        <section className="flex flex-col gap-2">
          <h2 className="shop-label">Included skills ({skills.length})</h2>
          {skills.length === 0 ? (
            <p className="text-sm text-[var(--fg-dim)]">
              No skills in this bundle.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {skills.map((sk) => {
                const skillInstall =
                  sk.installUrl && "asm install " + sk.installUrl;
                return (
                  <li
                    key={sk.id || sk.installUrl || sk.name}
                    className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {sk.id ? (
                          <Link
                            to={`/skills/${encodeSkillId(sk.id)}`}
                            className="min-h-11 min-w-11 -m-2 px-2 inline-flex items-center font-mono text-sm text-[var(--fg)] hover:text-[var(--brand)] transition-colors"
                          >
                            {sk.name}
                          </Link>
                        ) : (
                          <span className="font-mono text-sm text-[var(--fg)]">
                            {sk.name}
                          </span>
                        )}
                        {sk.description && (
                          <p className="text-xs text-[var(--fg-dim)] mt-1 leading-relaxed">
                            {sk.description}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {skillInstall && (
                          <CopyButton
                            text={skillInstall}
                            size="sm"
                            label="copy"
                            ariaLabel={`Copy install command for ${sk.name}`}
                          />
                        )}
                        <AddToCartButton skill={sk} variant="row" />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <aside className="shop-buybox" aria-label="Install this bundle">
        <div>
          <div className="shop-label">Bundle size</div>
          <div className="shop-price">
            {skills.length}
            <small>{skills.length === 1 ? "skill" : "skills"}</small>
          </div>
        </div>
        <ul className="shop-facts">
          <li>
            <span>Price</span>
            <span>free · open source</span>
          </li>
          <li>
            <span>Installs as</span>
            <span>one command</span>
          </li>
          {bundle.author && (
            <li>
              <span>Curated by</span>
              <span>{bundle.author}</span>
            </li>
          )}
        </ul>
        <div className="flex flex-col gap-1.5">
          <div className="shop-label">Install</div>
          <div className="shop-cmd">
            <span className="prompt" aria-hidden="true">
              $
            </span>
            <code>{installCmd}</code>
            <CopyButton
              text={installCmd}
              size="sm"
              ariaLabel="Copy bundle install command"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => addMany(cartable, bundle.name)}
          disabled={cartable.length === 0}
          aria-label={`Add all ${cartable.length} skills from ${bundle.name} to cart`}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--brand)] bg-[var(--brand)] px-4 text-sm font-medium text-[var(--bg)] transition-colors hover:bg-[var(--brand-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
        >
          {allInCart ? (
            <>
              <Layers className="h-4 w-4" aria-hidden="true" />
              All in cart
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              Add all to cart
            </>
          )}
        </button>
        <p className="shop-meta -mt-2">
          Mix these with other skills, then export your own bundle.
        </p>
      </aside>
    </div>
  );
}
