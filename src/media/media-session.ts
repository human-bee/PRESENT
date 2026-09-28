import { microphoneConstraints, saveMicrophone } from './microphone';
import type { LocalTrack, Room } from 'livekit-client';
import { emptyMediaState, mediaError, participantsFor, sourceActive, type MediaState } from './media-state';
import { loadLiveKit, preloadLiveKit, type LiveKitSDK } from './livekit-loader';

type Device = 'mic' | 'camera' | 'screen';
const sourceFor = { mic: 'microphone', camera: 'camera', screen: 'screen_share' } as const;

export class MediaSession {
  private state = emptyMediaState();
  private listeners = new Set<() => void>();
  private room: Room | null = null;
  private joining: Promise<Room> | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private busy = new Set<Device>();
  private sdk: LiveKitSDK | null = null;

  constructor(private roomId: string, private identity: string, private name: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): MediaState => this.state;
  private update(patch: Partial<MediaState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private refresh(room: Room) {
    if (this.room !== room) return;
    const local = room.localParticipant;
    this.update({ participants: participantsFor(room), mic: sourceActive(local, 'microphone'),
      camera: sourceActive(local, 'camera'), screen: sourceActive(local, 'screen_share') });
  }
  private wire(room: Room) {
    const refresh = () => this.refresh(room);
    const { RoomEvent, Track, TrackEvent } = this.sdk!;
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantNameChanged]) room.on(event, refresh);
    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      publication.track?.on(TrackEvent.Restarted, refresh);
      publication.track?.on(TrackEvent.Ended, () => {
        if (publication.source === Track.Source.ScreenShare) {
          const audio = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
          if (audio) { audio.stop(); void room.localParticipant.unpublishTrack(audio).catch(() => {}); }
        }
        refresh();
      });
    });
    room.on(RoomEvent.MediaDevicesError, (error) => {
      if (this.room === room) this.update({ error: mediaError(error) });
    });
    room.on(RoomEvent.Reconnecting, () => { if (this.room === room) this.update({ status: 'connecting' }); });
    room.on(RoomEvent.Reconnected, () => { if (this.room === room) this.update({ status: 'connected', error: null }); });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room !== room) return;
      this.disconnect();
      this.update({ status: 'error', error: 'The call disconnected. Turn on a device to reconnect.' });
    });
  }
  private join(): Promise<Room> {
    if (this.joining) return this.joining;
    if (this.room) return Promise.resolve(this.room);
    if (!globalThis.RTCPeerConnection || globalThis.isSecureContext === false) {
      return Promise.reject(new Error('Calls need a browser with WebRTC on HTTPS or localhost.'));
    }
    const promise = this.joinInternal();
    this.joining = promise;
    return promise;
  }
  private async joinInternal(): Promise<Room> {
    const epoch = this.generation;
    const request = new AbortController();
    const sdk = await loadLiveKit();
    if (epoch !== this.generation) throw new Error('Call cancelled.');
    this.sdk = sdk;
    const room = new sdk.Room({ adaptiveStream: false, dynacast: true });
    this.room = room;
    this.request = request;
    this.wire(room);
    this.update({ status: 'connecting', error: null });
    const promise = (async () => {
      const timeout = setTimeout(() => request.abort(), 12000);
      try {
        const response = await fetch('/api/media/token', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, signal: request.signal,
          body: JSON.stringify({ roomId: this.roomId, identity: this.identity, name: this.name }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'The call could not be started.');
        if (epoch !== this.generation) throw new Error('Call cancelled.');
        await room.connect(data.url, data.token);
        if (epoch !== this.generation) { await room.disconnect(); throw new Error('Call cancelled.'); }
        this.update({ status: 'connected', error: null });
        this.refresh(room);
        return room;
      } catch (error) {
        if (this.room === room) {
          this.room = null;
          room.removeAllListeners();
          await room.disconnect();
          this.update({ status: 'error', error: mediaError(error) });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        if (this.request === request) this.request = null;
        if (epoch === this.generation) this.joining = null;
      }
    })();
    return promise;
  }
  connect = async () => {
    const epoch = this.generation;
    try { await this.join(); }
    catch (error) { if (epoch === this.generation) this.update({ status: 'error', error: mediaError(error) }); }
  };
  private async capture(device: Device): Promise<LocalTrack[]> {
    const sdk = this.sdk ?? await loadLiveKit();
    this.sdk = sdk;
    if (!navigator.mediaDevices) return Promise.reject(new Error('Media devices are unavailable in this browser.'));
    if (device === 'screen') {
      if (!navigator.mediaDevices.getDisplayMedia) return Promise.reject(new Error('Screen sharing is unavailable in this browser.'));
      return sdk.createLocalScreenTracks({ audio: true });
    }
    return device === 'mic'
      ? microphoneConstraints().then(options => sdk.createLocalAudioTrack(options)).then((track) => [track])
      : sdk.createLocalVideoTrack({ resolution: { width: 1280, height: 720, frameRate: 24 } }).then((track) => [track]);
  }
  private async toggle(device: Device) {
    if (this.busy.has(device)) return;
    this.busy.add(device);
    const epoch = this.generation;
    const captured: LocalTrack[] = [];
    let publishingRoom: Room | null = null;
    try {
      this.update({ error: null });
      // Screen permissions must start in the user gesture, before any network await.
      if (device === 'screen' && !this.state.screen) captured.push(...await this.capture(device));
      if (epoch !== this.generation) return;
      const room = await this.join();
      if (epoch !== this.generation) return;
      publishingRoom = room;
      const local = room.localParticipant;
      const { Track } = this.sdk!;
      const primarySource = device === 'mic' ? Track.Source.Microphone : device === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
      const publication = local.getTrackPublication(primarySource);
      if (publication?.track) {
        const sources = device === 'screen' ? [Track.Source.ScreenShare, Track.Source.ScreenShareAudio] : [primarySource];
        for (const source of sources) {
          const track = local.getTrackPublication(source)?.track;
          if (track) { track.stop(); await local.unpublishTrack(track); }
        }
      } else {
        if (!captured.length) captured.push(...await this.capture(device));
        if (epoch !== this.generation) return;
        for (const track of captured) await local.publishTrack(track, { source: track.source });
        if (epoch !== this.generation) { await room.disconnect(); return; }
        captured.length = 0; // The room now owns and stops these tracks.
      }
      this.refresh(room);
    } catch (error) {
      if (epoch === this.generation) this.update({ error: mediaError(error), status: this.room ? this.state.status : 'error' });
    } finally {
      for (const track of captured) {
        track.stop();
        await publishingRoom?.localParticipant.unpublishTrack(track).catch(() => {});
      }
      if (publishingRoom) this.refresh(publishingRoom);
      if (epoch === this.generation) this.busy.delete(device);
    }
  }
  setDevice = async (kind: 'audioinput' | 'videoinput', deviceId: string) => {
    if (kind === 'audioinput') saveMicrophone(deviceId);
    if (!this.room) return;
    try { await this.room.switchActiveDevice(kind, deviceId); this.refresh(this.room); }
    catch (error) { this.update({ error: mediaError(error) }); }
  };
  toggleMic = () => this.toggle('mic');
  toggleCamera = () => this.toggle('camera');
  toggleScreen = () => this.toggle('screen');
  preload = preloadLiveKit;
  disconnect = () => {
    this.generation += 1;
    this.request?.abort();
    this.request = null;
    this.joining = null;
    this.busy.clear();
    const room = this.room;
    this.room = null;
    if (room) {
      for (const publication of room.localParticipant.trackPublications.values()) publication.track?.stop();
      room.removeAllListeners();
      void room.disconnect();
    }
    this.update(emptyMediaState());
  };
}
