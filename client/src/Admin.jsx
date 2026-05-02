import { useEffect, useState } from "react";
import { Settings, ClipboardList, Monitor, Camera, LogOut, Save, RefreshCw, Download } from "lucide-react";

const API_BASE = "/api";

export default function Admin({ onAuthChange, onNavigate, isAdminAuth }) {
  const [authenticated, setAuthenticated] = useState(
    () => !!localStorage.getItem("admin_token")
  );
  const [page, setPage] = useState(
    () => localStorage.getItem("admin_token") ? "settings" : "login"
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({});
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({
    equipment: "",
    location: "",
    classification: "",
    startDate: "",
    endDate: ""
  });

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!response.ok) throw new Error("Invalid password");
      const data = await response.json();
      setAuthenticated(true);
      setPage("settings");
      setPassword("");
      localStorage.setItem("admin_token", data.token);
      onAuthChange?.(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/settings`);
      const data = await response.json();
      setSettings(data);
    } catch {
      setError("Failed to load settings");
    }
  };

  const loadLogs = async () => {
    try {
      const query = new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
      );
      const response = await fetch(`${API_BASE}/admin/logs?${query}`);
      const data = await response.json();
      setLogs(data.logs || []);
    } catch {
      setError("Failed to load logs");
    }
  };

  const updateSettings = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = await response.json();
      setSettings(data);
      setError("");
    } catch {
      setError("Failed to update settings");
    }
  };

  const exportReport = async (scanId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/reports/${scanId}`);
      const report = await response.json();
      const el = document.createElement("a");
      el.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(report, null, 2));
      el.download = `thermal-report-${scanId}.json`;
      el.style.display = "none";
      document.body.appendChild(el);
      el.click();
      document.body.removeChild(el);
    } catch {
      setError("Failed to export report");
    }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    setPage("login");
    localStorage.removeItem("admin_token");
    onAuthChange?.(false);
  };

  useEffect(() => {
    if (authenticated && page === "settings") loadSettings();
  }, [authenticated, page]);

  useEffect(() => {
    if (authenticated && page === "logs") loadLogs();
  }, [authenticated, page, filters]);

  // Not logged in — full-screen login
  if (!authenticated) {
    return (
      <div className="admin-full">
        <LoginPage
          password={password}
          onPasswordChange={(e) => setPassword(e.target.value)}
          onSubmit={handleLogin}
          error={error}
          loading={loading}
        />
      </div>
    );
  }

  const navItems = [
    { id: "settings", icon: <Settings size={18} />, label: "Settings" },
    { id: "logs",     icon: <ClipboardList size={18} />, label: "Scan Logs" }
  ];

  return (
    <div className="admin-full">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <span>PortableThermal</span>
        </div>

        <nav className="admin-sidebar-nav">
          <p className="admin-sidebar-section-label">Dashboard</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`admin-sidebar-item ${page === item.id ? "active" : ""}`}
              onClick={() => { setPage(item.id); setError(""); }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          <p className="admin-sidebar-section-label" style={{ marginTop: 24 }}>Navigate</p>
          <button
            className="admin-sidebar-item"
            onClick={() => onNavigate?.("kiosk")}
          >
            <Monitor size={18} />
            Kiosk Mode
          </button>
          <button
            className="admin-sidebar-item"
            onClick={() => onNavigate?.("camera")}
          >
            <Camera size={18} />
            Camera
          </button>
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-sidebar-item logout" onClick={handleLogout}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="admin-main">
        {error && <div className="error-banner">{error}</div>}

        {page === "settings" && (
          <SettingsPage
            settings={settings}
            onSettingsChange={setSettings}
            onSave={updateSettings}
          />
        )}

        {page === "logs" && (
          <LogsPage
            logs={logs}
            filters={filters}
            onFiltersChange={setFilters}
            onExport={exportReport}
            onRefresh={loadLogs}
          />
        )}
      </main>
    </div>
  );
}

// ─── Login Page ───────────────────────────────────────────────────────────────

function LoginPage({ password, onPasswordChange, onSubmit, error, loading }) {
  return (
    <div className="login-page">
      <div className="login-container">
        <h1>Admin Access</h1>
        <p>Enter password to continue</p>
        <form onSubmit={onSubmit} className="login-form">
          <input
            type="password"
            value={password}
            onChange={onPasswordChange}
            placeholder="Password"
            autoFocus
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Authenticating..." : "Login"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────

function SettingsPage({ settings, onSettingsChange, onSave }) {
  const handleToggle = (key) => {
    onSettingsChange({ ...settings, [key]: !settings[key] });
  };

  return (
    <div className="admin-page settings-page">
      <div className="admin-page-header">
        <h2>System Settings</h2>
      </div>

      <div className="settings-group">
        <ToggleItem
          label="Enable Scan Logging"
          desc="Record all captures to scan logs"
          checked={settings.enableLogs || false}
          onChange={() => handleToggle("enableLogs")}
        />
        <ToggleItem
          label="Show Thermal Markings"
          desc="Display temperature labels on captured images"
          checked={settings.showThermalMarkings || false}
          onChange={() => handleToggle("showThermalMarkings")}
        />
        <ToggleItem
          label="Enable Admin Mode"
          desc="Allow admin access to the system"
          checked={settings.enableAdminMode || false}
          onChange={() => handleToggle("enableAdminMode")}
        />

        <div className="setting-item">
          <div className="setting-item-text">
            <span className="setting-item-label">Max Comparative Scans</span>
            <p>Maximum images per comparative analysis session</p>
          </div>
          <input
            type="number"
            min="2"
            max="100"
            value={settings.maxComparativeScans || 20}
            onChange={(e) =>
              onSettingsChange({ ...settings, maxComparativeScans: parseInt(e.target.value) })
            }
            className="setting-number-input"
          />
        </div>
      </div>

      <button className="save-button" onClick={onSave}>
        <Save size={15} /> Save Settings
      </button>
    </div>
  );
}

function ToggleItem({ label, desc, checked, onChange }) {
  return (
    <div className="setting-item">
      <div className="setting-item-text">
        <span className="setting-item-label">{label}</span>
        <p>{desc}</p>
      </div>
      <button
        type="button"
        className={`toggle-switch ${checked ? "on" : ""}`}
        onClick={onChange}
        aria-pressed={checked}
      />
    </div>
  );
}

// ─── Logs Page ────────────────────────────────────────────────────────────────

function LogsPage({ logs, filters, onFiltersChange, onExport, onRefresh }) {
  const handleFilterChange = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="admin-page logs-page">
      <div className="admin-page-header">
        <h2>Scan Logs</h2>
        <button className="icon-action-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="filters-section">
        <div className="filter-group">
          <label>Equipment</label>
          <input type="text" value={filters.equipment} onChange={(e) => handleFilterChange("equipment", e.target.value)} placeholder="Filter by equipment" />
        </div>
        <div className="filter-group">
          <label>Location</label>
          <input type="text" value={filters.location} onChange={(e) => handleFilterChange("location", e.target.value)} placeholder="Filter by location" />
        </div>
        <div className="filter-group">
          <label>Classification</label>
          <select value={filters.classification} onChange={(e) => handleFilterChange("classification", e.target.value)}>
            <option value="">All</option>
            <option value="Normal">Normal</option>
            <option value="Warning">Warning</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Start Date</label>
          <input type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} />
        </div>
        <div className="filter-group">
          <label>End Date</label>
          <input type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} />
        </div>
      </div>

      <div className="logs-table-section">
        <p className="log-count">Total: {logs.length} scan{logs.length !== 1 ? "s" : ""}</p>

        {logs.length === 0 ? (
          <p className="no-logs">No logs found</p>
        ) : (
          <table className="logs-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Equipment</th>
                <th>Location</th>
                <th>Temp (°C)</th>
                <th>Ambient (°C)</th>
                <th>Classification</th>
                <th>Export</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.timestamp).toLocaleString()}</td>
                  <td>{log.equipment}</td>
                  <td>{log.location}</td>
                  <td>{log.temperature}</td>
                  <td>{log.ambiance}</td>
                  <td>
                    <span className={`badge ${log.classification?.toLowerCase()}`}>
                      {log.classification}
                    </span>
                  </td>
                  <td>
                    <button className="export-btn" onClick={() => onExport(log.id)} title="Export report">
                      <Download size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
