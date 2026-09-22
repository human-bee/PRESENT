const key = 'present:microphone-id';
export function saveMicrophone(id: string) { localStorage.setItem(key, id); window.dispatchEvent(new Event('present:microphone-change')); }
export async function microphoneConstraints(): Promise<MediaTrackConstraints> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput' && !['default', 'communications'].includes(device.deviceId));
  const saved = localStorage.getItem(key);
  const chosen = saved ? devices.find(device => device.deviceId === saved) : devices.find(device => /macbook|built.?in|internal microphone/i.test(device.label) && !/iphone/i.test(device.label));
  if (!chosen) throw new Error('Choose a microphone in voice settings. PRESENT will not switch to the system default.');
  if (/iphone/i.test(chosen.label)) throw new Error('iPhone microphone is disabled. Choose another microphone in voice settings.');
  saveMicrophone(chosen.deviceId);
  return { deviceId: { exact: chosen.deviceId }, echoCancellation: true, noiseSuppression: true };
}
