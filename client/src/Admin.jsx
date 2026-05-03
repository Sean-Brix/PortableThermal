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

const API_BASE = "/api";

const COMPARATIVE_RECOMMENDATIONS = [
  {
    key: "normal",
    label: "No significant difference",
    action: "Continue routine monitoring.",
    tone: "normal"
  },
  {
    key: "possible",
    label: "Possible deficiency",
    action: "Possible deficiency; warrants investigation.",
    tone: "warning"
  },
  {
    key: "probable",
    label: "Probable deficiency",
    action: "Indicates probable deficiency; repair as time permits.",
    tone: "warning"
  },
  {
    key: "major",
    label: "Major discrepancy",
    action: "Major discrepancy; repair immediately.",
    tone: "critical"
  }
];

export default function Admin({ onAuthChange, onNavigate }) {
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
  const [singleLogs, setSingleLogs] = useState([]);
  const [comparativeSessions, setComparativeSessions] = useState([]);
  const [singleFilters, setSingleFilters] = useState({
    classification: "",
    startDate: "",
    endDate: ""
  });
  const [comparativeFilters, setComparativeFilters] = useState({
    status: "",
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

  const loadSingleLogs = async () => {
    try {
      const query = buildQuery({
        ...singleFilters,
        mode: "single",
        source: "kiosk"
      });
      const response = await fetch(`${API_BASE}/admin/logs?${query}`);
      const data = await response.json();
      setSingleLogs(data.logs || []);
    } catch {
      setError("Failed to load single scan logs");
    }
  };

  const loadComparativeSessions = async () => {
    try {
      const query = buildQuery({
        ...comparativeFilters,
        source: "kiosk"
      });
      const response = await fetch(`${API_BASE}/admin/comparative-sessions?${query}`);
      const data = await response.json();
      setComparativeSessions(data.sessions || []);
    } catch {
      setError("Failed to load comparative logs");
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
    if (authenticated && page === "singleLogs") loadSingleLogs();
  }, [authenticated, page, singleFilters]);

  useEffect(() => {
    if (authenticated && page === "comparativeLogs") loadComparativeSessions();
  }, [authenticated, page, comparativeFilters]);

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
    { id: "singleLogs", icon: <ClipboardList size={18} />, label: "Single Scan Logs" },
    { id: "comparativeLogs", icon: <BarChart2 size={18} />, label: "Comparative Logs" }
  ];

  return (
    <div className="admin-full">
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
            onClick={() => onNavigate?.("test")}
          >
            <Camera size={18} />
            Test
          </button>
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-sidebar-item logout" onClick={handleLogout}>
            <LogOut size={18} />
            Logout
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
          />
        )}

        {page === "singleLogs" && (
          <SingleScanLogsPage
            logs={singleLogs}
            filters={singleFilters}
            onFiltersChange={setSingleFilters}
            onExport={exportReport}
            onRefresh={loadSingleLogs}
          />
        )}

        {page === "comparativeLogs" && (
          <ComparativeLogsPage
            sessions={comparativeSessions}
            filters={comparativeFilters}
            onFiltersChange={setComparativeFilters}
            onRefresh={loadComparativeSessions}
          />
        )}
      </main>
    </div>
  );
}

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
          desc="Record kiosk captures to admin logs"
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
              onSettingsChange({ ...settings, maxComparativeScans: parseInt(e.target.value, 10) })
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

function SingleScanLogsPage({ logs, filters, onFiltersChange, onExport, onRefresh }) {
  const [selectedLog, setSelectedLog] = useState(null);

  const handleFilterChange = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="admin-page logs-page">
      <div className="admin-page-header">
        <h2>Single Scan Logs</h2>
        <button className="icon-action-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="filters-section">
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
        <p className="log-count">Total: {logs.length} single scan{logs.length !== 1 ? "s" : ""}</p>

        {logs.length === 0 ? (
          <p className="no-logs">No single scan logs found</p>
        ) : (
          <table className="logs-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Temp (C)</th>
                <th>Ambient (C)</th>
                <th>Delta (C)</th>
                <th>Classification</th>
                <th>Export</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} onClick={() => setSelectedLog(log)}>
                  <td>{formatDateTime(log.timestamp)}</td>
                  <td>{formatNumber(log.temperature)}</td>
                  <td>{formatNumber(log.ambiance)}</td>
                  <td>{formatDelta(log.temperature, log.ambiance)}</td>
                  <td>
                    <span className={`badge ${log.classification?.toLowerCase() || "normal"}`}>
                      {log.classification || "Unknown"}
                    </span>
                  </td>
                  <td>
                    <button className="export-btn" onClick={(e) => { e.stopPropagation(); onExport(log.id); }} title="Export report">
                      <Download size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedLog && (
        <SingleScanLogModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
}

function ComparativeLogsPage({ sessions, filters, onFiltersChange, onRefresh }) {
  const [selectedSession, setSelectedSession] = useState(null);

  const handleFilterChange = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="admin-page logs-page">
      <div className="admin-page-header">
        <h2>Comparative Logs</h2>
        <button className="icon-action-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="filters-section comparative-filters">
        <div className="filter-group">
          <label>Status</label>
          <select value={filters.status} onChange={(e) => handleFilterChange("status", e.target.value)}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="in-progress">In Progress</option>
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
        <p className="log-count">Total: {sessions.length} comparative session{sessions.length !== 1 ? "s" : ""}</p>

        {sessions.length === 0 ? (
          <p className="no-logs">No comparative sessions found</p>
        ) : (
          <table className="logs-table comparative-logs-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Completed</th>
                <th>Photos</th>
                <th>TRef (C)</th>
                <th>Peak Delta (C)</th>
                <th>Overall Analysis</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const analysis = getAnalysisForSession(session);
                const recommendation = analysis.overallRecommendation || COMPARATIVE_RECOMMENDATIONS[0];
                return (
                  <tr key={session.id} onClick={() => setSelectedSession(session)}>
                    <td>{formatDateTime(session.timestamp)}</td>
                    <td>{session.completedAt ? formatDateTime(session.completedAt) : "-"}</td>
                    <td>{session.scanCount ?? session.scans?.length ?? 0}</td>
                    <td>{formatNumber(analysis.tref)}</td>
                    <td>{formatNumber(analysis.peakDelta)}</td>
                    <td>
                      <span className={`badge ${recommendation.tone || "normal"}`}>
                        {recommendation.label || "Not analyzed"}
                      </span>
                    </td>
                    <td>
                      <span className={`session-status ${session.status === "completed" ? "completed" : "progress"}`}>
                        {session.status || "in-progress"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedSession && (
        <ComparativeSessionModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

function SingleScanLogModal({ log, onClose }) {
  const imageUrl = log.url || log.imageUrl || log.image;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="log-image-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>x</button>
        <div className="log-image-wrap">
          {imageUrl ? (
            <img src={imageUrl} alt="Single scan" />
          ) : (
            <div className="log-empty-image">No image available</div>
          )}
        </div>
        <div className="log-details">
          <p><strong>Temp:</strong> {formatNumber(log.temperature)} C</p>
          <p><strong>Ambient:</strong> {formatNumber(log.ambiance)} C</p>
          <p><strong>Delta:</strong> {formatDelta(log.temperature, log.ambiance)} C</p>
          <p><strong>Classification:</strong> {log.classification || "Unknown"}</p>
          <p><strong>Captured:</strong> {formatDateTime(log.timestamp)}</p>
          <p><strong>Photo:</strong> {log.photoName || "-"}</p>
        </div>
      </div>
    </div>
  );
}

function ComparativeSessionModal({ session, onClose }) {
  const scans = session.scans || [];
  const analysis = getAnalysisForSession(session);
  const recommendation = analysis.overallRecommendation || COMPARATIVE_RECOMMENDATIONS[0];
  const tref = Number(analysis.tref);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="comp-analysis-modal admin-comparative-modal" onClick={(e) => e.stopPropagation()}>
        <div className="comp-modal-header">
          <div>
            <h2>Comparative Session</h2>
            <p className="session-subtitle">
              Started {formatDateTime(session.timestamp)}
              {session.completedAt ? ` - Completed ${formatDateTime(session.completedAt)}` : ""}
            </p>
          </div>
          <button className="analyze-close-btn" onClick={onClose}>x</button>
        </div>

        <div className="comp-modal-body">
          <div className="comp-stats">
            <div className="comp-stat-card">
              <div className="comp-stat-value">{scans.length}</div>
              <div className="comp-stat-label">Photos</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{formatNumber(analysis.tref)} C</div>
              <div className="comp-stat-label">TRef</div>
            </div>
            <div className="comp-stat-card peak">
              <div className="comp-stat-value">{formatNumber(analysis.peakDelta)} C</div>
              <div className="comp-stat-label">Peak Delta</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{formatNumber(analysis.standardDeviation)} C</div>
              <div className="comp-stat-label">Std Dev</div>
            </div>
          </div>

          <div className={`comp-recommendation-callout ${recommendation.tone || "normal"}`}>
            <div className="comp-recommendation-title">Overall analysis</div>
            <div className="comp-recommendation-text">{recommendation.action || recommendation.label || "No analysis recorded."}</div>
            <div className="comp-recommendation-meta">
              Avg Delta: {formatNumber(analysis.avgDelta)} C. Avg Temp: {formatNumber(analysis.avgTemperature)} C.
            </div>
          </div>

          <div className="comp-classification-row">
            <span className="cls-chip critical">{analysis.classificationCounts?.Critical || 0} Critical</span>
            <span className="cls-chip warning">{analysis.classificationCounts?.Warning || 0} Warning</span>
            <span className="cls-chip normal">{analysis.classificationCounts?.Normal || 0} Normal</span>
          </div>

          <div className="comp-table-section">
            <h3>Scan Details</h3>
            <table className="comp-details-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Temp (C)</th>
                  <th>TRef (C)</th>
                  <th>Delta (C)</th>
                  <th>Analysis</th>
                  <th>Captured</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan, index) => {
                  const delta = getComparativeDelta(scan, tref);
                  const rowRecommendation = scan.comparativeRecommendation || getComparativeRecommendation(delta);
                  return (
                    <tr key={scan.id || scan.photoName || index}>
                      <td>#{index + 1}</td>
                      <td>{formatNumber(scan.temperature)}</td>
                      <td>{formatNumber(tref)}</td>
                      <td>{formatNumber(delta)}</td>
                      <td>
                        <span className={`scan-badge ${rowRecommendation.tone || "normal"}`}>
                          {rowRecommendation.label || "No significant difference"}
                        </span>
                      </td>
                      <td>{formatDateTime(scan.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="comp-images-section">
            <h3>Captured Images ({scans.length})</h3>
            <div className="comp-image-grid admin-session-image-grid">
              {scans.map((scan, index) => {
                const imageUrl = scan.url || scan.imageUrl || scan.image;
                const delta = getComparativeDelta(scan, tref);
                const rowRecommendation = scan.comparativeRecommendation || getComparativeRecommendation(delta);
                return (
                  <div className="comp-image-item" key={scan.id || scan.photoName || index}>
                    {imageUrl ? (
                      <img src={imageUrl} alt={`Comparative scan ${index + 1}`} />
                    ) : (
                      <div className="admin-image-missing">No image</div>
                    )}
                    <span className="comp-image-num">#{index + 1}</span>
                    <div className="comp-image-footer">
                      <span className={`scan-badge ${rowRecommendation.tone || "normal"}`}>{rowRecommendation.label}</span>
                      <span className="comp-image-temp">{formatNumber(scan.temperature)} C</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildQuery(values) {
  return new URLSearchParams(
    Object.fromEntries(Object.entries(values).filter(([, value]) => value))
  );
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? `${number}` : number.toFixed(1);
}

function formatDelta(temperature, ambiance) {
  const high = Number(temperature);
  const ambient = Number(ambiance);
  if (!Number.isFinite(high) || !Number.isFinite(ambient)) return "-";
  return (high - ambient).toFixed(1);
}

function getAnalysisForSession(session) {
  const computed = buildComparativeAnalysis(session.scans || []);
  const stored = session.analysis && typeof session.analysis === "object" ? session.analysis : {};
  return {
    ...computed,
    ...stored,
    classificationCounts: stored.classificationCounts || computed.classificationCounts,
    overallRecommendation: stored.overallRecommendation || computed.overallRecommendation
  };
}

function buildComparativeAnalysis(scans) {
  const temps = scans.map((scan) => Number(scan.temperature)).filter((value) => Number.isFinite(value));
  const tref = computeReferenceTemperature(temps);
  const deltas = scans.map((scan) => Number(scan.temperature) - tref);
  const finiteDeltas = deltas.filter((value) => Number.isFinite(value));
  const avgDelta = finiteDeltas.length
    ? finiteDeltas.reduce((sum, value) => sum + value, 0) / finiteDeltas.length
    : 0;
  const variance = finiteDeltas.length
    ? finiteDeltas.reduce((sum, value) => sum + Math.pow(value - avgDelta, 2), 0) / finiteDeltas.length
    : 0;

  return {
    tref,
    avgDelta,
    peakDelta: finiteDeltas.length ? Math.max(...finiteDeltas) : 0,
    avgTemperature: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : 0,
    standardDeviation: Math.sqrt(variance),
    classificationCounts: {
      Critical: scans.filter((scan) => scan.classification === "Critical").length,
      Warning: scans.filter((scan) => scan.classification === "Warning").length,
      Normal: scans.filter((scan) => scan.classification === "Normal").length
    },
    overallRecommendation: getWorstComparativeRecommendation(finiteDeltas)
  };
}

function computeReferenceTemperature(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return 0;
  if (finiteValues.length === 1) return finiteValues[0];

  const mean = finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  const variance = finiteValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / finiteValues.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return mean;

  const filtered = finiteValues.filter((value) => Math.abs((value - mean) / stdDev) <= 2.0);
  const safeValues = filtered.length > 0 ? filtered : finiteValues;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function getComparativeDelta(scan, tref) {
  const stored = Number(scan.temperatureDifference);
  if (Number.isFinite(stored)) return stored;

  const temperature = Number(scan.temperature);
  if (!Number.isFinite(temperature) || !Number.isFinite(tref)) return 0;
  return temperature - tref;
}

function getComparativeRecommendation(delta) {
  if (!Number.isFinite(delta) || delta < 1) return COMPARATIVE_RECOMMENDATIONS[0];
  const rounded = Math.round(delta);
  if (rounded <= 3) return COMPARATIVE_RECOMMENDATIONS[1];
  if (rounded <= 15) return COMPARATIVE_RECOMMENDATIONS[2];
  return COMPARATIVE_RECOMMENDATIONS[3];
}

function getWorstComparativeRecommendation(deltas) {
  return deltas.reduce((worst, delta) => {
    const current = getComparativeRecommendation(delta);
    const currentRank = COMPARATIVE_RECOMMENDATIONS.findIndex((item) => item.key === current.key);
    const worstRank = COMPARATIVE_RECOMMENDATIONS.findIndex((item) => item.key === worst.key);
    return currentRank > worstRank ? current : worst;
  }, COMPARATIVE_RECOMMENDATIONS[0]);
}
