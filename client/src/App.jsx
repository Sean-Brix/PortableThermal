import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import {
  createAnnotatedJpegFromSource,
  createRawJpegFromFile,
  createRawJpegFromVideo
} from "./thermalOverlay";
import Kiosk from "./Kiosk";
import Admin from "./Admin";

const SHOOT_POLL_INTERVAL_MS = 2500;
const API_BASE = "/api";

export default function AppRouter() {
  const [isAdminAuth, setIsAdminAuth] = useState(() => !!localStorage.getItem("admin_token"));

  const [currentPage, setCurrentPage] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("/camera") && !!localStorage.getItem("admin_token")) return "camera";
    if (path.includes("/admin")) return "admin";
    return "kiosk";
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path.includes("/camera") && isAdminAuth) setCurrentPage("camera");
      else if (path.includes("/admin")) setCurrentPage("admin");
      else setCurrentPage("kiosk");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isAdminAuth]);

  const navigateTo = (page) => {
    if (page === "camera" && !isAdminAuth) page = "admin";
    setCurrentPage(page);
    const paths = { camera: "/camera", kiosk: "/kiosk", admin: "/admin" };
    window.history.pushState({}, "", paths[page] ?? "/kiosk");
  };

  const handleAuthChange = (authenticated) => {
    setIsAdminAuth(authenticated);
    if (!authenticated && currentPage === "camera") {
      setCurrentPage("kiosk");
      window.history.pushState({}, "", "/kiosk");
    }
  };

  // Admin — full screen with its own sidebar, no AppNav
  if (currentPage === "admin") {
    return (
      <Admin
        onAuthChange={handleAuthChange}
        onNavigate={navigateTo}
        isAdminAuth={isAdminAuth}
      />
    );
  }

  // Camera — only when authenticated, shows slim top nav
  if (currentPage === "camera" && isAdminAuth) {
    return (
      <div className="app-wrapper">
        <CameraNav onNavigate={navigateTo} />
        <CameraApp />
      </div>
    );
  }

  // Kiosk — full screen, no AppNav; hidden long-press admin button built in
  return <Kiosk onAdminRequest={() => navigateTo("admin")} />;
}

// Minimal nav only for the Camera page
function CameraNav({ onNavigate }) {
  return (
    <nav className="app-nav">
      <div className="nav-brand">PortableThermal</div>
      <div className="nav-links">
        <button className="nav-link active">
          <Camera size={15} /> Camera
        </button>
        <button className="nav-link" onClick={() => onNavigate("kiosk")}>
          Kiosk
        </button>
        <button className="nav-link" onClick={() => onNavigate("admin")}>
          Admin
        </button>
      </div>
    </nav>
  );
}

function CameraApp() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState("Loading gallery...");
  const [error, setError] = useState("");
  const [isCameraReady, setCameraReady] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [deletingPhotoName, setDeletingPhotoName] = useState("");
  const [temperatureInput, setTemperatureInput] = useState("");
  const [ambianceInput, setAmbianceInput] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const activeShootRequestRef = useRef("");
  const completedShootRequestRef = useRef("");

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    for (const track of streamRef.current.getTracks()) track.stop();
    streamRef.current = null;
  }, []);

  const loadGallery = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/photos`);
      const data = await readJson(response);
      setPhotos(data.photos);
      setStatus(data.photos.length ? "Gallery updated." : "No photos yet.");
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not available in this browser.");
      return;
    }
    stopCamera();
    setCameraReady(false);
    setError("");
    setStatus("Starting camera...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraReady(true);
      setStatus("Camera ready.");
    } catch (err) {
      setError(cameraErrorMessage(err));
      setStatus("Camera unavailable.");
    }
  }, [stopCamera]);

  useEffect(() => {
    loadGallery();
    startCamera();
    return () => stopCamera();
  }, [loadGallery, startCamera, stopCamera]);

  useEffect(() => {
    function closeOnEscape(e) { if (e.key === "Escape") setSelectedPhoto(null); }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  useEffect(() => {
    if (!isCameraReady) return undefined;
    let cancelled = false;

    async function pollShootRequests() {
      if (cancelled || isSaving || !videoRef.current?.videoWidth) return;
      try {
        const response = await fetch(`${API_BASE}/camera/shoot`, { cache: "no-store" });
        if (response.status === 204) return;
        const request = await readJson(response);
        if (!request?.id || request.id === activeShootRequestRef.current || request.id === completedShootRequestRef.current) return;
        activeShootRequestRef.current = request.id;
        try {
          await captureAndSavePhoto({ temperature: request.temp, ambiance: request.ambient });
          await fetch(`${API_BASE}/camera/shoot/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: request.id })
          });
          completedShootRequestRef.current = request.id;
        } finally {
          activeShootRequestRef.current = "";
        }
      } catch (err) {
        if (!cancelled) { setError(err.message); setStatus("Waiting for camera shoot request..."); }
      }
    }

    pollShootRequests();
    const intervalId = window.setInterval(pollShootRequests, SHOOT_POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [isCameraReady, isSaving]);

  async function capturePhoto() {
    if (!isCameraReady || !videoRef.current?.videoWidth) { setError("Camera is not ready yet."); return; }
    setError("");
    setStatus("Reading sensor values...");
    try {
      const scale = await resolveThermalScale(temperatureInput, ambianceInput);
      await captureAndSavePhoto(scale);
    } catch (err) {
      setError(err.message);
      setStatus("Could not save photo.");
    }
  }

  async function uploadPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSaving(true);
    setError("");
    setStatus("Reading sensor values...");
    try {
      const scale = await resolveThermalScale(temperatureInput, ambianceInput);
      setStatus("Analyzing thermal image...");
      const rawImage = await createRawJpegFromFile(file);
      await saveAutoAnnotatedPhoto(rawImage, scale);
    } catch (err) {
      setError(err.message);
      setStatus("Could not save photo.");
    } finally {
      setSaving(false);
    }
  }

  async function captureAndSavePhoto(scale) {
    setSaving(true);
    setError("");
    setStatus("Analyzing thermal image...");
    try {
      const rawImage = createRawJpegFromVideo(videoRef.current);
      await saveAutoAnnotatedPhoto(rawImage, scale);
    } finally {
      setSaving(false);
    }
  }

  async function saveAutoAnnotatedPhoto(rawImage, scale) {
    const imageData = await createAnnotatedJpegFromSource(rawImage.src, scale);
    setStatus("Saving photo...");
    const response = await fetch(`${API_BASE}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageData, temperature: scale.temperature, ambiance: scale.ambiance })
    });
    const photo = await readJson(response);
    setPhotos((current) => [photo, ...current]);
    setStatus("Photo saved with automatic thermal markers.");
  }

  async function deletePhoto(photo) {
    if (!window.confirm("Delete this photo?")) return;
    setDeletingPhotoName(photo.name);
    setError("");
    setStatus("Deleting photo...");
    try {
      const response = await fetch(`${API_BASE}/photos/${encodeURIComponent(photo.name)}`, { method: "DELETE" });
      await readJson(response);
      setPhotos((current) => current.filter((item) => item.name !== photo.name));
      setStatus("Photo deleted.");
    } catch (err) {
      setError(err.message);
      setStatus("Could not delete photo.");
    } finally {
      setDeletingPhotoName("");
    }
  }

  return (
    <main className="app-shell">
      <section className="camera-panel" aria-label="Camera">
        <div className="top-bar">
          <h1>Camera</h1>
          <button className="secondary-button" type="button" onClick={startCamera}>Start Camera</button>
        </div>

        <div className={`camera-frame ${isCameraReady ? "is-live" : ""}`}>
          <video ref={videoRef} autoPlay muted playsInline />
          <div className="camera-placeholder">{isCameraReady ? "" : "Starting camera..."}</div>
        </div>

        <div className="thermal-inputs">
          <label>
            <span>Temperature</span>
            <input type="number" inputMode="decimal" step="any" value={temperatureInput} onChange={(e) => setTemperatureInput(e.target.value)} placeholder="Sensor high" />
          </label>
          <label>
            <span>Ambiance</span>
            <input type="number" inputMode="decimal" step="any" value={ambianceInput} onChange={(e) => setAmbianceInput(e.target.value)} placeholder="Sensor ambient" />
          </label>
        </div>

        <div className="controls">
          <div className="capture-actions">
            <button className={`capture-button ${isSaving ? "is-saving" : ""}`} type="button" onClick={capturePhoto} disabled={!isCameraReady || isSaving}>
              {isSaving ? "Saving..." : "Take Photo"}
            </button>
            <input ref={fileInputRef} className="file-input" type="file" accept="image/*" onChange={uploadPhoto} />
            <button className="icon-button" type="button" aria-label="Upload photo" onClick={() => fileInputRef.current?.click()} disabled={isSaving}>
              <UploadIcon />
            </button>
          </div>
          <button className="secondary-button" type="button" onClick={loadGallery} disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh Gallery"}
          </button>
        </div>

        <p className={`status ${error ? "is-error" : ""}`} aria-live="polite">{error || status}</p>
      </section>

      <section className="gallery-panel" aria-labelledby="gallery-title">
        <div className="gallery-heading">
          <h2 id="gallery-title">Gallery</h2>
          <span>{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
        </div>
        {!photos.length && <div className="empty-state">No photos yet.</div>}
        <div className="gallery-grid">
          {photos.map((photo) => (
            <figure className="photo-card" key={photo.path}>
              <button className="image-button" type="button" onClick={() => setSelectedPhoto(photo)}>
                <img src={photo.url} alt="Captured" loading="lazy" />
              </button>
              <figcaption>
                <span>
                  <span>{formatDate(photo.createdAt)}</span>
                  <small>{formatScale(photo)}</small>
                </span>
                <button className="delete-button" type="button" onClick={() => deletePhoto(photo)} disabled={deletingPhotoName === photo.name}>
                  {deletingPhotoName === photo.name ? "Deleting..." : "Delete"}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {selectedPhoto && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setSelectedPhoto(null)}>
          <div className="image-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topbar">
              <span>{formatDate(selectedPhoto.createdAt)}<small>{formatScale(selectedPhoto)}</small></span>
              <button className="modal-close" type="button" onClick={() => setSelectedPhoto(null)}>Close</button>
            </div>
            <img src={selectedPhoto.url} alt="Captured thermal" />
          </div>
        </div>
      )}
    </main>
  );
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function formatDate(value) {
  if (!value) return "Saved photo";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatScale(photo) {
  if (photo.temperature == null || photo.ambiance == null) return "No scale saved";
  return `High ${formatNumber(photo.temperature)} / Ambient ${formatNumber(photo.ambiance)}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return Number.isInteger(number) ? `${number}` : `${number.toFixed(1)}`;
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "Camera permission was blocked.";
  if (error?.name === "NotFoundError") return "No camera was found.";
  if (location.protocol !== "https:" && location.hostname !== "localhost") return "Camera access needs HTTPS or localhost.";
  return error?.message || "Could not open the camera.";
}

async function resolveThermalScale(temperatureValue, ambianceValue) {
  const manualScale = getManualThermalScale(temperatureValue, ambianceValue);
  if (manualScale?.error) throw new Error(manualScale.error);
  if (manualScale) return manualScale;
  try {
    return await fetchSensorScale();
  } catch (err) {
    throw new Error(`${err.message} Enter test values while the sensor API is empty.`);
  }
}

function getManualThermalScale(temperatureValue, ambianceValue) {
  const hasTemperature = `${temperatureValue}`.trim() !== "";
  const hasAmbiance = `${ambianceValue}`.trim() !== "";
  if (!hasTemperature && !hasAmbiance) return null;
  if (!hasTemperature || !hasAmbiance) return { error: "Enter both temperature and ambiance numbers." };
  return parseThermalScale(temperatureValue, ambianceValue);
}

async function fetchSensorScale() {
  const response = await fetch(`${API_BASE}/sensors/latest`, { cache: "no-store" });
  const reading = await readJson(response);
  const scale = parseThermalScale(reading.temperature, reading.ambiance ?? reading.ambient);
  if (scale.error) throw new Error(`Sensor reading is invalid. ${scale.error}`);
  return scale;
}

function parseThermalScale(temperatureValue, ambianceValue) {
  const temperature = Number(temperatureValue);
  const ambiance = Number(ambianceValue);
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) return { error: "Enter both temperature and ambiance numbers." };
  if (temperature <= ambiance) return { error: "Temperature must be higher than ambiance." };
  return { temperature, ambiance };
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M5 16v3h14v-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
