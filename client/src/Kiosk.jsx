import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  BarChart2,
  ChevronLeft,
  Zap,
  AlertTriangle,
  CheckCircle2,
  X,
  ScanLine,
  Maximize2,
  Settings
} from "lucide-react";
import { createAnnotatedJpegFromSource, createRawJpegFromVideo } from "./thermalOverlay";
import {
  ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY,
  drainComparativeSessionQueue,
  drainPhotoQueue,
  getApiBase,
  syncComparativeSessionToCloud,
  syncPhotoToCloud,
  upsertCachedRecord
} from "./api.js";
const SHOOT_POLL_MS = 2500;
const HOLD_DURATION_MS = 1500;

const RECOMMENDATIONS = {
  Critical: [
    "Immediate shutdown recommended — imminent failure risk",
    "Inspect for overloading or short-circuit conditions",
    "Check for loose or corroded connections",
    "Verify overcurrent protection devices",
    "Review IEC 60364-6:2016 compliance"
  ],
  Warning: [
    "Schedule maintenance within 24-48 hours",
    "Tighten and secure connections",
    "Inspect for corrosion or oxidation",
    "Verify load and current balance",
    "Ensure proper ventilation and remove debris"
  ],
  Normal: [
    "System operating within normal parameters",
    "Continue routine inspection schedule",
    "Document reading for trend analysis",
    "Ensure ventilation is unobstructed"
  ]
};

// EC 60364-6:2016 TODO recommendations (used for interactive checklists)
const EC_TODO = [
  "EC 60364-6:2016",
  "Tighten / Secure Connections",
  "Inspect / Clean for Corrosion or Oxidation",
  "Check for Signs of Arcing or Tracking",
  "Verify Load / Current Balance",
  "Ensure Proper Ventilation / Clean Dust or Debris"
];

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

function getComparativeRecommendation(delta) {
  if (!Number.isFinite(delta) || delta < 1) {
    return COMPARATIVE_RECOMMENDATIONS[0];
  }

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

function buildComparativeAnalysisSummary(scans) {
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
    scanCount: scans.length,
    tref,
    avgDelta,
    peakDelta: finiteDeltas.length ? Math.max(...finiteDeltas) : 0,
    avgTemperature: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : 0,
    minTemperature: temps.length ? Math.min(...temps) : 0,
    maxTemperature: temps.length ? Math.max(...temps) : 0,
    standardDeviation: Math.sqrt(variance),
    classificationCounts: {
      Critical: scans.filter((scan) => scan.classification === "Critical").length,
      Warning: scans.filter((scan) => scan.classification === "Warning").length,
      Normal: scans.filter((scan) => scan.classification === "Normal").length
    },
    overallRecommendation: getWorstComparativeRecommendation(finiteDeltas),
    scanAnalyses: scans.map((scan, index) => {
      const delta = Number(scan.temperature) - tref;
      return {
        id: scan.scanLogId || scan.id || scan.name,
        index: index + 1,
        temperature: Number(scan.temperature),
        delta,
        recommendation: getComparativeRecommendation(delta)
      };
    })
  };
}

function classifyReading(temp, ambient) {
  if (!Number.isFinite(temp) || !Number.isFinite(ambient)) return "Unknown";
  const diff = temp - ambient;
  const ratio = diff / ambient;
  if (ratio > 0.5 || diff > 50) return "Critical";
  if (ratio > 0.25 || diff > 25) return "Warning";
  return "Normal";
}

export default function Kiosk({ onAdminRequest }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const shootRef = useRef({ activeId: "", completedId: "" });
  const pollCtxRef = useRef({});
  const comparativeSessionIdRef = useRef("");

  const [page, setPage] = useState("idle");
  const [isCameraReady, setCameraReady] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [lastScan, setLastScan] = useState(null);          // single scan — one at a time
  const [comparativeScans, setComparativeScans] = useState([]); // comparative — accumulates
  const [showAdminModal, setShowAdminModal] = useState(false);

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    for (const track of streamRef.current.getTracks()) track.stop();
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setError("Camera unavailable."); return; }
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setError("Camera unavailable.");
    }
  }, [stopCamera]);

  useEffect(() => { startCamera(); return () => stopCamera(); }, [startCamera, stopCamera]);

  useEffect(() => {
    const flushQueues = async () => {
      await drainPhotoQueue();
      await drainComparativeSessionQueue();
    };

    flushQueues();
    const handleOnline = () => flushQueues();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // Re-attach stream when scan-page video mounts
  const videoCallbackRef = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const captureAndSave = useCallback(async (overrideScale = null, logContext = {}) => {
    setSaving(true);
    setError("");
    try {
      let scale = overrideScale;
      if (!scale) {
        setStatus("Reading sensor...");
        const res = await fetch(`${getApiBase()}/sensors/latest`, { cache: "no-store" });
        if (!res.ok) throw new Error("Sensor unavailable. Use the shoot API to provide temperature values.");
        const data = await res.json();
        scale = { temperature: Number(data.temperature), ambiance: Number(data.ambiance ?? data.ambient) };
        if (!Number.isFinite(scale.temperature) || !Number.isFinite(scale.ambiance)) throw new Error("Invalid sensor readings.");
        if (scale.temperature <= scale.ambiance) throw new Error("High temperature must exceed ambient.");
      }
      setStatus("Capturing...");
      const rawImage = createRawJpegFromVideo(videoRef.current);
      const imageData = await createAnnotatedJpegFromSource(rawImage.src, scale);
      setStatus("Saving...");
      const cloudPayload = { imageData, temperature: scale.temperature, ambiance: scale.ambiance, ...logContext };
      let photo = null;
      // Save to local server — always immediate, no waiting for internet
      const res = await fetch(`${getApiBase()}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloudPayload)
      });
      if (!res.ok) throw new Error("Failed to save photo to local server.");
      photo = await res.json();
      // Background sync to cloud — non-blocking, queues if offline
      syncPhotoToCloud(cloudPayload);
      setStatus("Captured!");
      const capturedAt = photo.loggedAt || photo.createdAt || new Date().toISOString();
      return {
        ...photo,
        classification: photo.classification || classifyReading(scale.temperature, scale.ambiance),
        temperature: scale.temperature,
        ambiance: scale.ambiance,
        timestamp: new Date(capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
    } catch (err) {
      setError(err.message);
      setStatus("");
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const captureSingleScan = useCallback(async (overrideScale = null) => {
    const scan = await captureAndSave(overrideScale, { source: "kiosk", mode: "single" });
    if (scan) setLastScan(scan); // replaces previous scan
  }, [captureAndSave]);

  const addComparativeScan = useCallback(async (overrideScale = null) => {
    const scan = await captureAndSave(overrideScale, {
      source: "kiosk",
      mode: "comparative",
      sessionId: comparativeSessionIdRef.current || undefined
    });
    if (scan) {
      if (scan.sessionId) {
        comparativeSessionIdRef.current = scan.sessionId;
      }
      setComparativeScans((prev) => [...prev, scan]);
    }
  }, [captureAndSave]);

  const completeComparativeSession = useCallback(async () => {
    const sessionId = comparativeSessionIdRef.current;
    if (!sessionId || comparativeScans.length < 2) return null;

    const analysis = buildComparativeAnalysisSummary(comparativeScans);

    try {
      const response = await fetch(`${getApiBase()}/scan-sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis })
      });
      if (!response.ok) throw new Error("Failed to save comparative analysis.");
      const savedSession = await response.json();
      upsertCachedRecord(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, {
        ...savedSession,
        scans: comparativeScans,
        analysis
      });
      syncComparativeSessionToCloud({ sessionId, analysis });
      return savedSession;
    } catch (err) {
      upsertCachedRecord(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, {
        id: sessionId,
        timestamp: comparativeScans[0]?.timestamp || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "completed",
        source: "kiosk",
        mode: "comparative",
        scanCount: comparativeScans.length,
        scans: comparativeScans,
        analysis
      });
      syncComparativeSessionToCloud({ sessionId, analysis });
      setError(err.message);
      return null;
    }
  }, [comparativeScans]);

  pollCtxRef.current = { page, isSaving, captureSingleScan, addComparativeScan };

  // Shoot-request polling on scan pages.
  // Polling starts as soon as the user is on a scan page — does NOT wait for
  // camera readiness. Camera is only checked at the moment of capture so that
  // shoot requests are visible in the network tab even before the camera feeds.
  useEffect(() => {
    if (page !== "singleScan" && page !== "comparative") return;
    let cancelled = false;
    const sr = shootRef.current;

    async function poll() {
      const ctx = pollCtxRef.current;
      if (cancelled || ctx.isSaving) return;
      try {
        const res = await fetch(`${getApiBase()}/camera/shoot`, { cache: "no-store" });
        if (res.status === 204) return;
        const request = await res.json();
        if (!request?.id || request.id === sr.activeId || request.id === sr.completedId) return;
        sr.activeId = request.id;
        try {
          const scale = { temperature: Number(request.temp), ambiance: Number(request.ambient ?? request.ambiance) };
          if (ctx.page === "singleScan") await ctx.captureSingleScan(scale);
          else await ctx.addComparativeScan(scale);
          await fetch(`${getApiBase()}/camera/shoot/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: request.id }) });
          sr.completedId = request.id;
        } finally { sr.activeId = ""; }
      } catch { /* silent — local server unreachable */ }
    }

    poll();
    const id = setInterval(poll, SHOOT_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [page]);

  const resetPage = () => {
    setPage("idle");
    setLastScan(null);
    setComparativeScans([]);
    comparativeSessionIdRef.current = "";
    setError("");
    setStatus("");
  };

  return (
    <div className="kiosk-shell">
      {/* Hidden long-press admin button */}
      <KioskAdminHint onPress={() => setShowAdminModal(true)} />

      {showAdminModal && (
        <AdminAccessModal
          onConfirm={() => { setShowAdminModal(false); onAdminRequest?.(); }}
          onClose={() => setShowAdminModal(false)}
        />
      )}

      {page === "idle" && <IdlePage onTouch={() => setPage("modeSelect")} />}

      {page === "modeSelect" && (
        <ModeSelectPage
          onSingleScan={() => setPage("singleScan")}
          onComparative={() => setPage("comparative")}
          onBack={() => setPage("idle")}
        />
      )}

      {page === "singleScan" && (
        <SingleScanPage
          videoCallbackRef={videoCallbackRef}
          isCameraReady={isCameraReady}
          isSaving={isSaving}
          status={status}
          error={error}
          scan={lastScan}
          onCapture={() => captureSingleScan()}
          onBack={resetPage}
        />
      )}

      {page === "comparative" && (
        <ComparativeAnalysisPage
          videoCallbackRef={videoCallbackRef}
          isCameraReady={isCameraReady}
          isSaving={isSaving}
          status={status}
          error={error}
          scans={comparativeScans}
          onCapture={() => addComparativeScan()}
          onAnalyze={completeComparativeSession}
          onBack={resetPage}
        />
      )}
    </div>
  );
}

// ─── Hidden Long-Press Admin Button ───────────────────────────────────────────

function KioskAdminHint({ onPress }) {
  const timerRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const [progress, setProgress] = useState(0);

  const startPress = (e) => {
    e.preventDefault();
    startRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.min((elapsed / HOLD_DURATION_MS) * 100, 100);
      setProgress(pct);
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setProgress(0);
        onPress();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const cancelPress = () => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(timerRef.current);
    setProgress(0);
  };

  const circumference = 2 * Math.PI * 14;
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <button
      className="kiosk-admin-hint"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      aria-label="Admin access"
    >
      <Settings size={14} />
      {progress > 0 && (
        <svg className="kiosk-hint-ring" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(25,184,122,0.7)" strokeWidth="2"
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            strokeLinecap="round" transform="rotate(-90 16 16)" />
        </svg>
      )}
    </button>
  );
}

// ─── Admin Access Modal ───────────────────────────────────────────────────────

function AdminAccessModal({ onConfirm, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="admin-access-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-access-icon"><Settings size={28} /></div>
        <h3>Admin Access</h3>
        <p>Switch to the admin panel?</p>
        <div className="admin-access-actions">
          <button className="admin-access-confirm" onClick={onConfirm}>Enter Admin Panel</button>
          <button className="admin-access-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Idle Page ────────────────────────────────────────────────────────────────

function IdlePage({ onTouch }) {
  return (
    <div className="kiosk-page idle-page" onClick={onTouch}>
      <div className="idle-scan-line" />
      <div className="idle-content">
        <div className="idle-icon-ring"><ScanLine size={48} strokeWidth={1.5} /></div>
        <h1 className="idle-title">Thermal Inspector</h1>
        <p className="idle-subtitle">Touch anywhere to begin</p>
        <div className="idle-pulse-ring" />
      </div>
    </div>
  );
}

// ─── Mode Select Page ─────────────────────────────────────────────────────────

function ModeSelectPage({ onSingleScan, onComparative, onBack }) {
  return (
    <div className="kiosk-page mode-select-page">
      <div className="mode-container">
        <h2 className="mode-heading">Select Mode</h2>
        <div className="mode-buttons">
          <button className="mode-card" onClick={onSingleScan}>
            <div className="mode-card-icon single"><Camera size={40} strokeWidth={1.5} /></div>
            <span className="mode-card-title">Single Scan</span>
            <span className="mode-card-desc">Capture and analyze one image</span>
          </button>
          <button className="mode-card" onClick={onComparative}>
            <div className="mode-card-icon comparative"><BarChart2 size={40} strokeWidth={1.5} /></div>
            <span className="mode-card-title">Comparative Analysis</span>
            <span className="mode-card-desc">Compare multiple captures</span>
          </button>
        </div>
        <button className="back-button" onClick={onBack}><ChevronLeft size={16} /> Back</button>
      </div>
    </div>
  );
}

// ─── Classification helpers ───────────────────────────────────────────────────

function ClassificationIcon({ classification, size = 13 }) {
  if (classification === "Critical") return <Zap size={size} className="class-icon critical" />;
  if (classification === "Warning") return <AlertTriangle size={size} className="class-icon warning" />;
  return <CheckCircle2 size={size} className="class-icon normal" />;
}

// Interactive checklist stored in localStorage per-key
function Checklist({ items = [], storageKeyPrefix = "checklist", idKey = "default" }) {
  const key = `${storageKeyPrefix}:${idKey}`;
  const [checked, setChecked] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(checked)); } catch {}
  }, [key, checked]);

  const toggle = (i) => {
    setChecked((prev) => ({ ...prev, [i]: !prev[i] }));
  };

  return (
    <div className="todo-checklist">
      <ul>
        {items.map((it, i) => (
          <li key={i} className={`todo-item ${checked[i] ? "done" : ""}`}>
            <label>
              <input type="checkbox" checked={!!checked[i]} onChange={() => toggle(i)} />
              <span className="todo-label">{it}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Fullscreen Modal ─────────────────────────────────────────────────────────

function FullscreenModal({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fullscreen-modal" onClick={onClose}>
      <button className="fullscreen-close-btn" onClick={onClose}><X size={22} /></button>
      <img src={url} alt="Thermal scan fullscreen" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ─── Single Scan Page ─────────────────────────────────────────────────────────

function SingleScanPage({ videoCallbackRef, isCameraReady, isSaving, status, error, scan, onCapture, onBack }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);

  const diff = scan ? (Number(scan.temperature) - Number(scan.ambiance)).toFixed(1) : null;
  const recs = EC_TODO; // use EC 60364-6:2016 interactive TODO recommendations for single-scan

  return (
    <div className="scan-layout single-layout">
      {/* Camera feed */}
      <div className="scan-main">
        <div className="scan-video-wrapper">
          <video ref={videoCallbackRef} autoPlay muted playsInline className="scan-video" />
          {!isCameraReady && <div className="scan-no-camera">Camera unavailable</div>}
        </div>
        <div className="scan-footer">
          <button className="back-button" onClick={onBack}><ChevronLeft size={16} /> Back</button>
          {(error || status) && (
            <span className={`scan-status-text ${error ? "is-error" : ""}`}>{error || status}</span>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="scan-sidebar single-sidebar">
        <div className="sidebar-header">
          <span>Single Scan</span>
        </div>

        <div className="single-scan-body">
          {!scan ? (
            <div className="sidebar-empty">Press Capture to take a thermal scan</div>
          ) : (
            <>
              {/* Image — clickable fullscreen */}
              <div className="single-image-wrap" onClick={() => setFullscreenUrl(scan.url)}>
                <img src={scan.url} alt="Thermal scan" className="single-image" />
                <div className="single-image-expand"><Maximize2 size={18} /></div>
              </div>

              {/* Details */}
              <div className="single-details">
                <div className="single-detail-row classification-row">
                  <ClassificationIcon classification={scan.classification} size={16} />
                  <span className={`scan-badge large ${scan.classification?.toLowerCase()}`}>
                    {scan.classification}
                  </span>
                </div>
                <div className="single-detail-row">
                  <span>High Temperature</span>
                  <strong>{scan.temperature}°C</strong>
                </div>
                <div className="single-detail-row">
                  <span>Ambient Temperature</span>
                  <strong>{scan.ambiance}°C</strong>
                </div>
                <div className="single-detail-row highlight-row">
                  <span>Temperature Difference</span>
                  <strong className={scan.classification?.toLowerCase()}>+{diff}°C</strong>
                </div>
                <div className="single-detail-row muted">
                  <span>Captured at</span>
                  <span>{scan.timestamp}</span>
                </div>
              </div>

              {/* Recommendations (interactive TODO checklist) */}
              <div className="single-recs">
                <h4>Recommendations</h4>
                <Checklist items={recs} storageKeyPrefix="single-scan" idKey={scan?.id ?? scan?.name ?? scan?.timestamp ?? "single"} />
              </div>
            </>
          )}
        </div>

        {/* Capture button removed per request (shoot API still active) */}
      </aside>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
    </div>
  );
}

// ─── Comparative Analysis Page ────────────────────────────────────────────────

function ComparativeAnalysisPage({ videoCallbackRef, isCameraReady, isSaving, status, error, scans, onCapture, onAnalyze, onBack }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleAnalyze = async () => {
    await onAnalyze?.();
    setShowAnalysis(true);
  };

  return (
    <div className="scan-layout">
      {/* Camera feed */}
      <div className="scan-main">
        <div className="scan-video-wrapper">
          <video ref={videoCallbackRef} autoPlay muted playsInline className="scan-video" />
          {!isCameraReady && <div className="scan-no-camera">Camera unavailable</div>}
        </div>
        <div className="scan-footer">
          <button className="back-button" onClick={onBack}><ChevronLeft size={16} /> Back</button>
          {(error || status) && (
            <span className={`scan-status-text ${error ? "is-error" : ""}`}>{error || status}</span>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="scan-sidebar">
        <div className="sidebar-header">
          <span>Comparative</span>
          <span className="sidebar-count">{scans.length} scans</span>
        </div>

        {/* Thumbnail grid */}
        <div className="comp-thumb-grid">
          {scans.length === 0 && (
            <div className="sidebar-empty">Capture scans to compare — add 2 or more</div>
          )}
          {scans.map((scan, idx) => (
            <div key={scan.name ?? idx} className="comp-thumb-item" onClick={() => setFullscreenUrl(scan.url)}>
              <img src={scan.url} alt={`Scan ${idx + 1}`} />
              <div className="comp-thumb-overlay">
                <span className="comp-thumb-num">#{idx + 1}</span>
                <ClassificationIcon classification={scan.classification} size={11} />
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-capture comp-actions">
          <button
            className="analyze-all-btn"
            onClick={handleAnalyze}
            disabled={scans.length < 2}
          >
            <BarChart2 size={18} />
            Analyze All ({scans.length})
          </button>
          {/* Add Scan button removed — captures still occur via external shoot requests */}
        </div>
      </aside>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
      {showAnalysis && <ComparativeAnalysisModal scans={scans} onClose={() => setShowAnalysis(false)} />}
    </div>
  );
}

// ─── Comparative Analysis Modal ───────────────────────────────────────────────

function ComparativeAnalysisModal({ scans, onClose }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);

  const temps = scans.map((scan) => Number(scan.temperature));
  const validTemps = temps.filter((value) => Number.isFinite(value));
  const tref = computeReferenceTemperature(validTemps);
  const deltas = scans.map((scan) => Number(scan.temperature) - tref);
  const avgDelta = deltas.length > 0 ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0;
  const deltaVariance = deltas.length > 0
    ? deltas.reduce((sum, value) => sum + Math.pow(value - avgDelta, 2), 0) / deltas.length
    : 0;
  const stdDev = Math.sqrt(deltaVariance).toFixed(1);
  const avgTemp = validTemps.length > 0 ? (validTemps.reduce((sum, value) => sum + value, 0) / validTemps.length).toFixed(1) : "0.0";
  const maxTemp = validTemps.length > 0 ? Math.max(...validTemps) : 0;
  const minTemp = validTemps.length > 0 ? Math.min(...validTemps) : 0;
  const avgDeltaValue = avgDelta.toFixed(1);
  const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;
  const chartMax = Math.max(maxTemp, tref, 1) * 1.15;
  const deltaChartMax = Math.max(maxDelta, 1) * 1.15;
  const overallRecommendation = getWorstComparativeRecommendation(deltas);

  const critical = scans.filter((s) => s.classification === "Critical").length;
  const warning  = scans.filter((s) => s.classification === "Warning").length;
  const normal   = scans.filter((s) => s.classification === "Normal").length;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="comp-analysis-modal" onClick={(e) => e.stopPropagation()}>
        <div className="comp-modal-header">
          <h2>Comparative Analysis</h2>
          <button className="analyze-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="comp-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Stats */}
          <div className="comp-stats">
            <div className="comp-stat-card">
              <div className="comp-stat-value">{tref.toFixed(1)}°C</div>
              <div className="comp-stat-label">TRef</div>
            </div>
            <div className="comp-stat-card peak">
              <div className="comp-stat-value">{avgDeltaValue}°C</div>
              <div className="comp-stat-label">Avg ΔT</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{maxDelta.toFixed(1)}°C</div>
              <div className="comp-stat-label">Peak ΔT</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{avgTemp}°C</div>
              <div className="comp-stat-label">Avg Temp</div>
            </div>
          </div>

          <div className={`comp-recommendation-callout ${overallRecommendation.tone}`}>
            <div className="comp-recommendation-title">Recommended action</div>
            <div className="comp-recommendation-text">{overallRecommendation.action}</div>
            <div className="comp-recommendation-meta">
              Highest ΔTref in this set: {maxDelta.toFixed(1)}°C
            </div>
          </div>

          {/* Classification chips */}
          <div className="comp-classification-row">
            <span className="cls-chip critical"><Zap size={12} /> {critical} Critical</span>
            <span className="cls-chip warning"><AlertTriangle size={12} /> {warning} Warning</span>
            <span className="cls-chip normal"><CheckCircle2 size={12} /> {normal} Normal</span>
          </div>

          <div className="comp-chart-section">
            <h3>Reference & Delta Charts</h3>
            <div className="comp-chart-area comp-reference-chart">
              <div className="comp-chart-label-row">
                <span>Temperature vs reference</span>
                <span>TRef = average of collected temperatures after outlier removal</span>
              </div>
              <div className="comp-chart-temp-wrap">
                <div className="comp-reference-line" style={{ bottom: `${(tref / chartMax) * 100}%` }}>
                  <span>TRef {tref.toFixed(1)}°C</span>
                </div>
                <div className="comp-chart">
                  {scans.map((scan, index) => {
                    const temp = Number(scan.temperature);
                    const delta = Number(temp) - tref;
                    const recommendation = getComparativeRecommendation(delta);
                    const height = Number.isFinite(temp) ? Math.max((temp / chartMax) * 140, 4) : 4;
                    return (
                      <div key={scan.name ?? index} className="chart-group comp-chart-group">
                        <div className={`chart-bar high ${recommendation.tone}`} style={{ height: `${height}px` }} title={`Temp ${temp.toFixed(1)}°C`} />
                        <div className="chart-group-label">#{index + 1}</div>
                        <div className="comp-delta-value">Δ {delta.toFixed(1)}°C</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="chart-legend">
                <span><span className="legend-dot high" />Temp</span>
                <span><span className="legend-dot ref" />TRef</span>
              </div>
            </div>

            <div className="comp-chart-area comp-delta-chart">
              <div className="comp-chart-label-row">
                <span>Temperature difference</span>
                <span>ΔT = Temperature - TRef</span>
              </div>
              <div className="comp-delta-grid">
                {scans.map((scan, index) => {
                  const temp = Number(scan.temperature);
                  const delta = Number(temp) - tref;
                  const recommendation = getComparativeRecommendation(delta);
                  const height = Math.max((Math.max(delta, 0) / deltaChartMax) * 110, 4);
                  return (
                    <div key={scan.name ?? index} className="comp-delta-item">
                      <div className="comp-delta-track">
                        <div className={`comp-delta-bar ${recommendation.tone}`} style={{ height: `${height}px` }} />
                      </div>
                      <div className="comp-delta-label">#{index + 1}</div>
                      <div className="comp-delta-value">{delta.toFixed(1)}°C</div>
                    </div>
                  );
                })}
              </div>
              <div className="chart-legend">
                <span><span className="legend-dot delta" />ΔT per component</span>
              </div>
            </div>
          </div>

          <div className="comp-table-section">
            <h3>Scan Details</h3>
            <table className="comp-details-table">
              <thead>
                <tr><th>#</th><th>Temp (°C)</th><th>TRef (°C)</th><th>ΔT (°C)</th><th>Recommended action</th><th>Captured</th></tr>
              </thead>
              <tbody>
                {scans.map((scan, index) => {
                  const temp = Number(scan.temperature);
                  const delta = Number(temp) - tref;
                  const recommendation = getComparativeRecommendation(delta);
                  return (
                    <tr key={scan.name ?? index}>
                      <td>#{index + 1}</td>
                      <td>{Number.isFinite(temp) ? temp.toFixed(1) : "-"}</td>
                      <td>{tref.toFixed(1)}</td>
                      <td>{delta.toFixed(1)}</td>
                      <td>
                        <span className={`scan-badge ${recommendation.tone}`}>{recommendation.label}</span>
                      </td>
                      <td>{scan.timestamp ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Image grid */}
          <div className="comp-images-section">
            <h3>Captured Images ({scans.length})</h3>
            <div className="comp-image-grid">
              {scans.map((scan, i) => (
                <div key={i} className="comp-image-item" onClick={() => setFullscreenUrl(scan.url)}>
                  <img src={scan.url} alt={`Scan ${i + 1}`} />
                  <span className="comp-image-num">#{i + 1}</span>
                  <div className="comp-image-footer">
                    <span className={`scan-badge ${scan.classification?.toLowerCase()}`}>{scan.classification}</span>
                    <span className="comp-image-temp">{scan.temperature}°C</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommendations for comparative analysis (interactive TODO) */}
          <div className="comp-recs-section">
            <h3>Recommendations</h3>
            <p>Actions are selected from the comparative temperature-difference table: 1°C-3°C possible deficiency, 4°C-15°C probable deficiency, and above 15°C major discrepancy.</p>
            <Checklist items={EC_TODO.slice(1)} storageKeyPrefix="comparative" idKey="comparative-overview" />
            <p className="analysis-summary">
              TRef: {tref.toFixed(1)}°C. Average ΔT: {avgDeltaValue}°C. Standard deviation: {stdDev}°C.
            </p>
          </div>
        </div>
      </div>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
    </div>
  );
}
