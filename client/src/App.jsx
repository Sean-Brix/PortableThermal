import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart2, Camera, CheckCircle2, X, Zap } from "lucide-react";
import {
  createAnnotatedJpegFromSource,
  createRawJpegFromFile,
  createRawJpegFromVideo
} from "./thermalOverlay";
import Kiosk from "./Kiosk";
import Admin from "./Admin";
import { drainComparativeSessionQueue, drainPhotoQueue, getApiBase, syncPhotoToCloud } from "./api.js";

const SHOOT_POLL_INTERVAL_MS = 2500;
const ANALYSIS_TODO = [
  "EC 60364-6:2016",
  "Tighten / Secure Connections",
  "Inspect / Clean for Corrosion or Oxidation",
  "Check for Signs of Arcing or Tracking",
  "Verify Load / Current Balance",
  "Ensure Proper Ventilation / Clean Dust or Debris"
];

export default function AppRouter() {
  const [isAdminAuth, setIsAdminAuth] = useState(() => !!localStorage.getItem("admin_token"));

  const [currentPage, setCurrentPage] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("/test") && !!localStorage.getItem("admin_token")) return "test";
    if (path.includes("/admin")) return "admin";
    return "kiosk";
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
    if (path.includes("/test") && isAdminAuth) setCurrentPage("test");
      else if (path.includes("/admin")) setCurrentPage("admin");
      else setCurrentPage("kiosk");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isAdminAuth]);

  const navigateTo = (page) => {
    if (page === "test" && !isAdminAuth) page = "admin";
    setCurrentPage(page);
    const paths = { test: "/test", kiosk: "/kiosk", admin: "/admin" };
    window.history.pushState({}, "", paths[page] ?? "/kiosk");
  };

  const handleAuthChange = (authenticated) => {
    setIsAdminAuth(authenticated);
    if (!authenticated && currentPage === "test") {
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
  if (currentPage === "test" && isAdminAuth) {
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
          <Camera size={15} /> Test
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
  const [selectedPhotoNames, setSelectedPhotoNames] = useState([]);
  const [analysisPhotos, setAnalysisPhotos] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(6);
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
      const response = await fetch(`${getApiBase()}/photos`);
      const data = await readJson(response);
      setPhotos(data.photos);
      setSelectedPhotoNames((current) => current.filter((name) => data.photos.some((photo) => photo.name === name)));
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
    const flushQueues = async () => {
      await drainPhotoQueue();
      await drainComparativeSessionQueue();
    };

    flushQueues();
    const handleOnline = () => flushQueues();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

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
        const response = await fetch(`${getApiBase()}/camera/shoot`, { cache: "no-store" });
        if (response.status === 204) return;
        const request = await readJson(response);
        if (!request?.id || request.id === activeShootRequestRef.current || request.id === completedShootRequestRef.current) return;
        activeShootRequestRef.current = request.id;
        try {
          await captureAndSavePhoto({ temperature: request.temp, ambiance: request.ambient });
          await fetch(`${getApiBase()}/camera/shoot/complete`, {
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
    const payload = { imageData, temperature: scale.temperature, ambiance: scale.ambiance };
    const response = await fetch(`${getApiBase()}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const photo = await readJson(response);
    syncPhotoToCloud(payload); // background cloud sync
    setPhotos((current) => [photo, ...current]);
    setStatus("Photo saved with automatic thermal markers.");
  }

  async function deletePhoto(photo) {
    if (!window.confirm("Delete this photo?")) return;
    setDeletingPhotoName(photo.name);
    setError("");
    setStatus("Deleting photo...");
    try {
      const response = await fetch(`${getApiBase()}/photos/${encodeURIComponent(photo.name)}`, { method: "DELETE" });
      await readJson(response);
      setPhotos((current) => current.filter((item) => item.name !== photo.name));
      setSelectedPhotoNames((current) => current.filter((name) => name !== photo.name));
      setStatus("Photo deleted.");
    } catch (err) {
      setError(err.message);
      setStatus("Could not delete photo.");
    } finally {
      setDeletingPhotoName("");
    }
  }

  const clearAllPhotos = async () => {
    if (!window.confirm(`Delete all ${photos.length} photos? This cannot be undone.`)) return;
    setError("");
    setStatus("Clearing all photos...");
    try {
      for (const photo of photos) {
        await fetch(`${getApiBase()}/photos/${encodeURIComponent(photo.name)}`, { method: "DELETE" });
      }
      setPhotos([]);
      setSelectedPhotoNames([]);
      setAnalysisPhotos(null);
      setCurrentPage(1);
      setStatus("All photos cleared.");
    } catch (err) {
      setError(err.message);
      setStatus("Could not clear photos.");
    }
  };

  const totalPages = Math.ceil(photos.length / itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage;
  const paginatedPhotos = photos.slice(startIdx, startIdx + itemsPerPage);
  const selectedPhotos = photos.filter((photo) => selectedPhotoNames.includes(photo.name));

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
    if (totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const togglePhotoSelection = useCallback((photo) => {
    setSelectedPhotoNames((current) => (
      current.includes(photo.name)
        ? current.filter((name) => name !== photo.name)
        : [...current, photo.name]
    ));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPhotoNames([]);
  }, []);

  const openSelectedAnalysis = useCallback(() => {
    if (selectedPhotos.length < 2) {
      setError("Select at least two images to analyze.");
      return;
    }
    setError("");
    setStatus(`Analyzing ${selectedPhotos.length} selected photos...`);
    setAnalysisPhotos(selectedPhotos);
  }, [selectedPhotos]);

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
            <div className="gallery-controls">
              <span>{photos.length} {photos.length === 1 ? "photo" : "photos"}</span>
              {selectedPhotos.length > 0 && (
                <span className="gallery-selection-count">{selectedPhotos.length} selected</span>
              )}
              <button className="analyze-selected-btn" onClick={openSelectedAnalysis} type="button" disabled={selectedPhotos.length < 2}>
                <BarChart2 size={16} />
                Analyze Selected
              </button>
              {selectedPhotos.length > 0 && (
                <button className="clear-selection-btn" onClick={clearSelection} type="button">
                  Clear Selection
                </button>
              )}
              {photos.length > 0 && (
                <button className="clear-all-btn" onClick={clearAllPhotos} type="button">
                  Clear All
                </button>
              )}
            </div>
        </div>
        {!photos.length && <div className="empty-state">No photos yet.</div>}
          <div className="gallery-grid-wrapper">
            <div className="gallery-grid">
              {paginatedPhotos.map((photo) => {
                const isSelected = selectedPhotoNames.includes(photo.name);
                return (
                  <figure className={`photo-card ${isSelected ? "selected" : ""}`} key={photo.path}>
                    <button
                      className={`photo-select-toggle ${isSelected ? "selected" : ""}`}
                      type="button"
                      onClick={() => togglePhotoSelection(photo)}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Deselect" : "Select"} photo`}
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
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
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <button 
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  ← Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button 
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
      </section>

      {selectedPhoto && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setSelectedPhoto(null)}>
          <div className="image-modal large-modal photo-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topbar">
              <span>{formatDate(selectedPhoto.createdAt)}<small>{formatScale(selectedPhoto)}</small></span>
              <button className="modal-close" type="button" onClick={() => setSelectedPhoto(null)}>Close</button>
            </div>
            <div className="large-image-container">
              <img src={selectedPhoto.url} alt="Captured thermal" />
            </div>
          </div>
        </div>
      )}

      {analysisPhotos && analysisPhotos.length >= 2 && (
        <PhotoAnalysisModal photos={analysisPhotos} onClose={() => setAnalysisPhotos(null)} />
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
  const response = await fetch(`${getApiBase()}/sensors/latest`, { cache: "no-store" });
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

function classifyReading(temp, ambient) {
  const temperature = Number(temp);
  const ambiance = Number(ambient);
  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) return "Unknown";
  const diff = temperature - ambiance;
  const ratio = diff / ambiance;
  if (ratio > 0.5 || diff > 50) return "Critical";
  if (ratio > 0.25 || diff > 25) return "Warning";
  return "Normal";
}

function Checklist({ items = [], storageKeyPrefix = "checklist", idKey = "default" }) {
  const key = `${storageKeyPrefix}:${idKey}`;
  const [checked, setChecked] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(checked));
    } catch {
      // Ignore storage errors in test mode.
    }
  }, [key, checked]);

  const toggle = (index) => {
    setChecked((current) => ({ ...current, [index]: !current[index] }));
  };

  return (
    <div className="todo-checklist">
      <ul>
        {items.map((item, index) => (
          <li key={index} className={`todo-item ${checked[index] ? "done" : ""}`}>
            <label>
              <input type="checkbox" checked={!!checked[index]} onChange={() => toggle(index)} />
              <span className="todo-label">{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhotoAnalysisModal({ photos, onClose }) {
  const temps = photos.map((photo) => Number(photo.temperature));
  const ambients = photos.map((photo) => Number(photo.ambiance));
  const diffs = photos.map((photo) => Number(photo.temperature) - Number(photo.ambiance));
  const avgTemp = (temps.reduce((sum, value) => sum + value, 0) / temps.length).toFixed(1);
  const maxTemp = Math.max(...temps).toFixed(1);
  const minTemp = Math.min(...temps).toFixed(1);
  const avgAmbient = (ambients.reduce((sum, value) => sum + value, 0) / ambients.length).toFixed(1);
  const avgDiffValue = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  const avgDiff = avgDiffValue.toFixed(1);
  const variance = diffs.reduce((sum, value) => sum + Math.pow(value - avgDiffValue, 2), 0) / diffs.length;
  const stdDev = Math.sqrt(variance).toFixed(1);

  const critical = photos.filter((photo) => classifyReading(photo.temperature, photo.ambiance) === "Critical").length;
  const warning = photos.filter((photo) => classifyReading(photo.temperature, photo.ambiance) === "Warning").length;
  const normal = photos.filter((photo) => classifyReading(photo.temperature, photo.ambiance) === "Normal").length;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="comp-analysis-modal test-analysis-modal" onClick={(event) => event.stopPropagation()}>
        <div className="comp-modal-header">
          <h2>Selected Image Analysis</h2>
          <button className="analyze-close-btn" onClick={onClose} type="button" aria-label="Close analysis modal">
            <X size={18} />
          </button>
        </div>

        <div className="comp-modal-body">
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

          <div className="comp-classification-row">
            <span className="cls-chip critical"><Zap size={12} /> {critical} Critical</span>
            <span className="cls-chip warning"><AlertTriangle size={12} /> {warning} Warning</span>
            <span className="cls-chip normal"><CheckCircle2 size={12} /> {normal} Normal</span>
          </div>

          <div className="comp-table-section">
            <h3>Scan Details</h3>
            <table className="comp-details-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Temp (°C)</th>
                  <th>Ambient (°C)</th>
                  <th>Δ (°C)</th>
                  <th>Class</th>
                  <th>Captured</th>
                </tr>
              </thead>
              <tbody>
                {photos.map((photo, index) => {
                  const classification = classifyReading(photo.temperature, photo.ambiance);
                  const diff = Number(photo.temperature) - Number(photo.ambiance);
                  return (
                    <tr key={photo.name ?? index}>
                      <td>#{index + 1}</td>
                      <td>{formatNumber(photo.temperature)}</td>
                      <td>{formatNumber(photo.ambiance)}</td>
                      <td>{diff.toFixed(1)}</td>
                      <td><span className={`scan-badge ${classification.toLowerCase()}`}>{classification}</span></td>
                      <td>{formatDate(photo.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="comp-images-section">
            <h3>Captured Images ({photos.length})</h3>
            <div className="comp-image-grid">
              {photos.map((photo, index) => {
                const classification = classifyReading(photo.temperature, photo.ambiance);
                return (
                  <div className="comp-image-item" key={photo.name ?? index}>
                    <img src={photo.url} alt={`Selected scan ${index + 1}`} />
                    <span className="comp-image-num">#{index + 1}</span>
                    <div className="comp-image-footer">
                      <span className={`scan-badge ${classification.toLowerCase()}`}>{classification}</span>
                      <span className="comp-image-temp">{formatNumber(photo.temperature)}°C</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="comp-recs-section">
            <h3>Recommendations</h3>
            <p>The following checklist is based on EC 60364-6:2016 and can be marked as items are inspected.</p>
            <Checklist items={ANALYSIS_TODO.slice(1)} storageKeyPrefix="test-analysis" idKey={photos.map((photo) => photo.name).join("|")} />
            <p className="analysis-summary">
              Average temperature delta: {avgDiff}°C. Standard deviation: {stdDev}°C.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M5 16v3h14v-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
