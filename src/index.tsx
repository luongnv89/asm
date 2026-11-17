import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import { Spinner } from "@inkjs/ui";
import type {
  SkillInfo,
  Scope,
  SortBy,
  ViewState,
  AppConfig,
  AuditReport,
} from "./utils/types";
import type { LibrarySkillInfo } from "./library-core";
import { loadConfig, saveConfig, getConfigPath } from "./config";
import { scanAllSkills, searchSkills, sortSkills } from "./scanner";
import {
  buildFullRemovalPlan,
  buildRemovalPlan,
  executeRemoval,
  getExistingTargets,
} from "./uninstaller";
import { detectDuplicates } from "./auditor";
import { activateLibrarySkill, listLibrarySkills } from "./library";
import { buildGhostSkills } from "./ghost-skills";
import {
  buildLinkOptions,
  LinkModal,
  type LinkTargetOption,
} from "./views/link-modal";
import { DashboardFooter, DashboardHeader } from "./views/dashboard";
import { SkillListView } from "./views/skill-list";
import { SkillDetailView } from "./views/skill-detail";
import { ConfirmView } from "./views/confirm";
import { HelpView } from "./views/help";
import { ConfigView } from "./views/config";
import { DuplicatesView } from "./views/duplicates";
import { parseEditorCommand } from "./utils/editor";
import { theme } from "./utils/colors";
import { stripControlBytes } from "./utils/control-chars";

const EMPTY_AUDIT: AuditReport = {
  scannedAt: "",
  totalSkills: 0,
  duplicateGroups: [],
  totalDuplicateInstances: 0,
};

// Matches main()'s `useAlternateScreen: true` behavior. The escape leaves
// the alt-screen buffer; callers handing the terminal off to a child
// process (e.g. $EDITOR) emit this synchronously so the child doesn't
// render on top of the stale TUI frame.
export const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const ENTER_ALT_SCREEN = "\x1b[?1049h";

interface AppProps {
  initialConfig: AppConfig;
}

export function App({ initialConfig }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termWidth = stdout.columns ?? 80;
  const termHeight = stdout.rows ?? 24;

  const [config, setConfig] = useState<AppConfig>(initialConfig);
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
  const [installedSkills, setInstalledSkills] = useState<SkillInfo[]>([]);
  const [ghostSkills, setGhostSkills] = useState<SkillInfo[]>([]);
  const [linkSkill, setLinkSkill] = useState<SkillInfo | null>(null);

  // ── TUI state: loading, error banner, feedback flash ────────────────────
  const scanGenRef = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [bannerError, setBannerError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const isMountedRef = useRef(true);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const flash = useCallback((msg: string, durationMs = 1200) => {
    if (!isMountedRef.current) return;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFeedback(msg);
    flashTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setFeedback(null);
      flashTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const allSkills = useMemo(
    () => [...installedSkills, ...ghostSkills],
    [installedSkills, ghostSkills],
  );

  // ── Derive filtered list ────────────────────────────────────────────────
  // Installed skills first, library ghosts grouped after them; each group
  // keeps the user's chosen sort order.
  const filteredSkills = useMemo(() => {
    const searched = searchSkills(allSkills, searchQuery);
    const sorted = sortSkills(searched, sort);
    return [
      ...sorted.filter((s) => !s.isGhost),
      ...sorted.filter((s) => s.isGhost),
    ];
  }, [allSkills, searchQuery, sort]);

  // Keep cursor in bounds
  useEffect(() => {
    if (cursor >= filteredSkills.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clamp cursor when the filtered list shrinks
      setCursor(Math.max(0, filteredSkills.length - 1));
    }
  }, [filteredSkills.length, cursor]);

  // ── Initial + scope change scan ─────────────────────────────────────────
  const refreshSkills = useCallback(async () => {
    const gen = ++scanGenRef.current;
    setScanning(true);
    try {
      const [skills, library] = await Promise.all([
        scanAllSkills(config, scope),
        scope === "both"
          ? Promise.resolve([] as LibrarySkillInfo[])
          : listLibrarySkills().catch(() => [] as LibrarySkillInfo[]),
      ]);
      if (gen !== scanGenRef.current) return;
      const ghosts = await buildGhostSkills(library, skills, scope);
      if (gen !== scanGenRef.current) return;
      setInstalledSkills(skills);
      setGhostSkills(ghosts);
      setAuditReport(detectDuplicates(skills));
      setHasScanned(true);
      setBannerError((prev) => (prev?.title === "Scan failed" ? null : prev));
    } catch (err) {
      if (gen !== scanGenRef.current) return;
      setInstalledSkills([]);
      setGhostSkills([]);
      setAuditReport(EMPTY_AUDIT);
      setBannerError({
        title: "Scan failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (isMountedRef.current && gen === scanGenRef.current) {
        setScanning(false);
      }
    }
  }, [config, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: trigger initial + scope-change scan
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
      if (skill.isGhost) return;
      const plan = buildFullRemovalPlan(skill.dirName, installedSkills, config);
      const targets = await getExistingTargets(plan);
      setConfirmSkill(skill);
      setConfirmTargets(targets);
      setView("confirm");
    },
    [installedSkills, config],
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
        installedSkills,
        config,
      );
      await executeRemoval(plan);
      setConfirmSkill(null);
      setConfirmTargets([]);
      setView("dashboard");
      await refreshSkills();
    },
    [installedSkills, config, confirmSkill, refreshSkills],
  );

  const showLink = useCallback(
    (skill?: SkillInfo) => {
      if (scope !== "project" && scope !== "global") return;
      const target = skill ?? filteredSkills[cursor];
      if (target?.isGhost) {
        setLinkSkill(target);
        setView("link");
      }
    },
    [cursor, filteredSkills, scope],
  );

  const handleLinkSelect = useCallback(
    async (option: LinkTargetOption) => {
      if (!linkSkill) return;
      const targetSkill = linkSkill;
      try {
        await activateLibrarySkill({
          libraryPath: targetSkill.path,
          targetDir: option.targetDir,
          activationName: targetSkill.dirName,
          force: false,
        });
        if (!isMountedRef.current) return;
        setBannerError((prev) => (prev?.title === "Link failed" ? null : prev));
        flash("Linked!");
        setLinkSkill(null);
        setView("dashboard");
        await refreshSkills();
      } catch (err) {
        if (!isMountedRef.current) return;
        setBannerError({
          title: "Link failed",
          message: err instanceof Error ? err.message : String(err),
        });
        setLinkSkill(null);
        setView("dashboard");
      }
    },
    [flash, linkSkill, refreshSkills],
  );

  const handleLinkCancel = useCallback(() => {
    setLinkSkill(null);
    setView("dashboard");
  }, []);

  const handleConfigClose = useCallback(async (updatedConfig: AppConfig) => {
    await saveConfig(updatedConfig);
    setConfig(updatedConfig);
    setView("dashboard");
    // The config-change useEffect below re-runs refreshSkills with the new
    // config identity, so no manual rescan is required here.
  }, []);

  const handleConfigDiscard = useCallback(() => {
    // q in the config view: drop in-session toggles — nothing is persisted.
    setView("dashboard");
  }, []);

  const handleConfigEditor = useCallback(async () => {
    // Exit the ink app to hand the terminal to $EDITOR, then let the process
    // die so the user re-runs asm with the updated config.
    const editorCmd = process.env.VISUAL || process.env.EDITOR || "vi";
    const [editorBin, editorArgs] = parseEditorCommand(editorCmd);
    const configPath = getConfigPath();
    exit();
    // Leave the alternate-screen buffer synchronously before spawning the
    // editor. Without this, a non-alt-screen editor (cat, less, micro, GUI
    // wrappers) may render on top of the stale TUI frame because main()'s
    // `finally { restore() }` only runs after waitUntilExit() resolves.
    process.stdout.write(LEAVE_ALT_SCREEN);
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
        if (
          view === "help" ||
          view === "detail" ||
          view === "confirm" ||
          view === "link"
        ) {
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
          flash("Updated!", 1000);
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
        if (input === "l") {
          showLink();
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
        if (input === "l" && selectedSkill?.isGhost) {
          showLink(selectedSkill);
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
  const chromeRows = 14 + (bannerError ? 4 : 0);
  const visibleListRows = Math.max(2, termHeight - chromeRows - 4);

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {view === "dashboard" && (
        <>
          {scanning && !hasScanned && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={theme.border}
              paddingX={1}
              paddingY={1}
            >
              <Spinner label="Scanning skills..." />
            </Box>
          )}
          {bannerError && (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={theme.red}
              paddingX={1}
            >
              <Text color={theme.red} bold>
                {stripControlBytes(bannerError.title)}:{" "}
                {bannerError.message
                  .split("\n")
                  .map(stripControlBytes)
                  .join("\n")}
              </Text>
            </Box>
          )}
          <DashboardHeader
            config={config}
            skills={installedSkills}
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
            hasScanned={hasScanned}
            searchQuery={searchQuery}
          />
          <DashboardFooter
            feedback={feedback}
            scanning={scanning}
            hasScanned={hasScanned}
          />
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
          onDiscard={handleConfigDiscard}
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
      {view === "link" && linkSkill && (
        <LinkModal
          skillName={linkSkill.name}
          scope={scope === "both" ? "project" : scope}
          options={buildLinkOptions(
            config.providers,
            scope === "both" ? "project" : scope,
          )}
          onSelect={handleLinkSelect}
          onCancel={handleLinkCancel}
        />
      )}
    </Box>
  );
}

export async function main() {
  const config = await loadConfig();

  if (!process.stdin.isTTY) {
    console.error(
      'asm: the interactive TUI requires a terminal (stdin is not a TTY). Run "asm --help" for CLI usage.',
    );
    process.exitCode = 1;
    return;
  }

  // Match the opentui `useAlternateScreen: true` behavior — draw the TUI in
  // the alternate screen buffer so the dashboard doesn't pollute the user's
  // shell scrollback after quit. The escape constants are module-scoped so
  // handleConfigEditor can emit LEAVE_ALT_SCREEN before spawning $EDITOR.
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
