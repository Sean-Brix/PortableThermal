// Connectivity utility — switches API base between Firebase cloud and local RasPi server.
// Photo queue — stores offline captures in localStorage and syncs to cloud on reconnect.

const CLOUD_BASE = "/api";
const LOCAL_SERVER_KEY = "local_server_url";
const HEALTH_TIMEOUT_MS = 3000;
const QUEUE_KEY = "offline_photo_queue";

// Module-level variable updated by resolveApiBase(). Read with getApiBase().
let apiBase = CLOUD_BASE;

// ─── API base resolution ──────────────────────────────────────────────────────

export function getApiBase() {
  return apiBase;
}

export function getLocalServerUrl() {
  return localStorage.getItem(LOCAL_SERVER_KEY) || "";
}

export async function resolveApiBase() {
  const isCloudUp = await checkCloudHealth();
  if (isCloudUp) {
    apiBase = CLOUD_BASE;
  } else {
    const localUrl = getLocalServerUrl();
    if (localUrl) {
      // Strip any trailing /api the user may have included, then append /api
      apiBase = localUrl.replace(/\/api\/?$/, "").replace(/\/$/, "") + "/api";
    } else {
      apiBase = CLOUD_BASE; // no local server configured — best effort
    }
  }
  return apiBase;
}

async function checkCloudHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${CLOUD_BASE}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Offline photo queue ──────────────────────────────────────────────────────
// Photos are stored as base64 data URLs in localStorage while offline.
// drainPhotoQueue() syncs them to the cloud (always /api, not local server).

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
  // May throw QuotaExceededError — caller should catch and surface it
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

export function dequeue(id) {
  const queue = readQueue().filter((item) => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// Drains the offline queue to the cloud. Always uses CLOUD_BASE (/api), not
// the local server, since the queue is meant to sync to Firebase on reconnect.
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
      // Network still down — stop draining, try again on next online event
      break;
    }
  }
}
