// Connectivity utility — local-first architecture.
//
// The kiosk ALWAYS talks to the local server (localhost:3000 by default).
// Photos are synced to the cloud in the background whenever internet is available.
// No mode switching — local server is always the source of truth.

const CLOUD_BASE = "/api";
const LOCAL_SERVER_KEY = "local_server_url";
const DEFAULT_LOCAL_URL = "http://localhost:3000";
const QUEUE_KEY = "offline_photo_queue";
const COMPARATIVE_QUEUE_KEY = "offline_comparative_session_queue";

export const ADMIN_SINGLE_LOGS_CACHE_KEY = "cached_admin_single_logs";
export const ADMIN_COMPARATIVE_SESSIONS_CACHE_KEY = "cached_admin_comparative_sessions";

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

export function readLocalCache(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalCache(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function upsertCachedRecord(key, record) {
  if (!record || !record.id) return readLocalCache(key, []);

  const current = readLocalCache(key, []);
  const next = current.filter((item) => item?.id !== record.id);
  next.unshift(record);
  writeLocalCache(key, next);
  return next;
}

export function mergeRecordsById(...collections) {
  const records = new Map();

  for (const collection of collections) {
    for (const record of collection || []) {
      if (!record?.id) continue;
      records.set(record.id, { ...(records.get(record.id) || {}), ...record });
    }
  }

  return Array.from(records.values());
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

// ─── Offline comparative session queue ───────────────────────────────────────
// Stores comparative session completions until the cloud endpoint is reachable.

function readComparativeQueue() {
  try {
    return JSON.parse(localStorage.getItem(COMPARATIVE_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function enqueueComparativeQueue(payload) {
  const queue = readComparativeQueue();
  const entry = {
    id: `queue-${crypto.randomUUID()}`,
    queuedAt: new Date().toISOString(),
    ...payload
  };
  queue.push(entry);
  localStorage.setItem(COMPARATIVE_QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

function dequeueComparativeQueue(id) {
  const queue = readComparativeQueue().filter((item) => item.id !== id);
  localStorage.setItem(COMPARATIVE_QUEUE_KEY, JSON.stringify(queue));
}

export async function syncComparativeSessionToCloud(payload) {
  try {
    const { sessionId, ...body } = payload || {};
    if (!sessionId) throw new Error("Session ID is required.");

    const res = await fetch(`${CLOUD_BASE}/scan-sessions/${sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (res.ok) return;
  } catch {
    // Cloud unreachable — fall through to queue
  }

  try { enqueueComparativeQueue(payload); } catch {}
}

export async function drainComparativeSessionQueue(onProgress) {
  const queue = readComparativeQueue();
  if (queue.length === 0) return;

  for (const item of queue) {
    try {
      const { id, queuedAt, ...payload } = item;
      const { sessionId, ...body } = payload;
      if (!sessionId) {
        dequeueComparativeQueue(item.id);
        continue;
      }

      const res = await fetch(`${CLOUD_BASE}/scan-sessions/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        dequeueComparativeQueue(item.id);
        onProgress?.({ remaining: readComparativeQueue().length });
      }
    } catch {
      break; // Network still down — retry on next online event
    }
  }
}
