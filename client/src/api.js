// Connectivity utility — local-first architecture.
//
// The kiosk ALWAYS talks to the local server (localhost:3000 by default).
// Photos are synced to the cloud in the background whenever internet is available.
// No mode switching — local server is always the source of truth.

const CLOUD_BASE = "/api";
const LOCAL_SERVER_KEY = "local_server_url";
const DEFAULT_LOCAL_URL = "http://localhost:3000";
const QUEUE_KEY = "offline_photo_queue";

// ─── Local server base ────────────────────────────────────────────────────────

export function getLocalServerUrl() {
  return localStorage.getItem(LOCAL_SERVER_KEY) || "";
}

// Always returns the local server API base. Used by all kiosk API calls.
// Sanitizes 0.0.0.0 → localhost (0.0.0.0 is a server bind address, not a valid browser URL).
export function getApiBase() {
  const url = (getLocalServerUrl() || DEFAULT_LOCAL_URL).replace("0.0.0.0", "localhost");
  return url.replace(/\/api\/?$/, "").replace(/\/$/, "") + "/api";
}

// ─── Cloud photo sync ─────────────────────────────────────────────────────────
// Tries to save a photo to cloud. Queues it if cloud is unreachable.
// Call this fire-and-forget after saving to the local server.

export async function syncPhotoToCloud(payload) {
  try {
    const res = await fetch(`${CLOUD_BASE}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) return;
  } catch {
    // Cloud unreachable — fall through to queue
  }
  try { enqueue(payload); } catch {}
}

// ─── Offline photo queue ──────────────────────────────────────────────────────
// Stores photos that couldn't reach the cloud. Drained on reconnect.

export function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function enqueue(payload) {
  const queue = readQueue();
  const entry = {
    id: `queue-${crypto.randomUUID()}`,
    queuedAt: new Date().toISOString(),
    ...payload
  };
  queue.push(entry);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

export function dequeue(id) {
  const queue = readQueue().filter((item) => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function drainPhotoQueue(onProgress) {
  const queue = readQueue();
  if (queue.length === 0) return;

  for (const item of queue) {
    try {
      const { id, queuedAt, ...payload } = item;
      const res = await fetch(`${CLOUD_BASE}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        dequeue(item.id);
        onProgress?.({ remaining: readQueue().length });
      }
    } catch {
      break; // Network still down — retry on next online event
    }
  }
}
