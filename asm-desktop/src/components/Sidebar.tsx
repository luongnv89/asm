import { NavLink } from "react-router-dom";

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h1>ASM</h1>
        <span className="subtitle">Agent Skill Manager</span>
      </div>
      <ul className="nav-links">
        <li>
          <NavLink to="/" end>
            Catalog
          </NavLink>
        </li>
        <li>
          <NavLink to="/installed">Installed</NavLink>
        </li>
        <li>
          <NavLink to="/settings">Settings</NavLink>
        </li>
      </ul>
      <div className="sidebar-footer">
        <span className="version">v0.1.0</span>
      </div>
    </nav>
  );
}
