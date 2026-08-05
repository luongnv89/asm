import { evalScoreClass } from "../lib/utils.js";

function scoreColor(scoreClass) {
  if (scoreClass === "eval-a") return "text-emerald-700 dark:text-emerald-400";
  if (scoreClass === "eval-b") return "text-lime-700 dark:text-lime-400";
  if (scoreClass === "eval-c") return "text-yellow-700 dark:text-yellow-400";
  if (scoreClass === "eval-d") return "text-orange-700 dark:text-orange-400";
  return "text-red-700 dark:text-red-400";
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
          <span className="text-base text-[var(--fg-dim)]">/100</span>
        </span>
        <span className="text-sm text-[var(--fg-dim)]">
          grade {summary.grade}
        </span>
      </div>
      {summary.evaluatedAt && (
        <div className="text-xs text-[var(--fg-dim)]">
          Evaluated {new Date(summary.evaluatedAt).toLocaleDateString()}
          {summary.evaluatedVersion ? ` · v${summary.evaluatedVersion}` : ""}
        </div>
      )}
      {summary.categories?.length > 0 && (
        <table className="w-full text-xs">
          <caption className="sr-only">Evaluation score breakdown</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Percentage</th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {summary.categories.map((category) => {
              const percent =
                category.max > 0
                  ? Math.round((category.score / category.max) * 100)
                  : 0;
              return (
                <tr key={category.id}>
                  <th
                    scope="row"
                    className="py-1 text-left font-normal text-[var(--fg-dim)] pr-2 align-middle"
                  >
                    {category.name}
                  </th>
                  <td className="w-full align-middle">
                    <span className="sr-only">{percent}%</span>
                    <div
                      aria-hidden="true"
                      className="h-1.5 rounded bg-[var(--bg-input)] overflow-hidden"
                    >
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
