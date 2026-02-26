/**
 * keychain.adapter.ts — Dual-backend credential storage.
 *
 * Backend selection (probed once at module load):
 *   1. keytar  — OS-backed secure storage (preferred)
 *        Windows : Windows Credential Manager (DPAPI, optionally TPM-backed)
 *        macOS   : macOS Keychain (Secure Enclave)
 *        Linux   : libsecret / GNOME Keyring (requires daemon + libsecret-1)
 *   2. Encrypted file — AES-256-GCM fallback for headless Linux / WSL / CI
 *        File: ${VAULT_DATA_DIR}/keys.enc.json  (mode 0600)
 *        Key : SHA-256(VAULT_MASTER_KEY env var)
 *        IV  : 12 random bytes per entry (stored alongside ciphertext)
 *        Tag : 16-byte GCM auth tag      (stored alongside ciphertext)
 *
 * Only MODULE_NOT_FOUND / runtime binding errors at import time cause the
 * fallback.  Runtime errors from keytar operations are rethrown so the caller
 * knows the OS keychain is broken.
 *
 * SECURITY NOTE: In production set VAULT_MASTER_KEY to a 256-bit random value
 * (env var from a secrets manager) and protect VAULT_DATA_DIR with filesystem
 * ACLs.  The raw secret value is never logged or returned to callers except
 * inside InjectCredential, where it is substituted directly into the tool
 * input JSON without being stored anywhere else.
 */
import { createRequire } from "node:module";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export const KEYCHAIN_SERVICE_PREFIX = "SecureClaw";

export interface KeychainAdapter {
  /** Store a secret */
  set(account: string, value: string): Promise<void>;
  /** Retrieve a secret (used only by the injector, never returned to callers) */
  get(account: string): Promise<string | null>;
  /** Delete a secret */
  delete(account: string): Promise<boolean>;
  /** List all accounts under this service (no values) */
  findAll(): Promise<Array<{ account: string }>>;
}

// ── keytar probe ──────────────────────────────────────────────────────────

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

const _require = createRequire(import.meta.url);
let _keytar: KeytarModule | null = null;

try {
  _keytar = _require("keytar") as KeytarModule;
  process.stdout.write("[vault] Backend: OS keychain (keytar)\n");
} catch {
  process.stdout.write(
    "[vault] Backend: encrypted file (keytar unavailable — headless/WSL/CI)\n"
  );
}

// ── AES-256-GCM encrypted file (fallback) ────────────────────────────────

const ALGO = "aes-256-gcm";

function deriveKey(): Buffer {
  const masterKey =
    process.env["VAULT_MASTER_KEY"] ??
    "dev-insecure-vault-key-change-in-prod";
  return createHash("sha256").update(masterKey, "utf8").digest();
}

function encryptValue(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

function decryptValue(stored: string, key: Buffer): string | null {
  try {
    const parts = stored.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, ctHex] = parts as [string, string, string];
    const decipher = createDecipheriv(
      ALGO,
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return (
      decipher.update(Buffer.from(ctHex, "hex")).toString("utf8") +
      decipher.final("utf8")
    );
  } catch {
    return null;
  }
}

type EncryptedStore = Record<string, string>;

function keysFilePath(): string {
  const dataDir = process.env["VAULT_DATA_DIR"] ?? "/tmp/secureclaw-vault";
  return join(dataDir, "keys.enc.json");
}

function loadStore(filePath: string): EncryptedStore {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as EncryptedStore;
  } catch {
    return {};
  }
}

function saveStore(filePath: string, store: EncryptedStore): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

// ── Public factory ────────────────────────────────────────────────────────

/**
 * Creates a keychain adapter scoped to a specific service namespace.
 *
 * When keytar is available the OS secure store is used for each operation.
 * All keys are stored under the compound service name
 * `SecureClaw:<serviceName>` so they're grouped in the OS credential manager.
 *
 * When keytar is unavailable the encrypted file backend is used instead;
 * keys are stored as `SecureClaw:<serviceName>:<account>` in the JSON file.
 */
export function createKeychainAdapter(serviceName: string): KeychainAdapter {
  const service = `${KEYCHAIN_SERVICE_PREFIX}:${serviceName}`;

  if (_keytar !== null) {
    // ── keytar path ──────────────────────────────────────────────────────
    const kt = _keytar; // capture for closure — never null in this branch
    return {
      async set(account: string, value: string): Promise<void> {
        await kt.setPassword(service, account, value);
      },

      async get(account: string): Promise<string | null> {
        return kt.getPassword(service, account);
      },

      async delete(account: string): Promise<boolean> {
        return kt.deletePassword(service, account);
      },

      async findAll(): Promise<Array<{ account: string }>> {
        const creds = await kt.findCredentials(service);
        return creds.map((c) => ({ account: c.account }));
      },
    };
  }

  // ── encrypted file path ──────────────────────────────────────────────
  const key = deriveKey();
  const storeKey = (account: string): string => `${service}:${account}`;

  return {
    async set(account: string, value: string): Promise<void> {
      const filePath = keysFilePath();
      const store = loadStore(filePath);
      store[storeKey(account)] = encryptValue(value, key);
      saveStore(filePath, store);
    },

    async get(account: string): Promise<string | null> {
      const store = loadStore(keysFilePath());
      const encrypted = store[storeKey(account)];
      if (!encrypted) return null;
      return decryptValue(encrypted, key);
    },

    async delete(account: string): Promise<boolean> {
      const filePath = keysFilePath();
      const store = loadStore(filePath);
      const k = storeKey(account);
      if (!(k in store)) return false;
      delete store[k];
      saveStore(filePath, store);
      return true;
    },

    async findAll(): Promise<Array<{ account: string }>> {
      const store = loadStore(keysFilePath());
      const prefix = `${service}:`;
      return Object.keys(store)
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ account: k.slice(prefix.length) }));
    },
  };
}
