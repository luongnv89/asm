import type { Skill } from "../lib/tauri-commands";

interface SkillCardProps {
  skill: Skill;
  onInstall?: (name: string) => void;
  onUninstall?: (name: string) => void;
  onSelect?: (skill: Skill) => void;
}

export function SkillCard({
  skill,
  onInstall,
  onUninstall,
  onSelect,
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
      {skill.source && <span className="skill-source">{skill.source}</span>}
      <div className="skill-actions">
        {skill.installed ? (
          <button
            className="btn-uninstall"
            onClick={(e) => {
              e.stopPropagation();
              onUninstall?.(skill.name);
            }}
          >
            Uninstall
          </button>
        ) : (
          <button
            className="btn-install"
            onClick={(e) => {
              e.stopPropagation();
              onInstall?.(skill.name);
            }}
          >
            Install
          </button>
        )}
      </div>
    </div>
  );
}
