export type RecentCreateFingerprint = {
  fingerprint: string;
  messageId: string;
  createdAt: number;
  turnId: number;
  intentId: string;
  slot?: string;
};

export const COMPONENT_INTENT_LEDGER_TTL_MS = 5 * 60 * 1000;

export type IntentLedgerState = 'reserved' | 'created' | 'updated';

export type IntentLedgerEntry = {
  intentId: string;
  messageId: string;
  componentType: string;
  slot?: string;
  reservedAt: number;
  updatedAt: number;
  state: IntentLedgerState;
};

export type RegisterIntentEntryInput = {
  intentId: string;
  messageId: string;
  componentType: string;
  slot?: string;
  state?: IntentLedgerState;
};

export type ResolveComponentEntry = {
  type: string;
  intentId?: string;
  slot?: string;
  room?: string;
};

export type ResolveComponentContext = {
  getComponentEntry: (id: string) => ResolveComponentEntry | undefined;
  listComponentEntries: () => Iterable<[string, ResolveComponentEntry]>;
  lastResearchPanelId?: string | null;
  roomKey?: string;
};

export class VoiceComponentLedger {
  private readonly lastComponentByTypeByRoom = new Map<string, Map<string, string>>();
  private readonly lastCreatedComponentIdByRoom = new Map<string, string>();
  private readonly recentCreateFingerprintsByRoom = new Map<string, Map<string, RecentCreateFingerprint>>();
  private readonly intentLedgerByRoom = new Map<string, Map<string, IntentLedgerEntry>>();
  private readonly slotLedgerByRoom = new Map<string, Map<string, string>>();
  private readonly messageToIntentByRoom = new Map<string, Map<string, string>>();

  constructor(
    private readonly getRoomKey: () => string,
    private readonly intentLedgerTtlMs: number = COMPONENT_INTENT_LEDGER_TTL_MS,
  ) {}

  private getLastComponentMap() {
    const key = this.getRoomKey();
    let map = this.lastComponentByTypeByRoom.get(key);
    if (!map) {
      map = new Map<string, string>();
      this.lastComponentByTypeByRoom.set(key, map);
    }
    return map;
  }

  getLastComponentForType(type: string) {
    return this.getLastComponentMap().get(type);
  }

  setLastComponentForType(type: string, messageId: string) {
    this.getLastComponentMap().set(type, messageId);
  }

  clearLastComponentForType(type: string, expectedMessageId?: string) {
    const map = this.getLastComponentMap();
    const current = map.get(type);
    if (!current) return false;

    const normalizedExpected =
      typeof expectedMessageId === 'string' ? expectedMessageId.trim() : '';
    if (normalizedExpected && current !== normalizedExpected) {
      return false;
    }

    map.delete(type);
    return true;
  }

  getLastCreatedComponentId() {
    const key = this.getRoomKey();
    return this.lastCreatedComponentIdByRoom.get(key) ?? null;
  }

  setLastCreatedComponentId(messageId: string | null) {
    const key = this.getRoomKey();
    if (!messageId) {
      this.lastCreatedComponentIdByRoom.delete(key);
      return;
    }
    this.lastCreatedComponentIdByRoom.set(key, messageId);
  }

  private getRecentCreateMap() {
    const key = this.getRoomKey();
    let map = this.recentCreateFingerprintsByRoom.get(key);
    if (!map) {
      map = new Map<string, RecentCreateFingerprint>();
      this.recentCreateFingerprintsByRoom.set(key, map);
    }
    return map;
  }

  getRecentCreateFingerprint(type: string) {
    return this.getRecentCreateMap().get(type);
  }

  setRecentCreateFingerprint(type: string, fingerprint: RecentCreateFingerprint) {
    this.getRecentCreateMap().set(type, fingerprint);
  }

  clearIntentForMessage(messageId: string) {
    const messageIntentMap = this.getMessageIntentMap();
    const intentMap = this.getIntentMap();
    const slotMap = this.getSlotMap();
    const intentId = messageIntentMap.get(messageId);
    if (!intentId) return;
    messageIntentMap.delete(messageId);
    const entry = intentMap.get(intentId);
    if (entry?.slot) {
      const currentIntent = slotMap.get(entry.slot);
      if (currentIntent === intentId) {
        slotMap.delete(entry.slot);
      }
    }
    intentMap.delete(intentId);
  }

  private getIntentMap() {
    const key = this.getRoomKey();
    let map = this.intentLedgerByRoom.get(key);
    if (!map) {
      map = new Map<string, IntentLedgerEntry>();
      this.intentLedgerByRoom.set(key, map);
    }
    return map;
  }

  private getSlotMap() {
    const key = this.getRoomKey();
    let map = this.slotLedgerByRoom.get(key);
    if (!map) {
      map = new Map<string, string>();
      this.slotLedgerByRoom.set(key, map);
    }
    return map;
  }

  private getMessageIntentMap() {
    const key = this.getRoomKey();
    let map = this.messageToIntentByRoom.get(key);
    if (!map) {
      map = new Map<string, string>();
      this.messageToIntentByRoom.set(key, map);
    }
    return map;
  }

  registerIntentEntry(entry: RegisterIntentEntryInput) {
    const now = Date.now();
    const intentMap = this.getIntentMap();
    const messageIntentMap = this.getMessageIntentMap();
    const slotMap = this.getSlotMap();

    const existing = intentMap.get(entry.intentId);
    const next: IntentLedgerEntry = {
      intentId: entry.intentId,
      messageId: entry.messageId,
      componentType: entry.componentType,
      slot: entry.slot ?? existing?.slot,
      reservedAt: existing?.reservedAt ?? now,
      updatedAt: now,
      state: entry.state ?? existing?.state ?? 'reserved',
    };
    if (entry.slot) {
      next.slot = entry.slot;
    }

    intentMap.set(next.intentId, next);
    messageIntentMap.set(next.messageId, next.intentId);
    if (next.slot) {
      slotMap.set(next.slot, next.intentId);
    }

    this.cleanupExpired(now);
    return next;
  }

  findIntentByMessage(messageId: string) {
    const intentId = this.getMessageIntentMap().get(messageId);
    if (!intentId) return undefined;
    return this.getIntentMap().get(intentId);
  }

  clearIntentForMessage(messageId: string) {
    const normalizedMessageId = messageId.trim();
    if (!normalizedMessageId) return undefined;

    const messageIntentMap = this.getMessageIntentMap();
    const intentId = messageIntentMap.get(normalizedMessageId);
    if (!intentId) return undefined;

    messageIntentMap.delete(normalizedMessageId);

    const intentMap = this.getIntentMap();
    const entry = intentMap.get(intentId);
    intentMap.delete(intentId);

    if (entry?.slot) {
      const slotMap = this.getSlotMap();
      const currentIntent = slotMap.get(entry.slot);
      if (currentIntent === intentId) {
        slotMap.delete(entry.slot);
      }
    }

    return entry;
  }

  cleanupExpired(now: number = Date.now()) {
    const intentMap = this.getIntentMap();
    const slotMap = this.getSlotMap();
    const messageIntentMap = this.getMessageIntentMap();

    for (const [intentId, entry] of intentMap.entries()) {
      if (now - entry.updatedAt <= this.intentLedgerTtlMs) continue;
      intentMap.delete(intentId);

      if (entry.slot) {
        const currentIntent = slotMap.get(entry.slot);
        if (currentIntent === intentId) {
          slotMap.delete(entry.slot);
        }
      }

      const mappedIntent = messageIntentMap.get(entry.messageId);
      if (mappedIntent === intentId) {
        messageIntentMap.delete(entry.messageId);
      }
    }
  }

  resolveComponentId(args: Record<string, unknown>, context: ResolveComponentContext) {
    const rawId = typeof args.componentId === 'string' ? args.componentId.trim() : '';
    if (rawId) return rawId;

    const currentRoom = context.roomKey || this.getRoomKey() || 'room';
    const typeHint =
      typeof args.type === 'string'
        ? args.type.trim()
        : typeof args.componentType === 'string'
          ? args.componentType.trim()
          : '';
    const allowLast = typeof args.allowLast === 'boolean' ? args.allowLast : false;
    const acceptCandidate = (candidateId: string | undefined | null) => {
      if (!candidateId) return '';
      const entry = context.getComponentEntry(candidateId);
      if (!entry) return '';
      if (typeHint && entry.type !== typeHint) return '';
      if (entry.room && entry.room !== currentRoom) return '';
      return candidateId;
    };

    const rawIntent = typeof args.intentId === 'string' ? args.intentId.trim() : '';
    if (rawIntent) {
      const intentEntry = this.getIntentMap().get(rawIntent);
      if (intentEntry) {
        const accepted = acceptCandidate(intentEntry.messageId);
        if (accepted) return accepted;
      }

      for (const [id, info] of context.listComponentEntries()) {
        if (info.intentId === rawIntent && (!info.room || info.room === currentRoom)) {
          const accepted = acceptCandidate(id);
          if (accepted) return accepted;
        }
      }
    }

    const rawSlot = typeof args.slot === 'string' ? args.slot.trim() : '';
    if (rawSlot) {
      const slotIntentId = this.getSlotMap().get(rawSlot);
      if (slotIntentId) {
        const intentEntry = this.getIntentMap().get(slotIntentId);
        if (intentEntry) {
          const accepted = acceptCandidate(intentEntry.messageId);
          if (accepted) return accepted;
        }
      }

      for (const [id, info] of context.listComponentEntries()) {
        if (info.slot === rawSlot && (!info.room || info.room === currentRoom)) {
          const accepted = acceptCandidate(id);
          if (accepted) return accepted;
        }
      }
    }

    if (typeHint) {
      const byType = this.getLastComponentForType(typeHint);
      const accepted = acceptCandidate(byType);
      if (accepted) return accepted;

      for (const [id, info] of context.listComponentEntries()) {
        if (info.type === typeHint && (!info.room || info.room === currentRoom)) {
          const acceptedCandidate = acceptCandidate(id);
          if (acceptedCandidate) return acceptedCandidate;
        }
      }
    }

    if ((typeHint === 'ResearchPanel' || allowLast) && context.lastResearchPanelId) {
      const acceptedResearchPanel = acceptCandidate(context.lastResearchPanelId);
      if (acceptedResearchPanel) return acceptedResearchPanel;
    }

    const lastCreated = this.getLastCreatedComponentId();
    const acceptedLast = acceptCandidate(lastCreated);
    if (acceptedLast) return acceptedLast;

    return '';
  }
}
