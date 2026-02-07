import * as React from 'react';
import { Room, RoomEvent } from 'livekit-client';

type MediaDeviceKind = 'audioinput' | 'videoinput';

type StoredDeviceInfo = {
  deviceId: string;
  label?: string | null;
  groupId?: string | null;
};

function storageKey(kind: MediaDeviceKind) {
  return `livekit:lastDevice:${kind}`;
}

function legacyKey(kind: MediaDeviceKind) {
  return kind === 'audioinput' ? 'livekit:lastMicId' : 'livekit:lastCamId';
}

function readStoredDevice(kind: MediaDeviceKind): StoredDeviceInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(kind));
    if (raw) {
      const parsed = JSON.parse(raw) as StoredDeviceInfo;
      if (parsed?.deviceId) {
        return parsed;
      }
    }
  } catch {}

  try {
    const fallback = window.localStorage.getItem(legacyKey(kind));
    if (fallback) return { deviceId: fallback };
  } catch {}

  return null;
}

function persistStoredDevice(kind: MediaDeviceKind, info: StoredDeviceInfo) {
  if (typeof window === 'undefined' || !info.deviceId) return;
  try {
    const payload: StoredDeviceInfo = {
      deviceId: info.deviceId,
      label: info.label ?? '',
      groupId: info.groupId ?? '',
    };
    window.localStorage.setItem(storageKey(kind), JSON.stringify(payload));
    window.localStorage.setItem(legacyKey(kind), info.deviceId);
  } catch {}
}

function matchStoredDevice(
  devices: MediaDeviceInfo[],
  stored: StoredDeviceInfo | null,
): MediaDeviceInfo | undefined {
  if (!stored) return undefined;
  const byId = devices.find((device) => device.deviceId === stored.deviceId);
  if (byId) return byId;
  if (stored.groupId) {
    const byGroup = devices.find(
      (device) => device.groupId && device.groupId === stored.groupId,
    );
    if (byGroup) return byGroup;
  }
  if (stored.label) {
    const labelLower = stored.label.toLowerCase();
    const byLabel = devices.find(
      (device) => device.label && device.label.toLowerCase() === labelLower,
    );
    if (byLabel) return byLabel;
  }
  return undefined;
}

type UseLivekitLocalDevicesArgs = {
  room: Room | null | undefined;
  isLocal: boolean;
};

export function useLivekitLocalDevices({ room, isLocal }: UseLivekitLocalDevicesArgs) {
  const [audioDevices, setAudioDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [activeMicrophoneId, setActiveMicrophoneId] = React.useState<string | null>(null);
  const [activeCameraId, setActiveCameraId] = React.useState<string | null>(null);

  const updateActiveDevicesFromRoom = React.useCallback(() => {
    if (!isLocal) return;
    const mic = room?.getActiveDevice?.('audioinput');
    const cam = room?.getActiveDevice?.('videoinput');
    if (mic) setActiveMicrophoneId(mic);
    if (cam) setActiveCameraId(cam);
  }, [isLocal, room]);

  const switchLocalDevice = React.useCallback(
    async (kind: MediaDeviceKind, deviceId: string) => {
      if (!isLocal || !room) return;
      try {
        type DeviceSwitchRoom = {
          switchActiveDevice?: (
            kind: MediaDeviceKind,
            deviceId: string,
            exact?: boolean,
          ) => Promise<boolean> | Promise<void>;
          localParticipant?: {
            setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
            setCameraEnabled?: (enabled: boolean) => Promise<void>;
          };
        };
        const deviceRoom = room as unknown as DeviceSwitchRoom;
        await deviceRoom.switchActiveDevice?.(kind, deviceId, true);
        if (kind === 'audioinput') {
          await deviceRoom.localParticipant?.setMicrophoneEnabled?.(true);
        } else {
          await deviceRoom.localParticipant?.setCameraEnabled?.(true);
        }
      } catch {}
    },
    [isLocal, room],
  );

  const refreshDevices = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const [audioInputs, videoInputs] = await Promise.all([
        Room.getLocalDevices('audioinput', true),
        Room.getLocalDevices('videoinput', true),
      ]);
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      updateActiveDevicesFromRoom();
      return;
    } catch {}
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      if (!list) return;
      const audioInputs = list.filter((device) => device.kind === 'audioinput');
      const videoInputs = list.filter((device) => device.kind === 'videoinput');
      setAudioDevices(audioInputs);
      setVideoDevices(videoInputs);
      updateActiveDevicesFromRoom();
    } catch {}
  }, [updateActiveDevicesFromRoom]);

  React.useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  React.useEffect(() => {
    if (!room) return;
    if (!isLocal) return;
    const handleMediaDevicesChanged = () => {
      void refreshDevices();
    };
    // @ts-expect-error runtime event ensured by LiveKit typings
    room.on(RoomEvent.MediaDevicesChanged, handleMediaDevicesChanged);
    return () => {
      // @ts-expect-error runtime event ensured by LiveKit typings
      room.off(RoomEvent.MediaDevicesChanged, handleMediaDevicesChanged);
    };
  }, [room, refreshDevices, isLocal]);

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    const handler = () => {
      void refreshDevices();
    };
    try {
      navigator.mediaDevices.addEventListener('devicechange', handler);
      return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
    } catch {
      const mediaDevices = navigator.mediaDevices as unknown as {
        ondevicechange: null | (() => void);
      };
      const previous = mediaDevices.ondevicechange;
      mediaDevices.ondevicechange = handler;
      return () => {
        if (mediaDevices.ondevicechange === handler) {
          mediaDevices.ondevicechange = previous ?? null;
        }
      };
    }
  }, [refreshDevices]);

  React.useEffect(() => {
    if (!isLocal || !room) return;
    type DeviceSwitchRoom = {
      switchActiveDevice?: (
        kind: MediaDeviceKind,
        deviceId: string,
        exact?: boolean,
      ) => Promise<boolean> | Promise<void>;
      localParticipant?: {
        setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
        setCameraEnabled?: (enabled: boolean) => Promise<void>;
      };
      state?: string;
    };
    const deviceRoom = room as unknown as DeviceSwitchRoom;

    const restore = async () => {
      try {
        const isConnected = (deviceRoom.state as unknown as string) === 'connected';
        if (!isConnected) return;

        const [audioInputs, videoInputs] = await Promise.all([
          Room.getLocalDevices('audioinput', true),
          Room.getLocalDevices('videoinput', true),
        ]);
        setAudioDevices(audioInputs);
        setVideoDevices(videoInputs);

        const storedMic = matchStoredDevice(audioInputs, readStoredDevice('audioinput'));
        const storedCam = matchStoredDevice(videoInputs, readStoredDevice('videoinput'));

        if (storedMic) {
          await switchLocalDevice('audioinput', storedMic.deviceId);
          setActiveMicrophoneId(storedMic.deviceId);
          persistStoredDevice('audioinput', storedMic);
        }

        if (storedCam) {
          await switchLocalDevice('videoinput', storedCam.deviceId);
          setActiveCameraId(storedCam.deviceId);
          persistStoredDevice('videoinput', storedCam);
        }
      } catch {}
    };

    const timeout = window.setTimeout(() => {
      void restore();
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [isLocal, room, switchLocalDevice]);

  React.useEffect(() => {
    if (!isLocal || !room) return;
    const onActiveDeviceChanged = (kind: MediaDeviceKind, deviceId?: string) => {
      if (!deviceId) return;
      if (kind === 'audioinput') {
        setActiveMicrophoneId(deviceId);
        const selected = audioDevices.find((device) => device.deviceId === deviceId);
        persistStoredDevice('audioinput', {
          deviceId,
          label: selected?.label ?? '',
          groupId: selected?.groupId ?? '',
        });
      }
      if (kind === 'videoinput') {
        setActiveCameraId(deviceId);
        const selected = videoDevices.find((device) => device.deviceId === deviceId);
        persistStoredDevice('videoinput', {
          deviceId,
          label: selected?.label ?? '',
          groupId: selected?.groupId ?? '',
        });
      }
    };
    // @ts-expect-error runtime event ensured by LiveKit typings
    room.on(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged);
    return () => {
      // @ts-expect-error runtime event ensured by LiveKit typings
      room.off(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged);
    };
  }, [audioDevices, videoDevices, isLocal, room]);

  const microphoneSelectValue = React.useMemo(() => {
    if (!activeMicrophoneId) {
      return audioDevices.some((device) => device.deviceId === 'default') ? 'default' : '';
    }
    return audioDevices.some((device) => device.deviceId === activeMicrophoneId)
      ? activeMicrophoneId
      : '';
  }, [audioDevices, activeMicrophoneId]);

  const cameraSelectValue = React.useMemo(() => {
    if (!activeCameraId) {
      return videoDevices.some((device) => device.deviceId === 'default') ? 'default' : '';
    }
    return videoDevices.some((device) => device.deviceId === activeCameraId)
      ? activeCameraId
      : '';
  }, [videoDevices, activeCameraId]);

  const handleMicrophoneSelect = React.useCallback(
    async (deviceId: string) => {
      setActiveMicrophoneId(deviceId);
      try {
        await switchLocalDevice('audioinput', deviceId);
        const selectedDevice = audioDevices.find((device) => device.deviceId === deviceId);
        persistStoredDevice('audioinput', {
          deviceId,
          label: selectedDevice?.label ?? '',
          groupId: selectedDevice?.groupId ?? '',
        });
      } catch {}
    },
    [audioDevices, switchLocalDevice],
  );

  const handleCameraSelect = React.useCallback(
    async (deviceId: string) => {
      setActiveCameraId(deviceId);
      try {
        await switchLocalDevice('videoinput', deviceId);
        const selectedDevice = videoDevices.find((device) => device.deviceId === deviceId);
        persistStoredDevice('videoinput', {
          deviceId,
          label: selectedDevice?.label ?? '',
          groupId: selectedDevice?.groupId ?? '',
        });
      } catch {}
    },
    [videoDevices, switchLocalDevice],
  );

  return {
    audioDevices,
    videoDevices,
    microphoneSelectValue,
    cameraSelectValue,
    refreshDevices,
    handleMicrophoneSelect,
    handleCameraSelect,
  };
}
