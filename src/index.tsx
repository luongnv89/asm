import React, { useCallback, useEffect, useMemo, useState } from "react";
import { render, Box, useApp, useInput, useStdout } from "ink";
import type {
  SkillInfo,
  Scope,
  SortBy,
  ViewState,
  AppConfig,
  AuditReport,
} from "./utils/types";
import { loadConfig, saveConfig, getConfigPath } from "./config";
import { scanAllSkills, searchSkills, sortSkills } from "./scanner";
import {
  buildFullRemovalPlan,
  buildRemovalPlan,
  executeRemoval,
  getExistingTargets,
} from "./uninstaller";
import { detectDuplicates } from "./auditor";
import { DashboardFooter, DashboardHeader } from "./views/dashboard";
import { SkillListView } from "./views/skill-list";
import { SkillDetailView } from "./views/skill-detail";
import { ConfirmView } from "./views/confirm";
import { HelpView } from "./views/help";
import { ConfigView } from "./views/config";
import { DuplicatesView } from "./views/duplicates";
import { parseEditorCommand } from "./utils/editor";

const EMPTY_AUDIT: AuditReport = {
  scannedAt: "",
  totalSkills: 0,
  duplicateGroups: [],
  totalDuplicateInstances: 0,
};

interface AppProps {
  initialConfig: AppConfig;
}

export function App({ initialConfig }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termHeight = stdout.rows ?? 24;

  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [allSkills, setAllSkills] = useState<SkillInfo[]>([]);
  const [scope, setScope] = useState<Scope>(
    initialConfig.preferences.defaultScope,
  );
  const [sort, setSort] = useState<SortBy>(
    initialConfig.preferences.defaultSort,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [view, setView] = useState<ViewState>("dashboard");
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [cursor, setCursor] = useState(0);
  const [confirmTargets, setConfirmTargets] = useState<string[]>([]);
  const [confirmSkill, setConfirmSkill] = useState<SkillInfo | null>(null);
  const [auditReport, setAuditReport] = useState<AuditReport>(EMPTY_AUDIT);

  // ── Derive filtered list ────────────────────────────────────────────────
  const filteredSkills = useMemo(() => {
    const searched = searchSkills(allSkills, searchQuery);
    return sortSkills(searched, sort);
  }, [allSkills, searchQuery, sort]);

  // Keep cursor in bounds
  useEffect(() => {
    if (cursor >= filteredSkills.length) {
      setCursor(Math.max(0, filteredSkills.length - 1));
    }
  }, [filteredSkills.length, cursor]);

  // ── Initial + scope change scan ─────────────────────────────────────────
  const refreshSkills = useCallback(async () => {
    const skills = await scanAllSkills(config, scope);
    setAllSkills(skills);
    setAuditReport(detectDuplicates(skills));
  }, [config, scope]);

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const cycleSortOrder = useCallback(() => {
    const orders: SortBy[] = ["name", "version", "location"];
    const idx = orders.indexOf(sort);
    setSort(orders[(idx + 1) % orders.length]);
  }, [sort]);

  const cycleScope = useCallback(() => {
    const scopes: Scope[] = ["global", "project", "both"];
    const idx = scopes.indexOf(scope);
    setScope(scopes[(idx + 1) % scopes.length]);
  }, [scope]);

  const showDetail = useCallback((skill: SkillInfo) => {
    setSelectedSkill(skill);
    setView("detail");
  }, []);

  const showConfirm = useCallback(
    async (skill: SkillInfo) => {
      const plan = buildFullRemovalPlan(skill.dirName, allSkills, config);
      const targets = await getExistingTargets(plan);
      setConfirmSkill(skill);
      setConfirmTargets(targets);
      setView("confirm");
    },
    [allSkills, config],
  );

  const handleConfirmResult = useCallback(
    async (confirmed: boolean) => {
      if (!confirmSkill) {
        setView("dashboard");
        return;
      }
      if (!confirmed) {
        setView("dashboard");
        return;
      }
      const plan = buildFullRemovalPlan(
        confirmSkill.dirName,
        allSkills,
        config,
      );
      await executeRemoval(plan);
      setConfirmSkill(null);
      setConfirmTargets([]);
      setView("dashboard");
      await refreshSkills();
    },
    [allSkills, config, confirmSkill, refreshSkills],
  );

  const handleConfigClose = useCallback(async (updatedConfig: AppConfig) => {
    await saveConfig(updatedConfig);
    setConfig(updatedConfig);
    setView("dashboard");
    // The config-change useEffect below re-runs refreshSkills with the new
    // config identity, so no manual rescan is required here.
  }, []);

  const handleConfigEditor = useCallback(async () => {
    // Exit the ink app to hand the terminal to $EDITOR, then let the process
    // die so the user re-runs asm with the updated config.
    const editorCmd = process.env.VISUAL || process.env.EDITOR || "vi";
    const [editorBin, editorArgs] = parseEditorCommand(editorCmd);
    const configPath = getConfigPath();
    exit();
    const { spawn: spawnProcess } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      const proc = spawnProcess(editorBin, [...editorArgs, configPath], {
        stdio: "inherit",
      });
      proc.on("close", () => resolve());
      proc.on("error", reject);
    });
    process.exit(0);
  }, [exit]);

  const showAudit = useCallback(async () => {
    // Always scan all providers regardless of current scope filter
    const allForAudit = await scanAllSkills(config, "both");
    setAuditReport(detectDuplicates(allForAudit));
    setView("audit");
  }, [config]);

  const handleDuplicatesRemove = useCallback(
    async (toRemove: SkillInfo[], keptSkill: SkillInfo) => {
      for (const skill of toRemove) {
        const plan = buildRemovalPlan(skill, config);
        await executeRemoval(plan, keptSkill.path);
      }
      setView("dashboard");
      await refreshSkills();
    },
    [config, refreshSkills],
  );

  // ── Keyboard handling ───────────────────────────────────────────────────
  useInput(
    (input, key) => {
      // Search mode owns its keyboard via the TextInput component — we only
      // intercept Escape to bail out early.
      if (searchMode) {
        if (key.escape) {
          setSearchMode(false);
          setSearchQuery("");
          return;
        }
        return;
      }

      // Global: quit
      if (input === "q" && view === "dashboard") {
        exit();
        return;
      }

      if (key.escape) {
        if (view === "help" || view === "detail" || view === "confirm") {
          setView("dashboard");
          return;
        }
        // config + audit views own their own Escape handling
        return;
      }

      if (input === "?") {
        if (view === "help") {
          setView("dashboard");
        } else if (view === "dashboard") {
          setView("help");
        }
        return;
      }

      if (view === "dashboard") {
        if (input === "/") {
          setSearchMode(true);
          return;
        }
        if (input === "s" && !key.ctrl) {
          cycleSortOrder();
          return;
        }
        if (input === "r" && !key.ctrl) {
          refreshSkills();
          return;
        }
        if (input === "c" && !key.ctrl) {
          setView("config");
          return;
        }
        if (key.tab) {
          cycleScope();
          return;
        }
        if (input === "a" && !key.ctrl) {
          showAudit();
          return;
        }
        if (input === "d") {
          const skill = filteredSkills[cursor];
          if (skill) showConfirm(skill);
          return;
        }
        if (key.upArrow) {
          setCursor((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setCursor((i) => Math.min(filteredSkills.length - 1, i + 1));
          return;
        }
        if (input === "k") {
          setCursor((i) => Math.max(0, i - 1));
          return;
        }
        if (input === "j") {
          setCursor((i) => Math.min(filteredSkills.length - 1, i + 1));
          return;
        }
        if (key.pageUp) {
          setCursor((i) => Math.max(0, i - 10));
          return;
        }
        if (key.pageDown) {
          setCursor((i) => Math.min(filteredSkills.length - 1, i + 10));
          return;
        }
        if (key.return) {
          const skill = filteredSkills[cursor];
          if (skill) showDetail(skill);
          return;
        }
      }

      if (view === "detail") {
        if (input === "d") {
          if (selectedSkill) showConfirm(selectedSkill);
          return;
        }
      }
    },
    // config and audit views own their own keyboard handling; leave confirm
    // attached so the global Esc-to-dashboard branch reaches it (the ui-kit
    // Select in ConfirmView only binds arrows + Enter).
    { isActive: view !== "config" && view !== "audit" },
  );

  // ── Compute visible skill-list height (rough heuristic) ─────────────────
  // Dashboard chrome (banner 6 + stats 3 + tabs 1 + search 3 + footer 1) ≈ 14
  const chromeRows = 14;
  const visibleListRows = Math.max(5, termHeight - chromeRows - 4);

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {view === "dashboard" && (
        <>
          <DashboardHeader
            config={config}
            skills={allSkills}
            duplicateCount={auditReport.duplicateGroups.length}
            sort={sort}
            scope={scope}
            searchMode={searchMode}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearchSubmit={(v) => {
              setSearchQuery(v);
              setSearchMode(false);
            }}
          />
          <SkillListView
            skills={filteredSkills}
            selectedIndex={cursor}
            visibleCount={visibleListRows}
            termWidth={termWidth}
          />
          <DashboardFooter />
        </>
      )}
      {view === "detail" && selectedSkill && (
        <SkillDetailView skill={selectedSkill} />
      )}
      {view === "confirm" && confirmSkill && (
        <ConfirmView
          skill={confirmSkill}
          targets={confirmTargets}
          onResult={handleConfirmResult}
        />
      )}
      {view === "help" && <HelpView />}
      {view === "config" && (
        <ConfigView
          config={config}
          onClose={handleConfigClose}
          onOpenEditor={handleConfigEditor}
        />
      )}
      {view === "audit" && (
        <DuplicatesView
          report={auditReport}
          onRemove={handleDuplicatesRemove}
          onClose={() => setView("dashboard")}
        />
      )}
    </Box>
  );
}

async function main() {
  const config = await loadConfig();

  // Match the opentui `useAlternateScreen: true` behavior — draw the TUI in
  // the alternate screen buffer so the dashboard doesn't pollute the user's
  // shell scrollback after quit.
  const ENTER_ALT_SCREEN = "\x1b[?1049h";
  const LEAVE_ALT_SCREEN = "\x1b[?1049l";

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write(LEAVE_ALT_SCREEN);
  };
  process.on("exit", restore);
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restore();
    process.exit(143);
  });

  process.stdout.write(ENTER_ALT_SCREEN);
  try {
    const instance = render(<App initialConfig={config} />);
    await instance.waitUntilExit();
  } finally {
    restore();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
