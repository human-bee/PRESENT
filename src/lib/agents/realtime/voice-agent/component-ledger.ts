export type RecentCreateFingerprint = {
  fingerprint: string;
  messageId: string;
  createdAt: number;
  turnId: number;
  intentId: string;
  slot?: string;
};

export class VoiceComponentLedger {
  private readonly lastComponentByTypeByRoom = new Map<string, Map<string, string>>();
  private readonly lastCreatedComponentIdByRoom = new Map<string, string>();
  private readonly recentCreateFingerprintsByRoom = new Map<string, Map<string, RecentCreateFingerprint>>();

  constructor(private readonly getRoomKey: () => string) {}

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
}
