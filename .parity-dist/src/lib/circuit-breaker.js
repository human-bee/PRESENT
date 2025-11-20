/**
 * Circuit Breaker utility for preventing duplicate operations
 * Tracks both recent calls and completed operations to prevent loops
 */
export class CircuitBreaker {
    constructor(options = {}) {
        this.options = options;
        this.recentCalls = new Map();
        this.completedCalls = new Map();
        this.cooldowns = new Map();
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
    isDuplicate(signature) {
        const now = Date.now();
        const lastCall = this.recentCalls.get(signature);
        // Register this call
        this.recentCalls.set(signature, now);
        // Clean up old entries
        this.cleanup();
        return !!(lastCall && now - lastCall < this.options.duplicateWindow);
    }
    /**
     * Check if a call was recently completed (within completed window)
     */
    isRecentlyCompleted(signature) {
        const now = Date.now();
        const completedAt = this.completedCalls.get(signature);
        return !!(completedAt && now - completedAt < this.options.completedWindow);
    }
    /**
     * Mark a call as completed
     */
    markCompleted(signature) {
        this.completedCalls.set(signature, Date.now());
        this.cleanup();
    }
    /**
     * Check if an ID is in cooldown
     */
    isInCooldown(id) {
        const now = Date.now();
        const cooldownStart = this.cooldowns.get(id);
        return !!(cooldownStart && now - cooldownStart < this.options.cooldownWindow);
    }
    /**
     * Register a cooldown for an ID
     */
    registerCooldown(id) {
        this.cooldowns.set(id, Date.now());
        this.cleanup();
    }
    /**
     * Get remaining cooldown time in seconds
     */
    getCooldownRemaining(id) {
        const now = Date.now();
        const cooldownStart = this.cooldowns.get(id);
        if (!cooldownStart)
            return 0;
        const elapsed = now - cooldownStart;
        const remaining = this.options.cooldownWindow - elapsed;
        return Math.max(0, Math.ceil(remaining / 1000));
    }
    /**
     * Clean up expired entries to prevent memory leaks
     */
    cleanup() {
        const now = Date.now();
        // Clean recent calls
        for (const [sig, timestamp] of this.recentCalls) {
            if (now - timestamp > this.options.duplicateWindow) {
                this.recentCalls.delete(sig);
            }
        }
        // Clean completed calls
        for (const [sig, timestamp] of this.completedCalls) {
            if (now - timestamp > this.options.completedWindow) {
                this.completedCalls.delete(sig);
            }
        }
        // Clean cooldowns
        for (const [id, timestamp] of this.cooldowns) {
            if (now - timestamp > this.options.cooldownWindow) {
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
//# sourceMappingURL=circuit-breaker.js.map