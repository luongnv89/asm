import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { SkillCard } from "../components/SkillCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Toast } from "../components/Toast";
import {
  listInstalledSkills,
  uninstallSkill,
  parseSkillsFromJson,
  isSkillSymlink,
  type Skill,
} from "../lib/tauri-commands";

type SortOption = "name" | "date";

export function Installed() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [showConfirm, setShowConfirm] = useState(false);
  const [skillToRemove, setSkillToRemove] = useState<string | null>(null);
  const [uninstallingSkill, setUninstallingSkill] = useState<string | null>(
    null,
  );
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const navigate = useNavigate();

  const loadInstalledSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listInstalledSkills();
      if (result.success) {
        const parsed = parseSkillsFromJson(result.stdout);
        setSkills(parsed.map((s) => ({ ...s, installed: true })));
      } else {
        setError("Failed to load installed skills: " + result.stderr);
      }
    } catch (err) {
      setError("Error loading installed skills: " + String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstalledSkills();
    const handleFocus = () => loadInstalledSkills();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadInstalledSkills]);

  const sortedSkills = useMemo(() => {
    const sorted = [...skills];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "date") {
      sorted.sort((a, b) => (b.path || "").localeCompare(a.path || ""));
    }
    return sorted;
  }, [skills, sortBy]);

  const handleUninstall = (name: string) => {
    setSkillToRemove(name);
    setShowConfirm(true);
  };

  const confirmUninstall = async () => {
    if (!skillToRemove) return;

    setShowConfirm(false);
    setUninstallingSkill(skillToRemove);
    setError(null);

    try {
      const isSymlink = await isSkillSymlink(skillToRemove);
      if (isSymlink) {
        setError(
          "Cannot uninstall: this is a symlink. Please remove it manually.",
        );
        setUninstallingSkill(null);
        setSkillToRemove(null);
        return;
      }

      const result = await uninstallSkill(skillToRemove);
      if (result.success) {
        setSkills((prev) => prev.filter((s) => s.name !== skillToRemove));
        setToast({
          message: `${skillToRemove} removed successfully!`,
          type: "success",
        });
      } else {
        const errorMsg = result.stderr || "Uninstall failed";
        if (errorMsg.includes("not installed")) {
          setSkills((prev) => prev.filter((s) => s.name !== skillToRemove));
        } else {
          setError("Uninstall failed: " + errorMsg);
        }
      }
    } catch (err) {
      setError("Uninstall error: " + String(err));
    } finally {
      setUninstallingSkill(null);
      setSkillToRemove(null);
    }
  };

  const cancelUninstall = () => {
    setShowConfirm(false);
    setSkillToRemove(null);
  };

  const handleSelect = (skill: Skill) => {
    navigate(`/skill/${encodeURIComponent(skill.name)}`);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Installed Skills ({skills.length})</h2>
        <select
          className="filter-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
        >
          <option value="name">Sort by Name</option>
          <option value="date">Sort by Install Date</option>
        </select>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">Loading installed skills...</div>
      ) : skills.length === 0 ? (
        <div className="empty-state-container">
          <p className="empty-state">No skills installed yet</p>
          <button className="btn-browse" onClick={() => navigate("/")}>
            Browse Catalog
          </button>
        </div>
      ) : (
        <div className="skills-grid">
          {sortedSkills.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              onUninstall={handleUninstall}
              onSelect={handleSelect}
              isUninstalling={uninstallingSkill === skill.name}
            />
          ))}
        </div>
      )}

      {showConfirm && (
        <ConfirmDialog
          title="Remove Skill"
          message={`Are you sure you want to remove "${skillToRemove}"? This will delete the skill files from ~/.claude/skills/.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onConfirm={confirmUninstall}
          onCancel={cancelUninstall}
          isDanger={true}
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
