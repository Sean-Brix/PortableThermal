import { useCallback, useEffect, useRef, useState } from "react";
import { createAnnotatedJpegFromSource, createRawJpegFromVideo } from "../../thermalOverlay";
import {
  ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY,
  fetchLocalFirst,
  readLocalCache,
  savePhotoLocalFirst,
  syncComparativeSessionToCloud,
  writeLocalCache,
  upsertCachedRecord
} from "../../api.js";
import { classifyReading, buildComparativeAnalysisSummary } from "../../utils/thermalUtils";
import { SHOOT_POLL_MS } from "./kioskConstants";
import KioskAdminHint from "./KioskAdminHint";
import AdminAccessModal from "./AdminAccessModal";
import IdlePage from "./IdlePage";
import ModeSelectPage from "./ModeSelectPage";
import SingleScanPage from "./SingleScanPage";
import ComparativeAnalysisPage from "./ComparativeAnalysisPage";
import { formatTime } from "../../utils/formatUtils";

const KIOSK_STATE_CACHE_KEY = "cached_kiosk_state";
const KIOSK_BOOT_MIN_MS = 650;
const VALID_KIOSK_PAGES = new Set(["idle", "modeSelect", "singleScan", "comparative"]);

function readKioskState() {
  const cached = readLocalCache(KIOSK_STATE_CACHE_KEY, {});
  const page = VALID_KIOSK_PAGES.has(cached?.page) ? cached.page : "idle";
  return {
    page,
    lastScan: cached?.lastScan || null,
    comparativeScans: Array.isArray(cached?.comparativeScans) ? cached.comparativeScans : [],
    comparativeSessionId: typeof cached?.comparativeSessionId === "string" ? cached.comparativeSessionId : ""
  };
}

export default function KioskPage({ onAdminRequest }) {
  const restoredStateRef = useRef(readKioskState());
  const videoRef               = useRef(null);
  const streamRef              = useRef(null);
  const shootRef               = useRef({ activeId: "", completedId: "" });
  const pollCtxRef             = useRef({});
  const comparativeSessionIdRef = useRef(restoredStateRef.current.comparativeSessionId);

  const [page, setPage]                     = useState(() => restoredStateRef.current.page);
  const [isBooting, setBooting]             = useState(true);
  const [isCameraReady, setCameraReady]     = useState(false);
  const [isSaving, setSaving]               = useState(false);
  const [error, setError]                   = useState("");
  const [status, setStatus]                 = useState("");
  const [lastScan, setLastScan]             = useState(() => restoredStateRef.current.lastScan);
  const [comparativeScans, setComparativeScans] = useState(() => restoredStateRef.current.comparativeScans);
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

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function bootKiosk() {
      await startCamera();
      const remaining = Math.max(0, KIOSK_BOOT_MIN_MS - (Date.now() - startedAt));
      window.setTimeout(() => {
        if (!cancelled) setBooting(false);
      }, remaining);
    }

    bootKiosk();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    try {
      writeLocalCache(KIOSK_STATE_CACHE_KEY, {
        page,
        lastScan,
        comparativeScans,
        comparativeSessionId: comparativeSessionIdRef.current,
        updatedAt: new Date().toISOString()
      });
    } catch {
      // If storage is full, the kiosk still runs; queued photo sync keeps the important payloads.
    }
  }, [page, lastScan, comparativeScans]);

  useEffect(() => {
    let wakeLock = null;
    let disposed = false;

    async function requestWakeLock() {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      try {
        wakeLock = await navigator.wakeLock.request("screen");
      } catch {
        wakeLock = null;
      }
    }

    const handleVisibilityChange = () => {
      if (!disposed && document.visibilityState === "visible") requestWakeLock();
    };

    requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      wakeLock?.release?.().catch(() => {});
    };
  }, []);

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
        const res = await fetchLocalFirst("/sensors/latest", { cache: "no-store" });
        if (!res.ok) throw new Error("Sensor unavailable. Use the shoot API to provide temperature values.");
        const data = await res.json();
        scale = { temperature: Number(data.temperature), ambiance: Number(data.ambiance ?? data.ambient) };
        if (!Number.isFinite(scale.temperature) || !Number.isFinite(scale.ambiance)) throw new Error("Invalid sensor readings.");
        if (scale.temperature <= scale.ambiance) throw new Error("High temperature must exceed ambient.");
      }
      setStatus("Capturing...");
      const rawImage  = createRawJpegFromVideo(videoRef.current);
      const imageData = await createAnnotatedJpegFromSource(rawImage.src, scale);
      setStatus("Saving...");
      const payload = { imageData, temperature: scale.temperature, ambiance: scale.ambiance, ...logContext };
      const { photo, queued } = await savePhotoLocalFirst(payload);
      setStatus(queued ? "Captured offline. Sync pending." : "Captured!");
      const capturedAt = photo.loggedAt || photo.createdAt || new Date().toISOString();
      return {
        ...photo,
        classification: photo.classification || classifyReading(scale.temperature, scale.ambiance),
        temperature: scale.temperature,
        ambiance:    scale.ambiance,
        capturedAt,
        timestamp:   capturedAt,
        displayTime: formatTime(capturedAt)
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
    if (scan) setLastScan(scan);
  }, [captureAndSave]);

  const addComparativeScan = useCallback(async (overrideScale = null) => {
    if (!comparativeSessionIdRef.current) comparativeSessionIdRef.current = crypto.randomUUID();
    const scan = await captureAndSave(overrideScale, {
      source: "kiosk",
      mode: "comparative",
      sessionId: comparativeSessionIdRef.current
    });
    if (scan) {
      if (scan.sessionId) comparativeSessionIdRef.current = scan.sessionId;
      setComparativeScans((prev) => [...prev, scan]);
    }
  }, [captureAndSave]);

  const completeComparativeSession = useCallback(async () => {
    const sessionId = comparativeSessionIdRef.current;
    if (!sessionId || comparativeScans.length < 2) return null;
    const analysis = buildComparativeAnalysisSummary(comparativeScans);
    try {
      const res = await fetchLocalFirst(`/scan-sessions/${encodeURIComponent(sessionId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis })
      }, { fallbackOnHttp: true });
      if (!res.ok) throw new Error("Failed to save comparative analysis.");
      const saved = await res.json();
      upsertCachedRecord(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, { ...saved, scans: comparativeScans, analysis });
      if (res.apiSource !== "cloud") syncComparativeSessionToCloud({ sessionId, analysis });
      return saved;
    } catch (err) {
      upsertCachedRecord(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, {
        id: sessionId,
        timestamp:   comparativeScans[0]?.createdAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "completed",
        source: "kiosk",
        mode:   "comparative",
        scanCount: comparativeScans.length,
        scans: comparativeScans,
        analysis
      });
      syncComparativeSessionToCloud({ sessionId, analysis });
      setError(err.message);
      return null;
    }
  }, [comparativeScans]);

  const clearComparativeSession = useCallback(() => {
    setComparativeScans([]);
    comparativeSessionIdRef.current = "";
  }, []);

  const markComparativeSessionComplete = useCallback(async () => {
    await completeComparativeSession();
    clearComparativeSession();
  }, [clearComparativeSession, completeComparativeSession]);

  pollCtxRef.current = { page, isSaving, captureSingleScan, addComparativeScan };

  useEffect(() => {
    if (page !== "singleScan" && page !== "comparative") return;
    let cancelled = false;
    const sr = shootRef.current;

    async function poll() {
      const ctx = pollCtxRef.current;
      if (cancelled || ctx.isSaving) return;
      try {
        const res = await fetchLocalFirst("/camera/shoot", { cache: "no-store" });
        if (res.status === 204) return;
        const request = await res.json();
        if (!request?.id || request.id === sr.activeId || request.id === sr.completedId) return;
        sr.activeId = request.id;
        try {
          const scale = { temperature: Number(request.temp), ambiance: Number(request.ambient ?? request.ambiance) };
          if (ctx.page === "singleScan") await ctx.captureSingleScan(scale);
          else await ctx.addComparativeScan(scale);
          await fetchLocalFirst("/camera/shoot/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: request.id })
          });
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

  if (isBooting) {
    return (
      <div className="kiosk-shell">
        <KioskBootScreen
          restored={restoredStateRef.current.page !== "idle" || restoredStateRef.current.comparativeScans.length > 0}
          scanCount={restoredStateRef.current.comparativeScans.length}
        />
      </div>
    );
  }

  return (
    <div className="kiosk-shell">
      {page === "idle" && <KioskAdminHint onPress={() => setShowAdminModal(true)} />}

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
          onComplete={markComparativeSessionComplete}
          onBack={resetPage}
        />
      )}
    </div>
  );
}

function KioskBootScreen({ restored, scanCount }) {
  return (
    <div className="kiosk-page kiosk-boot-screen">
      <div className="kiosk-boot-mark">
        <span />
        <span />
        <span />
      </div>
      <div className="kiosk-boot-copy">
        <h1>PortableThermal</h1>
        <p>{restored ? `Restoring kiosk session${scanCount ? ` with ${scanCount} cached scan${scanCount === 1 ? "" : "s"}` : ""}...` : "Preparing kiosk mode..."}</p>
      </div>
      <div className="kiosk-boot-meter"><span /></div>
    </div>
  );
}
