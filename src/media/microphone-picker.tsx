import { useEffect, useState } from 'react';
import { saveMicrophone } from './microphone';
import './microphone-picker.css';

export function MicrophonePicker({ disabled = false }: { disabled?: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(() => localStorage.getItem('present:microphone-id'));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {}); };
    const sync = () => setSelected(localStorage.getItem('present:microphone-id'));
    refresh(); navigator.mediaDevices?.addEventListener('devicechange', refresh);
    window.addEventListener('present:microphone-change', sync);
    window.addEventListener('storage', sync);
    return () => { navigator.mediaDevices?.removeEventListener('devicechange', refresh); window.removeEventListener('present:microphone-change', sync); window.removeEventListener('storage', sync); };
  }, []);
  const available = devices.filter(device => device.kind === 'audioinput' && device.deviceId && !['default', 'communications'].includes(device.deviceId) && !/iphone/i.test(device.label));
  const chosen = selected ? available.find(device => device.deviceId === selected) : available.find(device => /macbook|built.?in|internal microphone/i.test(device.label));
  const label = (device: MediaDeviceInfo) => device.label.replace(/\s*\([^)]*\)\s*$/, '') || 'Unnamed microphone';
  return <div className="mic-picker" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" className="mic-picker-trigger" aria-label="Microphone device" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="mic-picker-label">Mic</span><span className="mic-picker-name">{chosen ? label(chosen) : selected ? 'Saved mic unavailable' : 'Choose microphone'}</span><span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
    </button>
    {open && <div className="mic-picker-menu" role="group" aria-label="Choose microphone">
      {available.map(device => <button type="button" key={device.deviceId} disabled={disabled} aria-pressed={chosen?.deviceId === device.deviceId} onClick={() => { saveMicrophone(device.deviceId); setOpen(false); }}><span>{label(device)}</span><span aria-hidden="true">{chosen?.deviceId === device.deviceId ? '✓' : ''}</span></button>)}
      {!available.length && <small>No microphones available.</small>}
      {disabled && <small>Stop listening before changing microphones.</small>}
    </div>}
  </div>;
}
