import { useEffect, useState } from "react";
import {
  BarChart2,
  Camera,
  ClipboardList,
  Download,
  LogOut,
  Monitor,
  RefreshCw,
  Save,
  Settings
} from "lucide-react";
import {
  ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY,
  ADMIN_SINGLE_LOGS_CACHE_KEY,
  getApiBase,
  mergeRecordsById,
  readLocalCache,
  writeLocalCache
} from "../../api.js";

const BRAND_LOGO = "/assets/logo.png";

const API_BASE = "/api";
const SETTINGS_CACHE_KEY = "cached_admin_settings";

const COMPARATIVE_RECOMMENDATIONS = [
  { key: "normal",   label: "No significant difference", action: "Continue routine monitoring.",                             tone: "normal"   },
  { key: "possible", label: "Possible deficiency",        action: "Possible deficiency; warrants investigation.",            tone: "warning"  },
  { key: "probable", label: "Probable deficiency",        action: "Indicates probable deficiency; repair as time permits.",  tone: "warning"  },
  { key: "major",    label: "Major discrepancy",          action: "Major discrepancy; repair immediately.",                  tone: "critical" }
];

export default function Admin({ onAuthChange, onNavigate }) {
  const [authenticated, setAuthenticated] = useState(() => !!localStorage.getItem("admin_token"));
  const [page, setPage] = useState(() => (localStorage.getItem("admin_token") ? "settings" : "login"));
  const [localServerUrl, setLocalServerUrl] = useState(() => localStorage.getItem("local_server_url") || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({});
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [singleLogs, setSingleLogs] = useState(() => readLocalCache(ADMIN_SINGLE_LOGS_CACHE_KEY, []));
  const [comparativeSessions, setComparativeSessions] = useState(() => readLocalCache(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, []));
  const [singleFilters, setSingleFilters] = useState({ classification: "", startDate: "", endDate: "" });
  const [comparativeFilters, setComparativeFilters] = useState({ status: "", startDate: "", endDate: "" });

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        throw new Error("Invalid password");
      }

      const data = await response.json();
      localStorage.setItem("admin_token", data.token);
      setAuthenticated(true);
      setPage("settings");
      setUsername("");
      setPassword("");
      onAuthChange?.(true);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const authorizedFetch = async (url, options = {}) => {
    const token = localStorage.getItem("admin_token");
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    setAuthenticated(false);
    setPage("login");
    onAuthChange?.(false);
  };

  const handleSessionExpired = () => {
    handleLogout();
    setError("Admin session expired. Please log in again.");
  };

  const loadSettings = async () => {
    try {
      const response = await authorizedFetch(`${API_BASE}/admin/settings`);
      if (response.status === 401) return handleSessionExpired();
      const data = await response.json();
      setSettings(data);
      try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(data)); } catch {}
    } catch {
      const cached = localStorage.getItem(SETTINGS_CACHE_KEY);
      if (cached) {
        try { setSettings(JSON.parse(cached)); } catch {}
        setError("Offline — showing cached settings. Changes won't save until reconnected.");
      } else {
        setError("Settings unavailable offline.");
      }
    }
  };

  const loadSingleLogs = async () => {
    const cachedLogs = readLocalCache(ADMIN_SINGLE_LOGS_CACHE_KEY, []);
    try {
      const [cloudResponse, localResponse] = await Promise.allSettled([
        authorizedFetch(`${API_BASE}/admin/logs?${buildQuery({ mode: "single", source: "kiosk" })}`),
        fetch(`${getApiBase()}/admin/logs`)
      ]);
      const cloud = await unwrapDashboardResponse(cloudResponse, "logs");
      const local = await unwrapDashboardResponse(localResponse, "logs");
      const merged = sortByLatest(mergeRecordsById(cachedLogs, cloud, local), "timestamp");
      setSingleLogs(merged);
      writeLocalCache(ADMIN_SINGLE_LOGS_CACHE_KEY, merged);
      setError("");
    } catch (err) {
      if (err?.code === "SESSION_EXPIRED") return handleSessionExpired();
      if (cachedLogs.length > 0) {
        setSingleLogs(cachedLogs);
        setError("Offline — showing cached single scan logs.");
      } else {
        setError("Logs unavailable.");
      }
    }
  };

  const loadComparativeSessions = async () => {
    const cached = readLocalCache(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, []);
    try {
      const [cloudResponse, localResponse] = await Promise.allSettled([
        authorizedFetch(`${API_BASE}/admin/comparative-sessions?${buildQuery({ source: "kiosk" })}`),
        fetch(`${getApiBase()}/admin/comparative-sessions`)
      ]);
      const cloud = await unwrapDashboardResponse(cloudResponse, "sessions");
      const local = await unwrapDashboardResponse(localResponse, "sessions");
      const merged = sortByLatest(mergeRecordsById(cached, cloud, local), "completedAt", "timestamp");
      setComparativeSessions(merged);
      writeLocalCache(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, merged);
      setError("");
    } catch (err) {
      if (err?.code === "SESSION_EXPIRED") return handleSessionExpired();
      if (cached.length > 0) {
        setComparativeSessions(cached);
        setError("Offline — showing cached comparative sessions.");
      } else {
        setError("Sessions unavailable.");
      }
    }
  };

  const updateSettings = async () => {
    try {
      if ((newAdminPassword || confirmAdminPassword) && newAdminPassword !== confirmAdminPassword) {
        setError("Admin passwords do not match");
        return;
      }
      const response = await authorizedFetch(`${API_BASE}/admin/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, ...(newAdminPassword ? { adminPassword: newAdminPassword } : {}) })
      });
      if (response.status === 401) return handleSessionExpired();
      const data = await response.json();
      setSettings(data);
      setNewAdminPassword("");
      setConfirmAdminPassword("");
      setError("");
    } catch {
      setError("Failed to update settings");
    }
  };

  const exportReport = async (scanId) => {
    try {
      const response = await authorizedFetch(`${API_BASE}/admin/reports/${scanId}`);
      if (response.status === 401) return handleSessionExpired();
      const report = await response.json();
      const link = document.createElement("a");
      link.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
      link.download = `thermal-report-${scanId}.json`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      setError("Failed to export report");
    }
  };

  useEffect(() => { if (authenticated && page === "settings")        loadSettings();           }, [authenticated, page]);
  useEffect(() => { if (authenticated && page === "singleLogs")      loadSingleLogs();          }, [authenticated, page]);
  useEffect(() => { if (authenticated && page === "comparativeLogs") loadComparativeSessions(); }, [authenticated, page]);

  if (!authenticated) {
    return (
      <div className="admin-full">
        <LoginPage
          username={username}
          onUsernameChange={(e) => setUsername(e.target.value)}
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
    { id: "settings",        icon: <Settings size={18} />,     label: "Settings" },
    { id: "singleLogs",      icon: <ClipboardList size={18} />, label: "Single Scan Logs" },
    { id: "comparativeLogs", icon: <BarChart2 size={18} />,    label: "Comparative Logs" }
  ];

  return (
    <div className="admin-full">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <img className="brand-logo" src={BRAND_LOGO} alt="PortableThermal" />
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
          <button className="admin-sidebar-item" onClick={() => onNavigate?.("kiosk")}>
            <Monitor size={18} /> Kiosk Mode
          </button>
          <button className="admin-sidebar-item" onClick={() => onNavigate?.("test")}>
            <Camera size={18} /> Test
          </button>
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-sidebar-item logout" onClick={handleLogout}>
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>

      <main className="admin-main">
        {error && <div className="error-banner">{error}</div>}

        {page === "settings" && (
          <SettingsPage
            settings={settings}
            onSettingsChange={setSettings}
            onSave={updateSettings}
            newAdminPassword={newAdminPassword}
            confirmAdminPassword={confirmAdminPassword}
            onNewAdminPasswordChange={setNewAdminPassword}
            onConfirmAdminPasswordChange={setConfirmAdminPassword}
            localServerUrl={localServerUrl}
            onLocalServerUrlChange={(url) => { setLocalServerUrl(url); localStorage.setItem("local_server_url", url); }}
          />
        )}

        {page === "singleLogs" && (
          <SingleScanLogsPage
            logs={filterSingleLogs(singleLogs, singleFilters)}
            filters={singleFilters}
            onFiltersChange={setSingleFilters}
            onExport={exportReport}
            onRefresh={loadSingleLogs}
          />
        )}

        {page === "comparativeLogs" && (
          <ComparativeLogsPage
            sessions={filterComparativeSessions(comparativeSessions, comparativeFilters)}
            filters={comparativeFilters}
            onFiltersChange={setComparativeFilters}
            onRefresh={loadComparativeSessions}
          />
        )}
      </main>
    </div>
  );
}

function LoginPage({ username, onUsernameChange, password, onPasswordChange, onSubmit, error, loading }) {
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand">
          <img className="brand-logo" src={BRAND_LOGO} alt="PortableThermal" />
          <span>PortableThermal</span>
        </div>
        <h1>Admin Access</h1>
        <p>Enter your credentials to continue</p>
        <form onSubmit={onSubmit} className="login-form">
          <input type="text"     value={username} onChange={onUsernameChange} placeholder="Username" autoFocus autoComplete="username"         disabled={loading} />
          <input type="password" value={password} onChange={onPasswordChange} placeholder="Password"        autoComplete="current-password" disabled={loading} />
          <button type="submit" disabled={loading}>{loading ? "Authenticating..." : "Login"}</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function SettingsPage({ settings, onSettingsChange, onSave, newAdminPassword, confirmAdminPassword, onNewAdminPasswordChange, onConfirmAdminPasswordChange, localServerUrl, onLocalServerUrlChange }) {
  const toggle = (key) => onSettingsChange({ ...settings, [key]: !settings[key] });
  return (
    <div className="admin-page settings-page">
      <div className="admin-page-header"><h2>System Settings</h2></div>
      <div className="settings-group">
        <ToggleItem label="Enable Scan Logging"    desc="Record kiosk captures to admin logs"          checked={settings.enableLogs || false}          onChange={() => toggle("enableLogs")} />
        <ToggleItem label="Show Thermal Markings"  desc="Display temperature labels on captured images" checked={settings.showThermalMarkings || false}  onChange={() => toggle("showThermalMarkings")} />
        <ToggleItem label="Enable Admin Mode"      desc="Allow admin access to the system"              checked={settings.enableAdminMode || false}      onChange={() => toggle("enableAdminMode")} />
        <div className="setting-item">
          <div className="setting-item-text">
            <span className="setting-item-label">Max Comparative Scans</span>
            <p>Maximum images per comparative analysis session</p>
          </div>
          <input type="number" min="2" max="100" value={settings.maxComparativeScans || 20}
            onChange={(e) => onSettingsChange({ ...settings, maxComparativeScans: parseInt(e.target.value, 10) })}
            className="setting-number-input" />
        </div>
        <div className="setting-item setting-password-item">
          <div className="setting-item-text">
            <span className="setting-item-label">Admin Password</span>
            <p>Set a new password for admin login. Leave both fields blank to keep the current password.</p>
          </div>
          <div className="setting-password-fields">
            <input type="password" value={newAdminPassword}     onChange={(e) => onNewAdminPasswordChange(e.target.value)}     placeholder="New password"     className="setting-password-input" />
            <input type="password" value={confirmAdminPassword} onChange={(e) => onConfirmAdminPasswordChange(e.target.value)} placeholder="Confirm password" className="setting-password-input" />
          </div>
        </div>
      </div>
      <div className="settings-group">
        <div className="setting-item">
          <div className="setting-item-text">
            <span className="setting-item-label">Local Server URL</span>
            <p>Address of the RasPi local server. Defaults to http://localhost:3000 — only change this if the local server runs on a different device.</p>
          </div>
          <input type="text" value={localServerUrl} onChange={(e) => onLocalServerUrlChange(e.target.value)} placeholder="http://localhost:3000" className="setting-password-input" />
        </div>
      </div>
      <button className="save-button" onClick={onSave}><Save size={15} /> Save Settings</button>
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
      <button type="button" className={`toggle-switch ${checked ? "on" : ""}`} onClick={onChange} aria-pressed={checked} />
    </div>
  );
}

function SingleScanLogsPage({ logs, filters, onFiltersChange, onExport, onRefresh }) {
  return (
    <div className="admin-page logs-page">
      <div className="admin-page-header">
        <h2>Single Scan Logs</h2>
        <button className="icon-action-btn" onClick={onRefresh} title="Refresh"><RefreshCw size={16} /> Refresh</button>
      </div>
      <div className="filters-section">
        <div className="filter-group">
          <label>Classification</label>
          <select value={filters.classification} onChange={(e) => onFiltersChange({ ...filters, classification: e.target.value })}>
            <option value="">All</option>
            <option value="Normal">Normal</option>
            <option value="Warning">Warning</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Start Date</label>
          <input type="date" value={filters.startDate} onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })} />
        </div>
        <div className="filter-group">
          <label>End Date</label>
          <input type="date" value={filters.endDate} onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })} />
        </div>
      </div>
      <div className="logs-table-section">
        <p className="log-count">Total: {logs.length} single scan{logs.length !== 1 ? "s" : ""}</p>
        {logs.length === 0 ? (
          <p className="no-logs">No single scan logs found</p>
        ) : (
          <table className="logs-table">
            <thead>
              <tr><th>Timestamp</th><th>Temp (C)</th><th>Ambient (C)</th><th>Delta (C)</th><th>Classification</th><th>Export</th></tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.timestamp)}</td>
                  <td>{formatNumber(log.temperature)}</td>
                  <td>{formatNumber(log.ambiance)}</td>
                  <td>{formatDelta(log.temperature, log.ambiance)}</td>
                  <td><span className={`badge ${String(log.classification || "Normal").toLowerCase()}`}>{log.classification || "Unknown"}</span></td>
                  <td><button className="export-btn" onClick={() => onExport(log.id)} title="Export report"><Download size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ComparativeLogsPage({ sessions, filters, onFiltersChange, onRefresh }) {
  return (
    <div className="admin-page logs-page">
      <div className="admin-page-header">
        <h2>Comparative Logs</h2>
        <button className="icon-action-btn" onClick={onRefresh} title="Refresh"><RefreshCw size={16} /> Refresh</button>
      </div>
      <div className="filters-section comparative-filters">
        <div className="filter-group">
          <label>Status</label>
          <select value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="in-progress">In Progress</option>
          </select>
        </div>
        <div className="filter-group">
          <label>Start Date</label>
          <input type="date" value={filters.startDate} onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })} />
        </div>
        <div className="filter-group">
          <label>End Date</label>
          <input type="date" value={filters.endDate} onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })} />
        </div>
      </div>
      <div className="logs-table-section">
        <p className="log-count">Total: {sessions.length} comparative session{sessions.length !== 1 ? "s" : ""}</p>
        {sessions.length === 0 ? (
          <p className="no-logs">No comparative sessions found</p>
        ) : (
          <table className="logs-table comparative-logs-table">
            <thead>
              <tr><th>Started</th><th>Completed</th><th>Photos</th><th>TRef (C)</th><th>Peak Delta (C)</th><th>Overall Analysis</th><th>Status</th></tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const analysis = getAnalysisForSession(session);
                const rec = analysis.overallRecommendation || COMPARATIVE_RECOMMENDATIONS[0];
                return (
                  <tr key={session.id}>
                    <td>{formatDateTime(session.timestamp)}</td>
                    <td>{session.completedAt ? formatDateTime(session.completedAt) : "-"}</td>
                    <td>{session.scanCount ?? session.scans?.length ?? 0}</td>
                    <td>{formatNumber(analysis.tref)}</td>
                    <td>{formatNumber(analysis.peakDelta)}</td>
                    <td><span className={`badge ${rec.tone || "normal"}`}>{rec.label || "Not analyzed"}</span></td>
                    <td><span className={`session-status ${session.status === "completed" ? "completed" : "progress"}`}>{session.status || "in-progress"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function buildQuery(values) {
  return new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, v]) => v)));
}

async function unwrapDashboardResponse(result, key) {
  if (result.status === "rejected") throw result.reason;
  const response = result.value;
  if (!response) return [];
  if (response.status === 401) { const e = new Error("Session expired"); e.code = "SESSION_EXPIRED"; throw e; }
  if (!response.ok) throw new Error(`Failed to load ${key}.`);
  const data = await response.json();
  return data[key] || [];
}

function sortByLatest(records, primaryKey, secondaryKey) {
  return [...records].sort((a, b) => {
    const l = new Date(a?.[primaryKey] || a?.[secondaryKey] || 0).getTime();
    const r = new Date(b?.[primaryKey] || b?.[secondaryKey] || 0).getTime();
    return r - l;
  });
}

function filterSingleLogs(logs, filters) {
  return logs.filter((log) => {
    if (filters.classification && String(log.classification || "") !== filters.classification) return false;
    if (filters.startDate && new Date(log.timestamp) < new Date(filters.startDate)) return false;
    if (filters.endDate   && new Date(log.timestamp) > new Date(`${filters.endDate}T23:59:59.999`)) return false;
    return true;
  });
}

function filterComparativeSessions(sessions, filters) {
  return sessions.filter((session) => {
    const d = session.completedAt || session.timestamp;
    if (filters.status    && String(session.status || "") !== filters.status) return false;
    if (filters.startDate && new Date(d) < new Date(filters.startDate)) return false;
    if (filters.endDate   && new Date(d) > new Date(`${filters.endDate}T23:59:59.999`)) return false;
    return true;
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function formatDelta(temperature, ambiance) {
  const h = Number(temperature);
  const a = Number(ambiance);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return "-";
  return (h - a).toFixed(1);
}

function getAnalysisForSession(session) {
  const computed = buildComparativeAnalysis(session.scans || []);
  const stored   = session.analysis && typeof session.analysis === "object" ? session.analysis : {};
  return {
    ...computed,
    ...stored,
    classificationCounts:   stored.classificationCounts   || computed.classificationCounts,
    overallRecommendation:  stored.overallRecommendation   || computed.overallRecommendation
  };
}

function buildComparativeAnalysis(scans) {
  const temps  = scans.map((s) => Number(s.temperature)).filter((v) => Number.isFinite(v));
  const tref   = computeReferenceTemperature(temps);
  const deltas = scans.map((s) => Number(s.temperature) - tref);
  const finite = deltas.filter((v) => Number.isFinite(v));
  const avg    = finite.length ? finite.reduce((a, v) => a + v, 0) / finite.length : 0;
  const variance = finite.length ? finite.reduce((a, v) => a + Math.pow(v - avg, 2), 0) / finite.length : 0;
  return {
    tref,
    avgDelta:  avg,
    peakDelta: finite.length ? Math.max(...finite) : 0,
    avgTemperature: temps.length ? temps.reduce((a, v) => a + v, 0) / temps.length : 0,
    standardDeviation: Math.sqrt(variance),
    classificationCounts: {
      Critical: scans.filter((s) => s.classification === "Critical").length,
      Warning:  scans.filter((s) => s.classification === "Warning").length,
      Normal:   scans.filter((s) => s.classification === "Normal").length
    },
    overallRecommendation: getWorstComparativeRecommendation(finite)
  };
}

function computeReferenceTemperature(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0;
  if (finite.length === 1) return finite[0];
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / finite.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return mean;
  const filtered = finite.filter((v) => Math.abs((v - mean) / stdDev) <= 2.0);
  const safe = filtered.length > 0 ? filtered : finite;
  return safe.reduce((s, v) => s + v, 0) / safe.length;
}

function getComparativeRecommendation(delta) {
  if (!Number.isFinite(delta) || delta < 1) return COMPARATIVE_RECOMMENDATIONS[0];
  const r = Math.round(delta);
  if (r <= 3)  return COMPARATIVE_RECOMMENDATIONS[1];
  if (r <= 15) return COMPARATIVE_RECOMMENDATIONS[2];
  return COMPARATIVE_RECOMMENDATIONS[3];
}

function getWorstComparativeRecommendation(deltas) {
  return deltas.reduce((worst, delta) => {
    const cur  = getComparativeRecommendation(delta);
    const cR   = COMPARATIVE_RECOMMENDATIONS.findIndex((x) => x.key === cur.key);
    const wR   = COMPARATIVE_RECOMMENDATIONS.findIndex((x) => x.key === worst.key);
    return cR > wR ? cur : worst;
  }, COMPARATIVE_RECOMMENDATIONS[0]);
}
