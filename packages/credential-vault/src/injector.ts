/**
 * injector.ts — Credential broker: injects secrets into tool inputs.
 *
 * SECURITY: This is the only point where raw secret values are retrieved
 * from the keychain at runtime. The mutated input is passed directly to
 * the sandbox container — it is NEVER returned to the LLM or logged.
 *
 * The LLM produces tool inputs containing placeholders like:
 *   { "api_key": "__VAULT_REF:550e8400-e29b-41d4-a716-446655440000__" }
 *
 * The injector resolves the placeholder to the actual value before execution.
 */
import { parseVaultRef } from "@tessera/shared";
import { CredentialError } from "@tessera/shared";
import type { KeychainAdapter } from "./keychain.adapter.js";
import type { RefStore } from "./ref-store.js";

/**
 * Inject a single credential into a tool input JSON.
 *
 * @param toolInputJson - JSON string with __VAULT_REF:id__ placeholder
 * @param refId - The vault reference ID to resolve
 * @param placeholderKey - The JSON key to replace with the real value
 * @param keychain - The keychain adapter to use for lookup
 * @param refStore - The ref store to resolve ref_id → {service, account}
 * @returns JSON string with the placeholder replaced by the actual secret
 */
export async function injectCredential(
  toolInputJson: string,
  refId: string,
  placeholderKey: string,
  keychain: KeychainAdapter,
  refStore: RefStore
): Promise<string> {
  const ref = refStore.getRef(refId);
  if (!ref) {
    throw new CredentialError(`Unknown credential reference: ${refId}`, { ref_id: refId });
  }

  const keychainForService = { ...keychain };
  const secret = await keychainForService.get(ref.account);
  if (secret === null) {
    throw new CredentialError(
      `Secret not found in keychain for ref: ${refId} (service: ${ref.service}, account: ${ref.account})`,
      { ref_id: refId }
    );
  }

  const input = JSON.parse(toolInputJson) as Record<string, unknown>;
  input[placeholderKey] = secret;

  // SECURITY: The mutated JSON with the real secret must be handled carefully.
  // Callers must ensure this value goes only to the sandbox container.
  return JSON.stringify(input);
}

/**
 * Scan a tool input JSON for all VAULT_REF placeholders and inject them all.
 * Handles deeply nested objects via recursive traversal.
 *
 * @param toolInputJson - JSON string potentially containing multiple __VAULT_REF:id__ values
 * @param keychain - Keychain adapter (must be scoped to the correct service)
 * @param refStore - Ref store for lookups
 * @returns JSON string with all placeholders replaced
 */
export async function injectAllCredentials(
  toolInputJson: string,
  keychain: KeychainAdapter,
  refStore: RefStore
): Promise<string> {
  const input = JSON.parse(toolInputJson) as Record<string, unknown>;
  await injectObjectCredentials(input, keychain, refStore);
  return JSON.stringify(input);
}

async function injectObjectCredentials(
  obj: Record<string, unknown>,
  keychain: KeychainAdapter,
  refStore: RefStore
): Promise<void> {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const refId = parseVaultRef(value);
      if (refId !== null) {
        const ref = refStore.getRef(refId);
        if (!ref) {
          throw new CredentialError(`Unknown vault ref in tool input key '${key}': ${refId}`);
        }
        const secret = await keychain.get(ref.account);
        if (secret === null) {
          throw new CredentialError(`Secret not found for ref '${refId}' (key: '${key}')`);
        }
        obj[key] = secret;
      }
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      await injectObjectCredentials(value as Record<string, unknown>, keychain, refStore);
    }
  }
}
