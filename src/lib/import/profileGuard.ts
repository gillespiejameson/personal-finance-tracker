import type { BankProfile } from "./types";

/**
 * A profile may only be persisted to the database when it is not itself a
 * builtin, and its header signature does not collide with any builtin's.
 * This stops a flip-signs / date-format tweak (which clones a detected
 * builtin profile) from ever shadowing that builtin under a saved row —
 * `allProfiles()` lists saved profiles before builtins, so a shadowing row
 * would silently hijack every future import of that bank.
 */
export function canSaveProfile(
  profile: BankProfile,
  builtins: BankProfile[],
): boolean {
  if (profile.builtin) return false;
  return !builtins.some((b) => b.headerSignature === profile.headerSignature);
}
