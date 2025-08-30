/**
 * Circuit Breaker utility for preventing duplicate operations
 * Tracks both recent calls and completed operations to prevent loops
 */

export interface CircuitBreakerOptions {
  duplicateWindow?: number; // Window for detecting duplicate calls (default: 3s)
  completedWindow?: number; // Window for blocking repeated completed calls (default: 30s)
  cooldownWindow?: number; // Window for general cooldowns (default: 5s)
}

export class CircuitBreaker {
  private recentCalls = new Map<string, number>();
  private completedCalls = new Map<string, number>();
  private cooldowns = new Map<string, number>();

  constructor(private options: CircuitBreakerOptions = {}) {
    this.options = {
      duplicateWindow: 3000,
      completedWindow: 30000,
      cooldownWindow: 5000,
      ...options,
    };
  }

  /**
   * Check if a call signature is a duplicate (within duplicate window)
   */
  isDuplicate(signature: string): boolean {
    const now = Date.now();
    const lastCall = this.recentCalls.get(signature);

    // Register this call
    this.recentCalls.set(signature, now);

    // Clean up old entries
    this.cleanup();

    return !!(lastCall && now - lastCall < this.options.duplicateWindow!);
  }

  /**
   * Check if a call was recently completed (within completed window)
   */
  isRecentlyCompleted(signature: string): boolean {
    const now = Date.now();
    const completedAt = this.completedCalls.get(signature);

    return !!(completedAt && now - completedAt < this.options.completedWindow!);
  }

  /**
   * Mark a call as completed
   */
  markCompleted(signature: string): void {
    this.completedCalls.set(signature, Date.now());
    this.cleanup();
  }

  /**
   * Check if an ID is in cooldown
   */
  isInCooldown(id: string): boolean {
    const now = Date.now();
    const cooldownStart = this.cooldowns.get(id);

    return !!(cooldownStart && now - cooldownStart < this.options.cooldownWindow!);
  }

  /**
   * Register a cooldown for an ID
   */
  registerCooldown(id: string): void {
    this.cooldowns.set(id, Date.now());
    this.cleanup();
  }

  /**
   * Get remaining cooldown time in seconds
   */
  getCooldownRemaining(id: string): number {
    const now = Date.now();
    const cooldownStart = this.cooldowns.get(id);

    if (!cooldownStart) return 0;

    const elapsed = now - cooldownStart;
    const remaining = this.options.cooldownWindow! - elapsed;

    return Math.max(0, Math.ceil(remaining / 1000));
  }

  /**
   * Clean up expired entries to prevent memory leaks
   */
  private cleanup(): void {
    const now = Date.now();

    // Clean recent calls
    for (const [sig, timestamp] of this.recentCalls) {
      if (now - timestamp > this.options.duplicateWindow!) {
        this.recentCalls.delete(sig);
      }
    }

    // Clean completed calls
    for (const [sig, timestamp] of this.completedCalls) {
      if (now - timestamp > this.options.completedWindow!) {
        this.completedCalls.delete(sig);
      }
    }

    // Clean cooldowns
    for (const [id, timestamp] of this.cooldowns) {
      if (now - timestamp > this.options.cooldownWindow!) {
        this.cooldowns.delete(id);
      }
    }
  }

  /**
   * Get current state (for debugging)
   */
  getState() {
    return {
      recentCalls: this.recentCalls.size,
      completedCalls: this.completedCalls.size,
      cooldowns: this.cooldowns.size,
    };
  }
}
