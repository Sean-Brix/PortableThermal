import { useState } from "react";
import { getApiBase, ADMIN_SINGLE_LOGS_CACHE_KEY, ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY } from "../../api.js";

const DEV_PASSWORD    = "121802";
const CLOUD_BASE      = "/api";
const DEV_HEADER      = { "x-dev-password": DEV_PASSWORD, "Content-Type": "application/json" };

const LOCAL_CACHE_KEYS = [
  ADMIN_SINGLE_LOGS_CACHE_KEY,
  ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY,
  "cached_admin_settings",
  "offline_photo_queue",
  "offline_comparative_session_queue",
];

export default function DevPage({ onNavigate }) {
  const [unlocked, setUnlocked]   = useState(() => sessionStorage.getItem("dev_unlocked") === "1");
  const [input,    setInput]      = useState("");
  const [error,    setError]      = useState("");
  const [results,  setResults]    = useState({});
  const [loading,  setLoading]    = useState({});

  function unlock(e) {
    e.preventDefault();
    if (input === DEV_PASSWORD) {
      sessionStorage.setItem("dev_unlocked", "1");
      setUnlocked(true);
      setError("");
    } else {
      setError("Incorrect password.");
    }
  }

  function setOp(key, state) {
    setLoading((p) => ({ ...p, [key]: state === "loading" }));
    if (state !== "loading") setResults((p) => ({ ...p, [key]: state }));
  }

  async function run(key, fn) {
    setOp(key, "loading");
    try {
      const msg = await fn();
      setOp(key, { ok: true, msg });
    } catch (err) {
      setOp(key, { ok: false, msg: err.message || "Failed" });
    }
  }

  /* ─── Actions ────────────────────────────────────────────────────────────── */

  const actions = {
    async deleteCloudLogs() {
      const res = await fetch(`${CLOUD_BASE}/admin/logs`, { method: "DELETE", headers: DEV_HEADER });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return `Deleted ${data.deleted} cloud scan log(s)`;
    },
    async deleteCloudSessions() {
      const res = await fetch(`${CLOUD_BASE}/admin/comparative-sessions`, { method: "DELETE", headers: DEV_HEADER });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return `Deleted ${data.deleted} cloud session(s)`;
    },
    async deleteLocalPhotos() {
      const base = getApiBase().replace(/\/api$/, "");
      const res  = await fetch(`${base}/api/photos`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return `Cleared ${data.deleted} local photo(s) + reset sensor state`;
    },
    clearSingleLogsCache() {
      localStorage.removeItem(ADMIN_SINGLE_LOGS_CACHE_KEY);
      return "Single scan logs cache cleared";
    },
    clearComparativeCache() {
      localStorage.removeItem(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY);
      return "Comparative sessions cache cleared";
    },
    clearOfflineQueues() {
      localStorage.removeItem("offline_photo_queue");
      localStorage.removeItem("offline_comparative_session_queue");
      return "Offline photo + comparative queues cleared";
    },
    clearAdminToken() {
      localStorage.removeItem("admin_token");
      return "Admin token removed — you will need to log in again";
    },
    clearAllCache() {
      LOCAL_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
      return "All local caches cleared";
    },
  };

  const cacheStats = LOCAL_CACHE_KEYS.map((key) => {
    const raw = localStorage.getItem(key);
    let count = null;
    try { const parsed = JSON.parse(raw); count = Array.isArray(parsed) ? parsed.length : null; } catch {}
    const bytes = raw ? new Blob([raw]).size : 0;
    return { key, bytes, count };
  });

  if (!unlocked) {
    return (
      <div className="dev-lock-screen">
        <div className="dev-lock-box">
          <div className="dev-lock-title">Developer Access</div>
          <form onSubmit={unlock} className="dev-lock-form">
            <input
              type="password"
              autoFocus
              placeholder="Dev password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit">Unlock</button>
          </form>
          {error && <p className="dev-lock-error">{error}</p>}
          <button className="dev-back-link" onClick={() => onNavigate("kiosk")}>Back to Kiosk</button>
        </div>
      </div>
    );
  }

  return (
    <div className="dev-page">
      <div className="dev-header">
        <span className="dev-badge">DEV</span>
        <h1>Developer Tools</h1>
        <div className="dev-nav">
          <button onClick={() => onNavigate("kiosk")}>Kiosk</button>
          <button onClick={() => onNavigate("admin")}>Admin</button>
        </div>
      </div>

      <div className="dev-body">

        {/* ─── Cloud Data ─────────────────────────────────────────────────── */}
        <DevSection title="Cloud Data" desc="Permanently deletes records from Firebase Storage.">
          <DevAction
            label="Delete all cloud scan logs"
            tone="critical"
            loading={loading.deleteCloudLogs}
            result={results.deleteCloudLogs}
            onConfirm={() => run("deleteCloudLogs", actions.deleteCloudLogs)}
          />
          <DevAction
            label="Delete all cloud comparative sessions"
            tone="critical"
            loading={loading.deleteCloudSessions}
            result={results.deleteCloudSessions}
            onConfirm={() => run("deleteCloudSessions", actions.deleteCloudSessions)}
          />
        </DevSection>

        {/* ─── Local Server ───────────────────────────────────────────────── */}
        <DevSection title="Local Server" desc="Clears in-memory state on the Raspberry Pi server.">
          <DevAction
            label="Clear all local photos + reset sensor state"
            tone="warning"
            loading={loading.deleteLocalPhotos}
            result={results.deleteLocalPhotos}
            onConfirm={() => run("deleteLocalPhotos", actions.deleteLocalPhotos)}
          />
        </DevSection>

        {/* ─── Client Cache ───────────────────────────────────────────────── */}
        <DevSection title="Client Cache" desc="Clears data stored in this browser's localStorage.">
          <DevAction
            label="Clear single scan logs cache"
            tone="normal"
            loading={loading.clearSingleLogsCache}
            result={results.clearSingleLogsCache}
            onConfirm={() => run("clearSingleLogsCache", () => actions.clearSingleLogsCache())}
          />
          <DevAction
            label="Clear comparative sessions cache"
            tone="normal"
            loading={loading.clearComparativeCache}
            result={results.clearComparativeCache}
            onConfirm={() => run("clearComparativeCache", () => actions.clearComparativeCache())}
          />
          <DevAction
            label="Clear offline queues (photos + comparative)"
            tone="normal"
            loading={loading.clearOfflineQueues}
            result={results.clearOfflineQueues}
            onConfirm={() => run("clearOfflineQueues", () => actions.clearOfflineQueues())}
          />
          <DevAction
            label="Remove admin token (force re-login)"
            tone="warning"
            loading={loading.clearAdminToken}
            result={results.clearAdminToken}
            onConfirm={() => run("clearAdminToken", () => actions.clearAdminToken())}
          />
          <DevAction
            label="Clear ALL local caches"
            tone="critical"
            loading={loading.clearAllCache}
            result={results.clearAllCache}
            onConfirm={() => run("clearAllCache", () => actions.clearAllCache())}
          />
        </DevSection>

        {/* ─── localStorage Inspector ─────────────────────────────────────── */}
        <DevSection title="localStorage Inspector" desc="Current size of each cached key.">
          <table className="dev-table">
            <thead>
              <tr><th>Key</th><th>Records</th><th>Size</th></tr>
            </thead>
            <tbody>
              {cacheStats.map(({ key, bytes, count }) => (
                <tr key={key}>
                  <td className="dev-table-key">{key}</td>
                  <td>{count !== null ? count : "—"}</td>
                  <td>{bytes > 0 ? `${(bytes / 1024).toFixed(1)} KB` : "empty"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DevSection>

        {/* ─── Config ─────────────────────────────────────────────────────── */}
        <DevSection title="Config" desc="Runtime configuration values.">
          <div className="dev-config-row">
            <span>Local server URL</span>
            <code>{getApiBase()}</code>
          </div>
          <div className="dev-config-row">
            <span>Cloud API base</span>
            <code>{CLOUD_BASE}</code>
          </div>
          <div className="dev-config-row">
            <span>Admin token present</span>
            <code>{localStorage.getItem("admin_token") ? "yes" : "no"}</code>
          </div>
        </DevSection>

      </div>
    </div>
  );
}

function DevSection({ title, desc, children }) {
  return (
    <section className="dev-section">
      <div className="dev-section-header">
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      <div className="dev-section-body">{children}</div>
    </section>
  );
}

function DevAction({ label, tone, loading, result, onConfirm }) {
  const [confirming, setConfirming] = useState(false);

  function handleClick() {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    onConfirm();
  }

  return (
    <div className="dev-action">
      <span className="dev-action-label">{label}</span>
      <div className="dev-action-controls">
        {result && (
          <span className={`dev-action-result ${result.ok ? "ok" : "fail"}`}>{result.msg}</span>
        )}
        {confirming && !loading && (
          <button className="dev-cancel-btn" onClick={() => setConfirming(false)}>Cancel</button>
        )}
        <button
          className={`dev-run-btn ${tone} ${confirming ? "confirm" : ""}`}
          onClick={handleClick}
          disabled={loading}
        >
          {loading ? "Running…" : confirming ? "Confirm?" : "Run"}
        </button>
      </div>
    </div>
  );
}
