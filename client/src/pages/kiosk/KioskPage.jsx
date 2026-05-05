import { useCallback, useEffect, useRef, useState } from "react";
import { createAnnotatedJpegFromSource, createRawJpegFromVideo } from "../../thermalOverlay";
import {
  ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY,
  drainComparativeSessionQueue,
  drainPhotoQueue,
  getApiBase,
  syncComparativeSessionToCloud,
  syncPhotoToCloud,
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

export default function KioskPage({ onAdminRequest }) {
  const videoRef               = useRef(null);
  const streamRef              = useRef(null);
  const shootRef               = useRef({ activeId: "", completedId: "" });
  const pollCtxRef             = useRef({});
  const comparativeSessionIdRef = useRef("");

  const [page, setPage]                     = useState("idle");
  const [isCameraReady, setCameraReady]     = useState(false);
  const [isSaving, setSaving]               = useState(false);
  const [error, setError]                   = useState("");
  const [status, setStatus]                 = useState("");
  const [lastScan, setLastScan]             = useState(null);
  const [comparativeScans, setComparativeScans] = useState([]);
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
    const flush = async () => { await drainPhotoQueue(); await drainComparativeSessionQueue(); };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
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
        const res = await fetch(`${getApiBase()}/sensors/latest`, { cache: "no-store" });
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
      const res = await fetch(`${getApiBase()}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to save photo to local server.");
      const photo = await res.json();
      syncPhotoToCloud(payload);
      setStatus("Captured!");
      const capturedAt = photo.loggedAt || photo.createdAt || new Date().toISOString();
      return {
        ...photo,
        classification: photo.classification || classifyReading(scale.temperature, scale.ambiance),
        temperature: scale.temperature,
        ambiance:    scale.ambiance,
        timestamp:   new Date(capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
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
    const scan = await captureAndSave(overrideScale, {
      source: "kiosk",
      mode: "comparative",
      sessionId: comparativeSessionIdRef.current || undefined
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
      const res = await fetch(`${getApiBase()}/scan-sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis })
      });
      if (!res.ok) throw new Error("Failed to save comparative analysis.");
      const saved = await res.json();
      upsertCachedRecord(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, { ...saved, scans: comparativeScans, analysis });
      syncComparativeSessionToCloud({ sessionId, analysis });
      return saved;
    } catch (err) {
      upsertCachedRecord(ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY, {
        id: sessionId,
        timestamp:   comparativeScans[0]?.timestamp || new Date().toISOString(),
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
        const res = await fetch(`${getApiBase()}/camera/shoot`, { cache: "no-store" });
        if (res.status === 204) return;
        const request = await res.json();
        if (!request?.id || request.id === sr.activeId || request.id === sr.completedId) return;
        sr.activeId = request.id;
        try {
          const scale = { temperature: Number(request.temp), ambiance: Number(request.ambient ?? request.ambiance) };
          if (ctx.page === "singleScan") await ctx.captureSingleScan(scale);
          else await ctx.addComparativeScan(scale);
          await fetch(`${getApiBase()}/camera/shoot/complete`, {
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
