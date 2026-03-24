import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SearchBar } from "../components/SearchBar";
import { SkillCard } from "../components/SkillCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Toast } from "../components/Toast";
import {
  installSkill,
  getSkillIndex,
  listInstalledSkills,
  parseSkillsFromJson,
  securityAudit,
  CATEGORIES,
  type Skill,
} from "../lib/tauri-commands";

type SortOption = "name" | "category" | "relevance";

export function Catalog() {
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [showSecurityWarning, setShowSecurityWarning] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const navigate = useNavigate();

  const loadSkillIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [indexResult, installedResult] = await Promise.all([
        getSkillIndex(),
        listInstalledSkills(),
      ]);

      let installedNames = new Set<string>();
      if (installedResult.success) {
        const installedSkills = parseSkillsFromJson(installedResult.stdout);
        installedSkills.forEach((s) => installedNames.add(s.name));
      }

      if (indexResult.success) {
        const parsed = parseSkillsFromJson(indexResult.stdout);
        const skillsWithInstalledState = parsed.map((s) => ({
          ...s,
          installed: installedNames.has(s.name),
        }));
        setAllSkills(skillsWithInstalledState);
      } else {
        setError("Failed to load skill index: " + indexResult.stderr);
      }
    } catch (err) {
      setError("Error loading skill index: " + String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkillIndex();
    const handleFocus = () => loadSkillIndex();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSkillIndex]);

  const filteredAndSortedSkills = useMemo(() => {
    let filtered = [...allSkills];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          (s.description && s.description.toLowerCase().includes(query)),
      );
    }

    if (category !== "all") {
      filtered = filtered.filter((s) => s.category === category);
    }

    if (sortBy === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "category") {
      filtered.sort((a, b) =>
        (a.category || "").localeCompare(b.category || ""),
      );
    } else if (sortBy === "relevance") {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered.sort((a, b) => {
          const aExact = a.name.toLowerCase() === query ? 0 : 1;
          const bExact = b.name.toLowerCase() === query ? 0 : 1;
          return aExact - bExact;
        });
      }
    }

    return filtered;
  }, [allSkills, searchQuery, category, sortBy]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  const handleInstall = async (name: string) => {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      setError("Invalid skill name");
      return;
    }
    const sanitized = name.trim().replace(/[^a-zA-Z0-9\-_]/g, "");
    if (sanitized !== name) {
      setError("Skill name contains invalid characters");
      return;
    }

    setPendingInstall(sanitized);
    setShowSecurityWarning(true);
  };

  const confirmInstall = async () => {
    if (!pendingInstall) return;

    setShowSecurityWarning(false);
    setInstallingSkill(pendingInstall);
    setError(null);

    try {
      const auditResult = await securityAudit(pendingInstall);
      if (!auditResult.success) {
        setError("Security audit failed: " + auditResult.stderr);
        setInstallingSkill(null);
        setPendingInstall(null);
        return;
      }

      const result = await installSkill(pendingInstall);
      if (result.success) {
        setAllSkills((prev) =>
          prev.map((s) =>
            s.name === pendingInstall ? { ...s, installed: true } : s,
          ),
        );
        setToast({
          message: `${pendingInstall} installed successfully!`,
          type: "success",
        });
      } else {
        const errorMsg = result.stderr || "Install failed";
        if (errorMsg.includes("already installed")) {
          setAllSkills((prev) =>
            prev.map((s) =>
              s.name === pendingInstall ? { ...s, installed: true } : s,
            ),
          );
        } else {
          setError("Install failed: " + errorMsg);
        }
      }
    } catch (err) {
      setError("Install error: " + String(err));
    } finally {
      setInstallingSkill(null);
      setPendingInstall(null);
    }
  };

  const cancelInstall = () => {
    setShowSecurityWarning(false);
    setPendingInstall(null);
  };

  const handleSelect = (skill: Skill) => {
    navigate(`/skill/${encodeURIComponent(skill.name)}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Skill Catalog</h2>
        <SearchBar onSearch={handleSearch} placeholder="Search skills..." />
      </div>

      <div className="filters-bar">
        <select
          className="filter-select"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
        >
          <option value="name">Sort by Name</option>
          <option value="category">Sort by Category</option>
          <option value="relevance">Sort by Relevance</option>
        </select>

        <span className="skills-count">
          {filteredAndSortedSkills.length} skills
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">Loading skills...</div>
      ) : (
        <div className="skills-grid">
          {filteredAndSortedSkills.length === 0 ? (
            <p className="empty-state">No skills found</p>
          ) : (
            filteredAndSortedSkills.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onInstall={handleInstall}
                onSelect={handleSelect}
                isInstalling={installingSkill === skill.name}
              />
            ))
          )}
        </div>
      )}

      {showSecurityWarning && (
        <ConfirmDialog
          title="Security Warning"
          message={`This skill "${pendingInstall}" will be installed to your system. The install process will clone the repository and copy files to ~/.claude/skills/. Do you want to proceed?`}
          confirmLabel="Install"
          cancelLabel="Cancel"
          onConfirm={confirmInstall}
          onCancel={cancelInstall}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
