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

const API_BASE = "/api";
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

  // Re-attach stream when scan-page video mounts
  const videoCallbackRef = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const captureAndSave = useCallback(async (overrideScale = null) => {
    if (!videoRef.current?.videoWidth) { setError("Camera not ready."); return null; }
    setSaving(true);
    setError("");
    try {
      let scale = overrideScale;
      if (!scale) {
        setStatus("Reading sensor...");
        const res = await fetch(`${API_BASE}/sensors/latest`, { cache: "no-store" });
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
      const res = await fetch(`${API_BASE}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData, temperature: scale.temperature, ambiance: scale.ambiance })
      });
      if (!res.ok) throw new Error("Failed to save photo.");
      const photo = await res.json();
      setStatus("Captured!");
      return { ...photo, classification: classifyReading(scale.temperature, scale.ambiance), timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    } catch (err) {
      setError(err.message);
      setStatus("");
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const captureSingleScan = useCallback(async (overrideScale = null) => {
    const scan = await captureAndSave(overrideScale);
    if (scan) setLastScan(scan); // replaces previous scan
  }, [captureAndSave]);

  const addComparativeScan = useCallback(async (overrideScale = null) => {
    const scan = await captureAndSave(overrideScale);
    if (scan) setComparativeScans((prev) => [...prev, scan]);
  }, [captureAndSave]);

  pollCtxRef.current = { page, isSaving, captureSingleScan, addComparativeScan };

  // Shoot-request polling on scan pages
  useEffect(() => {
    if (page !== "singleScan" && page !== "comparative") return;
    if (!isCameraReady) return;
    let cancelled = false;
    const sr = shootRef.current;

    async function poll() {
      const ctx = pollCtxRef.current;
      if (cancelled || ctx.isSaving || !videoRef.current?.videoWidth) return;
      try {
        const res = await fetch(`${API_BASE}/camera/shoot`, { cache: "no-store" });
        if (res.status === 204) return;
        const request = await res.json();
        if (!request?.id || request.id === sr.activeId || request.id === sr.completedId) return;
        sr.activeId = request.id;
        try {
          const scale = { temperature: Number(request.temp), ambiance: Number(request.ambient ?? request.ambiance) };
          if (ctx.page === "singleScan") await ctx.captureSingleScan(scale);
          else await ctx.addComparativeScan(scale);
          await fetch(`${API_BASE}/camera/shoot/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: request.id }) });
          sr.completedId = request.id;
        } finally { sr.activeId = ""; }
      } catch { /* silent */ }
    }

    poll();
    const id = setInterval(poll, SHOOT_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [page, isCameraReady]);

  const resetPage = () => {
    setPage("idle");
    setLastScan(null);
    setComparativeScans([]);
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
  const recs = scan ? (RECOMMENDATIONS[scan.classification] ?? RECOMMENDATIONS.Normal) : [];

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

              {/* Recommendations */}
              <div className="single-recs">
                <h4>Recommendations</h4>
                <ul>
                  {recs.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            </>
          )}
        </div>

        <div className="sidebar-capture">
          <button
            className={`capture-big-button ${isSaving ? "is-saving" : ""}`}
            onClick={onCapture}
            disabled={!isCameraReady || isSaving}
          >
            <Camera size={22} strokeWidth={2} />
            {isSaving ? "Processing..." : scan ? "Rescan" : "Capture"}
          </button>
        </div>
      </aside>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
    </div>
  );
}

// ─── Comparative Analysis Page ────────────────────────────────────────────────

function ComparativeAnalysisPage({ videoCallbackRef, isCameraReady, isSaving, status, error, scans, onCapture, onBack }) {
  const [fullscreenUrl, setFullscreenUrl] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

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
            onClick={() => setShowAnalysis(true)}
            disabled={scans.length < 2}
          >
            <BarChart2 size={18} />
            Analyze All ({scans.length})
          </button>
          <button
            className={`capture-big-button ${isSaving ? "is-saving" : ""}`}
            onClick={onCapture}
            disabled={!isCameraReady || isSaving}
          >
            <Camera size={22} strokeWidth={2} />
            {isSaving ? "Processing..." : "Add Scan"}
          </button>
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

  const temps = scans.map((s) => Number(s.temperature));
  const ambients = scans.map((s) => Number(s.ambiance));
  const avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
  const maxTemp = Math.max(...temps);
  const minTemp = Math.min(...temps);
  const avgAmbient = (ambients.reduce((a, b) => a + b, 0) / ambients.length).toFixed(1);
  const chartMax = Math.max(...temps, ...ambients) * 1.15;

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

        <div className="comp-modal-body">
          {/* Stats */}
          <div className="comp-stats">
            <div className="comp-stat-card">
              <div className="comp-stat-value">{avgTemp}°C</div>
              <div className="comp-stat-label">Avg High Temp</div>
            </div>
            <div className="comp-stat-card peak">
              <div className="comp-stat-value">{maxTemp}°C</div>
              <div className="comp-stat-label">Peak Temp</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{minTemp}°C</div>
              <div className="comp-stat-label">Lowest High</div>
            </div>
            <div className="comp-stat-card">
              <div className="comp-stat-value">{avgAmbient}°C</div>
              <div className="comp-stat-label">Avg Ambient</div>
            </div>
          </div>

          {/* Classification chips */}
          <div className="comp-classification-row">
            <span className="cls-chip critical"><Zap size={12} /> {critical} Critical</span>
            <span className="cls-chip warning"><AlertTriangle size={12} /> {warning} Warning</span>
            <span className="cls-chip normal"><CheckCircle2 size={12} /> {normal} Normal</span>
          </div>

          {/* Bar chart */}
          <div className="comp-chart-section">
            <h3>Temperature per Scan</h3>
            <div className="comp-chart-area">
              <div className="comp-chart">
                {scans.map((scan, i) => {
                  const temp = Number(scan.temperature);
                  const amb = Number(scan.ambiance);
                  const tempH = Math.round((temp / chartMax) * 160);
                  const ambH = Math.round((amb / chartMax) * 160);
                  return (
                    <div key={i} className="chart-group">
                      <div className="chart-bars-wrapper">
                        <div className={`chart-bar high ${scan.classification?.toLowerCase()}`} style={{ height: tempH }} title={`${temp}°C`} />
                        <div className="chart-bar ambient" style={{ height: ambH }} title={`${amb}°C`} />
                      </div>
                      <span className="chart-group-label">#{i + 1}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="chart-legend">
              <span><span className="legend-dot high" /> High Temp</span>
              <span><span className="legend-dot ambient" /> Ambient</span>
            </div>
          </div>

          {/* Image grid */}
          <div className="comp-images-section">
            <h3>Captured Images ({scans.length})</h3>
            <div className="comp-image-grid">
              {scans.map((scan, i) => (
                <div key={i} className="comp-image-item" onClick={() => setFullscreenUrl(scan.url)}>
                  <img src={scan.url} alt={`Scan ${i + 1}`} />
                  <div className="comp-image-footer">
                    <span className={`scan-badge ${scan.classification?.toLowerCase()}`}>{scan.classification}</span>
                    <span className="comp-image-temp">{scan.temperature}°C</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {fullscreenUrl && <FullscreenModal url={fullscreenUrl} onClose={() => setFullscreenUrl(null)} />}
    </div>
  );
}
