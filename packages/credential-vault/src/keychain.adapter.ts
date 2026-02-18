/**
 * keychain.adapter.ts — OS-native keychain abstraction via keytar.
 *
 * On Linux: uses libsecret (GNOME Keyring / KWallet)
 * On macOS: uses macOS Security framework (Keychain)
 * On Windows: uses Windows Credential Manager (DPAPI)
 *
 * SECURITY: Raw secret values NEVER leave this module except for InjectCredential.
 */
import keytar from "keytar";

export const KEYCHAIN_SERVICE_PREFIX = "SecureClaw";

export interface KeychainAdapter {
  /** Store a secret in the OS keychain */
  set(account: string, value: string): Promise<void>;
  /** Retrieve a secret (used only by the injector, never returned to callers) */
  get(account: string): Promise<string | null>;
  /** Delete a secret from the OS keychain */
  delete(account: string): Promise<boolean>;
  /** List all accounts under this service (no values) */
  findAll(): Promise<Array<{ account: string }>>;
}

/**
 * Creates a keychain adapter scoped to a specific service namespace.
 * All keys are stored under `SecureClaw:<serviceName>`.
 */
export function createKeychainAdapter(serviceName: string): KeychainAdapter {
  const service = `${KEYCHAIN_SERVICE_PREFIX}:${serviceName}`;

  return {
    async set(account: string, value: string): Promise<void> {
      await keytar.setPassword(service, account, value);
    },

    async get(account: string): Promise<string | null> {
      return keytar.getPassword(service, account);
    },

    async delete(account: string): Promise<boolean> {
      return keytar.deletePassword(service, account);
    },

    async findAll(): Promise<Array<{ account: string }>> {
      const creds = await keytar.findCredentials(service);
      // keytar returns { account, password } — we drop password, only expose account
      return creds.map(({ account }) => ({ account }));
    },
  };
}
