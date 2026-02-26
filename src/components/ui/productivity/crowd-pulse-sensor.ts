import { computeCrowdMetrics, type HandLandmark } from './crowd-pulse-hand-utils';

export type CrowdPulseSensorStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'blocked'
  | 'error'
  | 'unsupported';

export type CrowdPulseSensorSample = {
  handCount: number;
  confidence: number;
  noiseLevel: number;
  timestamp: number;
};

type CrowdPulseSubscriber = {
  onSample: (sample: CrowdPulseSensorSample) => void;
  onStatus: (status: CrowdPulseSensorStatus, detail: string) => void;
};

const SENSOR_DETECT_INTERVAL_MS = 400;
const HIDDEN_LOOP_INTERVAL_MS = 1_000;

type SharedSensorState = {
  status: CrowdPulseSensorStatus;
  detail: string;
  subscribers: Set<CrowdPulseSubscriber>;
  startPromise: Promise<void> | null;
  startToken: number;
  running: boolean;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  handLandmarker: any;
  timeoutId: ReturnType<typeof setTimeout> | null;
  lastVideoTime: number;
};

const sharedSensor: SharedSensorState = {
  status: 'idle',
  detail: '',
  subscribers: new Set<CrowdPulseSubscriber>(),
  startPromise: null,
  startToken: 0,
  running: false,
  stream: null,
  video: null,
  handLandmarker: null,
  timeoutId: null,
  lastVideoTime: -1,
};

const notifyStatus = (status: CrowdPulseSensorStatus, detail: string) => {
  sharedSensor.status = status;
  sharedSensor.detail = detail;
  for (const subscriber of sharedSensor.subscribers) {
    try {
      subscriber.onStatus(status, detail);
    } catch {
      // Never let one subscriber break the shared loop.
    }
  }
};

const notifySample = (sample: CrowdPulseSensorSample) => {
  for (const subscriber of sharedSensor.subscribers) {
    try {
      subscriber.onSample(sample);
    } catch {
      // Never let one subscriber break the shared loop.
    }
  }
};

const clearTimers = () => {
  if (sharedSensor.timeoutId !== null) {
    clearTimeout(sharedSensor.timeoutId);
    sharedSensor.timeoutId = null;
  }
};

const stopSharedSensor = (nextStatus?: {
  status: CrowdPulseSensorStatus;
  detail: string;
}) => {
  sharedSensor.startToken += 1;
  sharedSensor.running = false;
  clearTimers();

  if (sharedSensor.stream) {
    sharedSensor.stream.getTracks().forEach((track) => track.stop());
    sharedSensor.stream = null;
  }

  if (sharedSensor.video) {
    try {
      sharedSensor.video.pause();
    } catch {
      // ignore
    }
    sharedSensor.video.srcObject = null;
    sharedSensor.video = null;
  }

  if (sharedSensor.handLandmarker?.close) {
    try {
      sharedSensor.handLandmarker.close();
    } catch {
      // ignore
    }
  }
  sharedSensor.handLandmarker = null;
  sharedSensor.lastVideoTime = -1;

  if (nextStatus) {
    notifyStatus(nextStatus.status, nextStatus.detail);
  } else {
    notifyStatus('idle', 'Camera paused');
  }
};

const scheduleLoop = () => {
  if (!sharedSensor.running) {
    return;
  }
  const hidden = typeof document !== 'undefined' && document.hidden;
  clearTimers();
  sharedSensor.timeoutId = setTimeout(
    runLoop,
    hidden ? HIDDEN_LOOP_INTERVAL_MS : SENSOR_DETECT_INTERVAL_MS,
  );
};

const runLoop = () => {
  if (!sharedSensor.running || !sharedSensor.video || !sharedSensor.handLandmarker) {
    return;
  }
  if (!sharedSensor.subscribers.size) {
    stopSharedSensor();
    return;
  }

  if (typeof document !== 'undefined' && document.hidden) {
    scheduleLoop();
    return;
  }

  const now = performance.now();

  if (sharedSensor.video.currentTime === sharedSensor.lastVideoTime) {
    scheduleLoop();
    return;
  }
  sharedSensor.lastVideoTime = sharedSensor.video.currentTime;

  let result: any;
  try {
    result = sharedSensor.handLandmarker.detectForVideo(sharedSensor.video, now);
  } catch (error) {
    stopSharedSensor({
      status: 'error',
      detail: error instanceof Error ? error.message : 'Sensor error',
    });
    return;
  }

  const landmarks = Array.isArray(result?.landmarks) ? (result.landmarks as HandLandmark[][]) : [];
  const handedness = Array.isArray(result?.handednesses)
    ? result.handednesses
    : Array.isArray(result?.handedness)
      ? result.handedness
      : undefined;

  const metrics = computeCrowdMetrics(landmarks, handedness);
  notifySample({
    handCount: metrics.handCount,
    confidence: metrics.confidence,
    noiseLevel: metrics.noiseLevel,
    timestamp: Date.now(),
  });

  scheduleLoop();
};

const startSharedSensor = async () => {
  if (sharedSensor.running || sharedSensor.startPromise) {
    return sharedSensor.startPromise ?? Promise.resolve();
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    notifyStatus('unsupported', 'Camera unavailable');
    return;
  }

  const startupToken = sharedSensor.startToken + 1;
  sharedSensor.startToken = startupToken;
  const startupPromise = (async () => {
    notifyStatus('loading', 'Camera starting...');
    let startupStream: MediaStream | null = null;
    let startupVideo: HTMLVideoElement | null = null;
    let startupHandLandmarker: any = null;
    const isStaleStartup = () =>
      startupToken !== sharedSensor.startToken || sharedSensor.subscribers.size === 0;
    try {
      startupStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 270 },
          facingMode: 'user',
        },
        audio: false,
      });
      if (isStaleStartup()) {
        startupStream.getTracks().forEach((track) => track.stop());
        return;
      }

      startupVideo = document.createElement('video');
      startupVideo.playsInline = true;
      startupVideo.muted = true;
      startupVideo.autoplay = true;
      startupVideo.srcObject = startupStream;
      await startupVideo.play();
      if (isStaleStartup()) {
        startupStream.getTracks().forEach((track) => track.stop());
        try {
          startupVideo.pause();
        } catch {
          // ignore
        }
        startupVideo.srcObject = null;
        return;
      }

      const visionModule = await import('@mediapipe/tasks-vision');
      const fileset = await visionModule.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm',
      );
      startupHandLandmarker = await visionModule.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
      if (isStaleStartup()) {
        startupStream.getTracks().forEach((track) => track.stop());
        try {
          startupVideo.pause();
        } catch {
          // ignore
        }
        startupVideo.srcObject = null;
        try {
          startupHandLandmarker.close();
        } catch {
          // ignore
        }
        return;
      }

      sharedSensor.stream = startupStream;
      sharedSensor.video = startupVideo;
      sharedSensor.handLandmarker = startupHandLandmarker;
      sharedSensor.lastVideoTime = -1;
      sharedSensor.running = true;
      startupStream = null;
      startupVideo = null;
      startupHandLandmarker = null;
      notifyStatus('ready', 'Camera live');
      scheduleLoop();
    } catch (error) {
      if (startupStream) {
        startupStream.getTracks().forEach((track) => track.stop());
      }
      if (startupVideo) {
        try {
          startupVideo.pause();
        } catch {
          // ignore
        }
        startupVideo.srcObject = null;
      }
      if (startupHandLandmarker?.close) {
        try {
          startupHandLandmarker.close();
        } catch {
          // ignore
        }
      }
      if (isStaleStartup()) {
        return;
      }
      const isNotAllowed =
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: string }).name === 'NotAllowedError';
      stopSharedSensor(
        isNotAllowed
          ? { status: 'blocked', detail: 'Camera blocked' }
          : { status: 'error', detail: error instanceof Error ? error.message : 'Sensor error' },
      );
    } finally {
      if (sharedSensor.startPromise === startupPromise) {
        sharedSensor.startPromise = null;
      }
    }
  })();

  sharedSensor.startPromise = startupPromise;
  return startupPromise;
};

export const subscribeCrowdPulseSensor = (
  onSample: CrowdPulseSubscriber['onSample'],
  onStatus: CrowdPulseSubscriber['onStatus'],
): (() => void) => {
  const subscriber: CrowdPulseSubscriber = { onSample, onStatus };
  sharedSensor.subscribers.add(subscriber);

  // Immediate status delivery for newly mounted subscribers.
  try {
    subscriber.onStatus(sharedSensor.status, sharedSensor.detail);
  } catch {
    // ignore
  }

  void startSharedSensor();

  return () => {
    sharedSensor.subscribers.delete(subscriber);
    if (!sharedSensor.subscribers.size) {
      stopSharedSensor();
    }
  };
};

export const getCrowdPulseSensorStream = (): MediaStream | null => sharedSensor.stream;
