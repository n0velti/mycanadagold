import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import aesjs from 'aes-js';

const NATIVE_SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

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

/**
 * Encrypts session payloads before they hit AsyncStorage.
 * The AES key lives in the OS keychain / Android Keystore so a device
 * backup or filesystem dump cannot read the JWT.
 */
class NativeSecureAuthStorage {
  async _encrypt(key, value) {
    const encryptionKey = Crypto.getRandomBytes(32);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(
      key,
      aesjs.utils.hex.fromBytes(encryptionKey),
      NATIVE_SECURE_STORE_OPTIONS,
    );
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  async _decrypt(key, value) {
    const encryptionKeyHex = await SecureStore.getItemAsync(key, NATIVE_SECURE_STORE_OPTIONS);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this._decrypt(key, encrypted);
  }

  async setItem(key, value) {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key) {
    await AsyncStorage.removeItem(key);
    try {
      await SecureStore.deleteItemAsync(key, NATIVE_SECURE_STORE_OPTIONS);
    } catch {
      // Key may not exist yet.
    }
  }
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
  if (Platform.OS === 'web') {
    return new WebAuthStorage();
  }
  return new NativeSecureAuthStorage();
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
