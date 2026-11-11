/** Pure rules for the 3-of-5 recovery vault screens. */
export type SlotKind = "paper" | "nfc" | "contact" | "passkey" | "device";

/** ROUT may hold at most 2 passkey-wrapped shards (also enforced in the database). */
export const MAX_SERVER_SHARDS = 2;

/** All 5 shards stored, passkey ones actually sealed, and never 3+ on the server. */
export function slotsReady(slots: { kind: SlotKind; done: boolean; sealed?: unknown }[]): boolean {
  if (slots.length !== 5) return false;
  if (slots.filter((s) => s.kind === "passkey").length > MAX_SERVER_SHARDS) return false;
  return slots.every((s) => s.done && (s.kind !== "passkey" || !!s.sealed));
}

/** How many more distinct valid shards are needed to reach the threshold. */
export function missingShards(validIndexes: number[], threshold: number): number {
  return Math.max(0, threshold - new Set(validIndexes).size);
}
