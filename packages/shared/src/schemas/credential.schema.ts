import { z } from "zod";

// A credential reference — an opaque ID pointing to a secret in the vault.
// Raw secret values NEVER appear in these schemas.
export const CredentialRefSchema = z.object({
  ref_id: z.string().uuid(),
  service: z.string(),
  account: z.string(),
  created_at: z.string().datetime(),
});

export type CredentialRef = z.infer<typeof CredentialRefSchema>;

// Placeholder pattern that the LLM uses in tool inputs to reference credentials.
// The vault injector replaces __VAULT_REF:ref_id__ with the actual value
// at execution time, without the LLM ever seeing it.
export const VAULT_REF_PATTERN = /^__VAULT_REF:([a-f0-9-]{36})__$/;
export const VAULT_REF_PREFIX = "__VAULT_REF:";
export const VAULT_REF_SUFFIX = "__";

export function formatVaultRef(refId: string): string {
  return `${VAULT_REF_PREFIX}${refId}${VAULT_REF_SUFFIX}`;
}

export function parseVaultRef(value: string): string | null {
  const match = VAULT_REF_PATTERN.exec(value);
  return match?.[1] ?? null;
}
