import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { Catalog } from "./pages/Catalog";
import { Installed } from "./pages/Installed";
import { Settings } from "./pages/Settings";
import { SkillDetail } from "./pages/SkillDetail";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Catalog />} />
            <Route path="/installed" element={<Installed />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/skill/:name" element={<SkillDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
