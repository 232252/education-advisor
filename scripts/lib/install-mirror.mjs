// Decide whether a Windows install should leave the official npm / GitHub
// endpoints. Lockfile integrity still checks every tarball; this only picks
// a faster host when the official one is clearly slower.

export function preferMirror(officialMs, mirrorMs) {
  if (!Number.isFinite(mirrorMs)) return false
  if (!Number.isFinite(officialMs)) return true
  // Official is already fast — don't add a third-party hop.
  if (officialMs < 400) return false
  return mirrorMs * 1.8 < officialMs
}
