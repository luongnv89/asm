import { evalScoreClass } from "../lib/utils.js";

function scoreColor(scoreClass) {
  if (scoreClass === "eval-a") return "text-emerald-400";
  if (scoreClass === "eval-b") return "text-lime-400";
  if (scoreClass === "eval-c") return "text-yellow-400";
  if (scoreClass === "eval-d") return "text-orange-400";
  return "text-red-400";
}

function barColor(scoreClass) {
  if (scoreClass === "eval-a") return "bg-emerald-500";
  if (scoreClass === "eval-b") return "bg-lime-500";
  if (scoreClass === "eval-c") return "bg-yellow-500";
  if (scoreClass === "eval-d") return "bg-orange-500";
  return "bg-red-500";
}

/** Render the canonical overall score and complete per-category breakdown. */
export default function EvalScoreBreakdown({ summary }) {
  if (!summary) return null;
  const overallTone = evalScoreClass(summary.overallScore);

  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-center gap-3 ${scoreColor(overallTone)}`}>
        <span className="text-3xl font-semibold">
          {summary.overallScore}
          <span className="text-base text-[var(--fg-muted)]">/100</span>
        </span>
        <span className="text-sm text-[var(--fg-dim)]">
          grade {summary.grade}
        </span>
      </div>
      {summary.evaluatedAt && (
        <div className="text-xs text-[var(--fg-muted)]">
          Evaluated {new Date(summary.evaluatedAt).toLocaleDateString()}
          {summary.evaluatedVersion ? ` · v${summary.evaluatedVersion}` : ""}
        </div>
      )}
      {summary.categories?.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {summary.categories.map((category) => {
              const percent =
                category.max > 0
                  ? Math.round((category.score / category.max) * 100)
                  : 0;
              return (
                <tr key={category.id}>
                  <td className="py-1 text-[var(--fg-dim)] pr-2 align-middle">
                    {category.name}
                  </td>
                  <td className="w-full align-middle">
                    <div className="h-1.5 rounded bg-[var(--bg-input)] overflow-hidden">
                      <div
                        className={`h-full ${barColor(evalScoreClass(percent))}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </td>
                  <td className="pl-2 text-right text-[var(--fg-dim)] whitespace-nowrap align-middle">
                    {category.score}/{category.max}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
