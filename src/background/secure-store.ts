// At-rest encryption for the Jira credential.
//
// The auth header is encrypted with AES-256-GCM before it touches
// chrome.storage.local. The AES key is generated non-extractable and
// lives in IndexedDB — structured clone preserves the CryptoKey while
// keeping its raw material inaccessible to script, so neither store
// holds a plaintext secret on its own. This is the strongest at-rest
// protection available to an extension without prompting the user for
// a passphrase; code running inside the extension's own context can
// still use the key, which no in-browser scheme can prevent.

export interface EncryptedValue {
  iv: string;
  data: string;
}

const DB_NAME = 'nitpick-secure';
const STORE = 'keys';
const KEY_ID = 'aes-gcm';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cachedKey: CryptoKey | null = null;

async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const db = await openDb();
  let key = await idbGet<CryptoKey>(db, KEY_ID);
  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable: the raw key can never be read by script
      ['encrypt', 'decrypt'],
    );
    await idbPut(db, KEY_ID, key);
  }
  cachedKey = key;
  return key;
}

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value: string) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function encryptString(plain: string): Promise<EncryptedValue> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return { iv: toBase64(iv.buffer), data: toBase64(data) };
}

export async function decryptString(value: EncryptedValue): Promise<string> {
  const key = await getOrCreateKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(value.iv) },
    key,
    fromBase64(value.data),
  );
  return new TextDecoder().decode(plain);
}
