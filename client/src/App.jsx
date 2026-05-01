import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAnnotatedJpegFromSource,
  createRawJpegFromFile,
  createRawJpegFromVideo
} from "./thermalOverlay";

const API_BASE = "/api";

export default function App() {
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

  const stopCamera = useCallback(() => {
    if (!streamRef.current) return;
    for (const track of streamRef.current.getTracks()) {
      track.stop();
    }
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
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
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
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setSelectedPhoto(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  async function capturePhoto() {
    if (!isCameraReady || !videoRef.current?.videoWidth) {
      setError("Camera is not ready yet.");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("Reading sensor values...");

    try {
      const scale = await resolveThermalScale(temperatureInput, ambianceInput);
      setStatus("Analyzing thermal image...");
      const rawImage = createRawJpegFromVideo(videoRef.current);
      await saveAutoAnnotatedPhoto(rawImage, scale);
    } catch (err) {
      setError(err.message);
      setStatus("Could not save photo.");
    } finally {
      setSaving(false);
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

  async function saveAutoAnnotatedPhoto(rawImage, scale) {
    const imageData = await createAnnotatedJpegFromSource(rawImage.src, scale);

    setStatus("Saving photo...");
    const response = await fetch(`${API_BASE}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageData,
        temperature: scale.temperature,
        ambiance: scale.ambiance
      })
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
      const response = await fetch(`${API_BASE}/photos/${encodeURIComponent(photo.name)}`, {
        method: "DELETE"
      });
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

  const isBlocked = isSaving;

  return (
    <main className="app-shell">
      <section className="camera-panel" aria-label="Camera">
        <div className="top-bar">
          <h1>Camera</h1>
          <button className="secondary-button" type="button" onClick={startCamera}>
            Start Camera
          </button>
        </div>

        <div className={`camera-frame ${isCameraReady ? "is-live" : ""}`}>
          <video ref={videoRef} autoPlay muted playsInline />
          <div className="camera-placeholder">
            {isCameraReady ? "" : "Starting camera..."}
          </div>
        </div>

        <div className="thermal-inputs">
          <label>
            <span>Temperature</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={temperatureInput}
              onChange={(event) => setTemperatureInput(event.target.value)}
              placeholder="Sensor high"
              required
            />
          </label>
          <label>
            <span>Ambiance</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={ambianceInput}
              onChange={(event) => setAmbianceInput(event.target.value)}
              placeholder="Sensor ambient"
              required
            />
          </label>
        </div>

        <div className="controls">
          <div className="capture-actions">
            <button
              className={`capture-button ${isSaving ? "is-saving" : ""}`}
              type="button"
              onClick={capturePhoto}
              disabled={!isCameraReady || isBlocked}
            >
              {isSaving ? "Saving..." : "Take Photo"}
            </button>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept="image/*"
              onChange={uploadPhoto}
            />
            <button
              className="icon-button"
              type="button"
              aria-label="Upload photo"
              title="Upload photo"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBlocked}
            >
              <UploadIcon />
            </button>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={loadGallery}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh Gallery"}
          </button>
        </div>

        <p className={`status ${error ? "is-error" : ""}`} aria-live="polite">
          {error || status}
        </p>
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
              <button
                className="image-button"
                type="button"
                onClick={() => setSelectedPhoto(photo)}
              >
                <img src={photo.url} alt="Captured" loading="lazy" />
              </button>
              <figcaption>
                <span>
                  <span>{formatDate(photo.createdAt)}</span>
                  <small>{formatScale(photo)}</small>
                </span>
                <button
                  className="delete-button"
                  type="button"
                  onClick={() => deletePhoto(photo)}
                  disabled={deletingPhotoName === photo.name}
                >
                  {deletingPhotoName === photo.name ? "Deleting..." : "Delete"}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {selectedPhoto && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="image-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-topbar">
              <span>
                {formatDate(selectedPhoto.createdAt)}
                <small>{formatScale(selectedPhoto)}</small>
              </span>
              <button
                className="modal-close"
                type="button"
                aria-label="Close preview"
                onClick={() => setSelectedPhoto(null)}
              >
                Close
              </button>
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
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function formatDate(value) {
  if (!value) return "Saved photo";
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatScale(photo) {
  if (photo.temperature == null || photo.ambiance == null) {
    return "No scale saved";
  }

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
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    return "Camera access needs HTTPS or localhost.";
  }
  return error?.message || "Could not open the camera.";
}

async function resolveThermalScale(temperatureValue, ambianceValue) {
  const manualScale = getManualThermalScale(temperatureValue, ambianceValue);
  if (manualScale?.error) {
    throw new Error(manualScale.error);
  }

  if (manualScale) {
    return manualScale;
  }

  try {
    return await fetchSensorScale();
  } catch (err) {
    throw new Error(`${err.message} Enter test values while the sensor API is empty.`);
  }
}

function getManualThermalScale(temperatureValue, ambianceValue) {
  const hasTemperature = `${temperatureValue}`.trim() !== "";
  const hasAmbiance = `${ambianceValue}`.trim() !== "";

  if (!hasTemperature && !hasAmbiance) {
    return null;
  }

  if (!hasTemperature || !hasAmbiance) {
    return { error: "Enter both temperature and ambiance numbers." };
  }

  return parseThermalScale(temperatureValue, ambianceValue);
}

async function fetchSensorScale() {
  const response = await fetch(`${API_BASE}/sensors/latest`, {
    cache: "no-store"
  });
  const reading = await readJson(response);
  const scale = parseThermalScale(reading.temperature, reading.ambiance ?? reading.ambient);
  if (scale.error) {
    throw new Error(`Sensor reading is invalid. ${scale.error}`);
  }
  return scale;
}

function parseThermalScale(temperatureValue, ambianceValue) {
  const temperature = Number(temperatureValue);
  const ambiance = Number(ambianceValue);

  if (!Number.isFinite(temperature) || !Number.isFinite(ambiance)) {
    return { error: "Enter both temperature and ambiance numbers." };
  }

  if (temperature <= ambiance) {
    return { error: "Temperature must be higher than ambiance." };
  }

  return { temperature, ambiance };
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path
        d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M5 16v3h14v-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
