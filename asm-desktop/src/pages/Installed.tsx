import { useState, useEffect } from "react";
import { SkillCard } from "../components/SkillCard";
import {
  listInstalledSkills,
  uninstallSkill,
  parseSkillsFromJson,
  type Skill,
} from "../lib/tauri-commands";

export function Installed() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInstalledSkills();
  }, []);

  const loadInstalledSkills = async () => {
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
  };

  const handleUninstall = async (name: string) => {
    try {
      const result = await uninstallSkill(name);
      if (result.success) {
        setSkills((prev) => prev.filter((s) => s.name !== name));
      } else {
        setError("Uninstall failed: " + result.stderr);
      }
    } catch (err) {
      setError("Uninstall error: " + String(err));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Installed Skills</h2>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">Loading installed skills...</div>
      ) : (
        <div className="skills-grid">
          {skills.length === 0 ? (
            <p className="empty-state">No skills installed yet</p>
          ) : (
            skills.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onUninstall={handleUninstall}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
