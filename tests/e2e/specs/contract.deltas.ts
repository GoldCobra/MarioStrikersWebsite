import type { ContractRecord } from "./contract.spec.ts";

// Intended API differences between the reference commit and the working tree.
// Each entry names the change and the PR that introduced it; the normalizer is applied to both sides.
// Keep this empty unless a phase changes the API on purpose.
export function normalizeContract(record: ContractRecord): ContractRecord {
  return record;
}
