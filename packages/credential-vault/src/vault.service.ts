/**
 * vault.service.ts — Core vault service implementation.
 *
 * Implements the VaultService gRPC interface.
 * Coordinates between the keychain adapter, ref store, injector, and scanner.
 */
import { CredentialError } from "@tessera/shared";
import { createKeychainAdapter } from "./keychain.adapter.js";
import { RefStore } from "./ref-store.js";
import { injectAllCredentials } from "./injector.js";
import { scanDirectory } from "./scanner.js";

export interface SetSecretParams {
  service: string;
  account: string;
  value: string;
}

export interface SetSecretResult {
  ref_id: string;
  success: boolean;
  error_message: string;
}

export interface GetSecretRefResult {
  ref_id: string;
  exists: boolean;
}

export interface DeleteSecretResult {
  success: boolean;
}

export interface SecretRef {
  ref_id: string;
  service: string;
  account: string;
  created_at: string;
}

export interface ListRefsResult {
  refs: SecretRef[];
}

export interface InjectCredentialParams {
  ref_id: string;
  tool_input_json: string;
  placeholder_key: string;
}

export interface InjectCredentialResult {
  mutated_input_json: string;
  success: boolean;
  error_message: string;
}

export interface ScanResult {
  warnings: string[];
  errors: string[];
}

export class VaultService {
  private refStore: RefStore;

  constructor(dataDir: string) {
    this.refStore = new RefStore(dataDir);
  }

  async setSecret(params: SetSecretParams): Promise<SetSecretResult> {
    try {
      const keychain = createKeychainAdapter(params.service);
      await keychain.set(params.account, params.value);
      const ref_id = this.refStore.upsertRef(params.service, params.account);
      return { ref_id, success: true, error_message: "" };
    } catch (err) {
      return {
        ref_id: "",
        success: false,
        error_message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getSecretRef(service: string, account: string): GetSecretRefResult {
    const ref = this.refStore.findRef(service, account);
    return { ref_id: ref?.ref_id ?? "", exists: ref !== null };
  }

  async deleteSecret(service: string, account: string): Promise<DeleteSecretResult> {
    try {
      const keychain = createKeychainAdapter(service);
      await keychain.delete(account);
      this.refStore.deleteRef(service, account);
      return { success: true };
    } catch (err) {
      if (err instanceof Error) {
        throw new CredentialError(`Failed to delete secret: ${err.message}`);
      }
      throw err;
    }
  }

  listSecretRefs(): ListRefsResult {
    return { refs: this.refStore.listRefs() };
  }

  async injectCredential(params: InjectCredentialParams): Promise<InjectCredentialResult> {
    try {
      const ref = this.refStore.getRef(params.ref_id);
      if (!ref) {
        return {
          mutated_input_json: "",
          success: false,
          error_message: `Unknown credential reference: ${params.ref_id}`,
        };
      }

      const keychain = createKeychainAdapter(ref.service);
      const mutated = await injectAllCredentials(params.tool_input_json, keychain, this.refStore);

      return { mutated_input_json: mutated, success: true, error_message: "" };
    } catch (err) {
      return {
        mutated_input_json: "",
        success: false,
        error_message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  scanForPlaintextSecrets(path: string): ScanResult {
    return scanDirectory(path);
  }

  close(): void {
    this.refStore.close();
  }
}
