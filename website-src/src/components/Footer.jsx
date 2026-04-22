import { useCatalog } from "../hooks/useCatalog.jsx";
import CopyButton from "./CopyButton.jsx";

export default function Footer() {
  const { catalog } = useCatalog();
  const generatedAt = catalog?.generatedAt
    ? new Date(catalog.generatedAt).toLocaleDateString()
    : "";

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-card)] text-[var(--fg-dim)] text-xs">
      <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-2">
        <a
          className="text-[var(--fg)] hover:text-[var(--brand)]"
          href="https://github.com/luongnv89/agent-skill-manager"
          target="_blank"
          rel="noopener noreferrer"
        >
          agent-skill-manager
        </a>
        <span>— Install:</span>
        <code className="px-2 py-0.5 rounded bg-[var(--bg-input)] text-[var(--brand)]">
          npm i -g agent-skill-manager
        </code>
        <CopyButton text="npm i -g agent-skill-manager" size="sm" />
        {generatedAt && (
          <span className="ml-auto">Catalog generated {generatedAt}</span>
        )}
      </div>
    </footer>
  );
}
