import { useState, useEffect } from "react";
import { getConfig, getHomeDir } from "../lib/tauri-commands";

interface Config {
  providers?: ProviderConfig[];
  defaultProvider?: string;
}

interface ProviderConfig {
  name: string;
  label: string;
  global: string;
  enabled: boolean;
}

export function Settings() {
  const [homeDir, setHomeDir] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const [homeResult, configResult] = await Promise.all([
        getHomeDir(),
        getConfig(),
      ]);
      setHomeDir(homeResult);
      if (configResult.success) {
        try {
          const parsed = JSON.parse(configResult.stdout);
          setConfig(parsed);
        } catch {
          setConfig(null);
        }
      }
    } catch (err) {
      setError("Error loading settings: " + String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">Loading settings...</div>
      ) : (
        <div className="settings-content">
          <section className="settings-section">
            <h3>General</h3>
            <div className="setting-item">
              <label>Home Directory:</label>
              <span>{homeDir || "Unknown"}</span>
            </div>
            <div className="setting-item">
              <label>Default Provider:</label>
              <span>{config?.defaultProvider || "Claude Code (claude)"}</span>
            </div>
          </section>

          <section className="settings-section">
            <h3>Skill Providers</h3>
            {config?.providers ? (
              <ul className="providers-list">
                {config.providers.map((provider) => (
                  <li
                    key={provider.name}
                    className={provider.enabled ? "enabled" : "disabled"}
                  >
                    <span className="provider-label">{provider.label}</span>
                    <span className="provider-path">{provider.global}</span>
                    <span className="provider-status">
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No providers configured</p>
            )}
          </section>

          <section className="settings-section">
            <h3>About</h3>
            <div className="setting-item">
              <label>ASM Desktop:</label>
              <span>Version 0.1.0</span>
            </div>
            <div className="setting-item">
              <label>Target:</label>
              <span>Claude Code</span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
