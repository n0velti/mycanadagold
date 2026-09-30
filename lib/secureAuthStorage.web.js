/**
 * Web build of the secure storage module. Sessions and device secrets live in
 * `localStorage`, scoped to the app origin and protected by the CSP in
 * public/index.html (see README). Keeping this file free of the native
 * imports (expo-secure-store, aes-js, expo-crypto) keeps them out of the web
 * bundle entirely; Metro picks `.web.js` ahead of `.js` for the web platform.
 */

function webStorage() {
  if (typeof globalThis.localStorage !== 'undefined') {
    return globalThis.localStorage;
  }

  const memory = new Map();
  return {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      memory.set(key, String(value));
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
}

class WebAuthStorage {
  constructor() {
    this.storage = webStorage();
  }

  async getItem(key) {
    return this.storage.getItem(key);
  }

  async setItem(key, value) {
    this.storage.setItem(key, value);
  }

  async removeItem(key) {
    this.storage.removeItem(key);
  }
}

export function createSecureAuthStorage() {
  return new WebAuthStorage();
}

let shared = null;

/** Process-wide instance for app secrets (vendor tokens). */
export function getSecureStorage() {
  if (!shared) shared = createSecureAuthStorage();
  return shared;
}

export async function readSecureJson(key, fallback = null) {
  try {
    const raw = await getSecureStorage().getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeSecureJson(key, value) {
  await getSecureStorage().setItem(key, JSON.stringify(value));
}

export async function removeSecure(key) {
  try {
    await getSecureStorage().removeItem(key);
  } catch {
    // Nothing to remove.
  }
}
