export type EvidenceStatus = 'pending' | 'verified' | 'disputed';

/** Verification is an explicit human assessment backed by a quote and inspectable source. */
export function canVerifyClaim(claim: Record<string, unknown>): boolean {
  if (typeof claim.quotedEvidence !== 'string' || !claim.quotedEvidence.trim()) return false;
  if (!Array.isArray(claim.sourceURLs) || !claim.sourceURLs.length) return false;
  return claim.sourceURLs.every((value) => {
    if (typeof value !== 'string' || value.length > 2000) return false;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  });
}
