/** Explain a missing deployment input. Never change or bypass SDK license validation. */
export function missingProductionLicense(production: boolean, hostname: string, key?: string): boolean {
  return production && !key?.trim() && !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname);
}
