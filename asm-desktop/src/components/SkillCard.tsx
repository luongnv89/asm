import type { Skill } from "../lib/tauri-commands";

interface SkillCardProps {
  skill: Skill;
  onInstall?: (name: string) => void;
  onUninstall?: (name: string) => void;
  onSelect?: (skill: Skill) => void;
  isInstalling?: boolean;
  isUninstalling?: boolean;
}

export function SkillCard({
  skill,
  onInstall,
  onUninstall,
  onSelect,
  isInstalling = false,
  isUninstalling = false,
}: SkillCardProps) {
  return (
    <div className="skill-card" onClick={() => onSelect?.(skill)}>
      <div className="skill-header">
        <h3>{skill.name}</h3>
        {skill.installed && <span className="badge installed">Installed</span>}
      </div>
      <p className="skill-description">
        {skill.description || "No description"}
      </p>
      <div className="skill-meta-row">
        {skill.version && (
          <span className="skill-version">v{skill.version}</span>
        )}
        {skill.source && <span className="skill-source">{skill.source}</span>}
        {skill.category && (
          <span className="skill-category">{skill.category}</span>
        )}
      </div>
      <div className="skill-actions">
        {skill.installed ? (
          <button
            className="btn-uninstall"
            onClick={(e) => {
              e.stopPropagation();
              onUninstall?.(skill.name);
            }}
            disabled={isUninstalling}
          >
            {isUninstalling ? "Removing..." : "Remove"}
          </button>
        ) : (
          <button
            className="btn-install"
            onClick={(e) => {
              e.stopPropagation();
              onInstall?.(skill.name);
            }}
            disabled={isInstalling}
          >
            {isInstalling ? "Installing..." : "Install"}
          </button>
        )}
      </div>
    </div>
  );
}
