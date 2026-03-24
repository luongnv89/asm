import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  searchSkills,
  installSkill,
  uninstallSkill,
  parseSkillsFromJson,
  securityAudit,
  type Skill,
} from "../lib/tauri-commands";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Toast } from "../components/Toast";

export function SkillDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    if (name) {
      loadSkill(name);
    }
  }, [name]);

  const loadSkill = async (skillName: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchSkills(skillName);
      if (result.success) {
        const skills = parseSkillsFromJson(result.stdout);
        if (skills.length > 0) {
          setSkill(skills[0]);
        } else {
          setError("Skill not found");
        }
      } else {
        setError("Failed to load skill: " + result.stderr);
      }
    } catch (err) {
      setError("Error loading skill: " + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = () => {
    if (!name) return;
    setPendingInstall(name);
    setShowConfirm(true);
  };

  const confirmInstall = async () => {
    if (!pendingInstall) return;

    setShowConfirm(false);
    setActionLoading(true);

    try {
      const auditResult = await securityAudit(pendingInstall);
      if (!auditResult.success) {
        setError("Security audit failed: " + auditResult.stderr);
        setActionLoading(false);
        setPendingInstall(null);
        return;
      }

      const result = await installSkill(pendingInstall);
      if (result.success) {
        setSkill((prev) => (prev ? { ...prev, installed: true } : null));
        setToast({
          message: `${pendingInstall} installed successfully!`,
          type: "success",
        });
      } else {
        setError("Install failed: " + result.stderr);
      }
    } catch (err) {
      setError("Install error: " + String(err));
    } finally {
      setActionLoading(false);
      setPendingInstall(null);
    }
  };

  const cancelInstall = () => {
    setShowConfirm(false);
    setPendingInstall(null);
  };

  const handleUninstall = async () => {
    if (!name) return;
    setActionLoading(true);
    try {
      const result = await uninstallSkill(name);
      if (result.success) {
        setSkill((prev) => (prev ? { ...prev, installed: false } : null));
      } else {
        setError("Uninstall failed: " + result.stderr);
      }
    } catch (err) {
      setError("Uninstall error: " + String(err));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading">Loading skill details...</div>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="page">
        <div className="error-message">{error || "Skill not found"}</div>
        <button onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  }

  return (
    <div className="page">
      <button className="back-button" onClick={() => navigate(-1)}>
        Back
      </button>
      <div className="skill-detail">
        <div className="skill-detail-header">
          <h2>{skill.name}</h2>
          {skill.installed && (
            <span className="badge installed">Installed</span>
          )}
        </div>
        <p className="skill-description">
          {skill.description || "No description available"}
        </p>
        {skill.source && (
          <div className="skill-meta">
            <span className="meta-label">Source:</span>
            <span className="meta-value">{skill.source}</span>
          </div>
        )}
        {skill.provider && (
          <div className="skill-meta">
            <span className="meta-label">Provider:</span>
            <span className="meta-value">{skill.provider}</span>
          </div>
        )}
        <div className="skill-actions">
          {skill.installed ? (
            <button
              className="btn-uninstall"
              onClick={handleUninstall}
              disabled={actionLoading}
            >
              {actionLoading ? "Uninstalling..." : "Uninstall"}
            </button>
          ) : (
            <button
              className="btn-install"
              onClick={handleInstall}
              disabled={actionLoading}
            >
              {actionLoading ? "Installing..." : "Install"}
            </button>
          )}
        </div>
      </div>

      {showConfirm && (
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
