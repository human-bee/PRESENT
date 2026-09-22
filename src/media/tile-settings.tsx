import { MicrophonePicker } from './microphone-picker';
import { useEffect, useState } from 'react';
import { stopEventPropagation } from 'tldraw';
import { useCanvasMedia } from './media-context';
import { Icon } from '../icons';

export function MediaTileSettings({ participantId }: { participantId: string }) {
  const media = useCanvasMedia();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const local = media?.participants.some(person => person.id === participantId && person.isLocal);
  useEffect(() => {
    if (!open || !navigator.mediaDevices) return;
    let alive = true;
    const refresh = () => { void navigator.mediaDevices.enumerateDevices().then(list => { if (alive) setDevices(list); }).catch(() => {}); };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => { alive = false; navigator.mediaDevices.removeEventListener('devicechange', refresh); };
  }, [open]);
  if (!local || !media) return null;
  return <div className="media-settings" onPointerDown={stopEventPropagation} onPointerUp={stopEventPropagation} onDoubleClick={stopEventPropagation} onKeyDown={event => {
    event.stopPropagation(); if (event.key === 'Escape') setOpen(false);
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" aria-label="Camera and microphone settings" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="settings" size={16}/></button>
    {open && <div className="media-settings-menu" role="group" aria-label="Camera and microphone settings">
      <button type="button" onClick={() => void media.toggleCamera?.()}>{media.camera ? 'Turn camera off' : 'Turn camera on'}</button>
      <button type="button" onClick={() => void media.toggleMic?.()}>{media.mic ? 'Mute microphone' : 'Unmute microphone'}</button>
      <MicrophonePicker disabled={media.mic}/>{(['videoinput'] as const).map(kind => <label key={kind}>{'Camera'}
        <select aria-label={'Camera device'} defaultValue="" onChange={event => void media.setDevice?.(kind, event.target.value)}>
          <option value="" disabled>Choose device</option>
          {devices.filter(device => device.kind === kind).map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Device ${index + 1}`}</option>)}
        </select>
      </label>)}
    </div>}
  </div>;
}
