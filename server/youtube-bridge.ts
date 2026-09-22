// Trusted static wrapper code. No room content or model-generated JavaScript enters it.
export const youtubeBridge = `
let player, ready = false, error = null, blocked = false;
const snapshot = () => ({ready, error, blocked, state: ready ? player.getPlayerState() : null, seconds: ready ? player.getCurrentTime() : null, rate: ready ? player.getPlaybackRate() : null});
window.onYouTubeIframeAPIReady = () => {
 player = new YT.Player('player', {events: {
  onReady: () => { ready = true; },
  onError: e => { error = e.data; },
  onAutoplayBlocked: () => { blocked = true; }
 }});
};
window.addEventListener('message', e => {
 if (e.source !== parent || e.origin !== location.origin || e.data?.type !== 'present:video-command') return;
 const {requestId, command, seconds, rate} = e.data;
 if (typeof requestId !== 'string' || !['play','pause','restart','seek','rate','status'].includes(command)) return;
 if (ready) {
  blocked = false;
  if (command === 'play') player.playVideo();
  if (command === 'pause') player.pauseVideo();
  if (command === 'restart') { player.seekTo(0, true); player.playVideo(); }
  if (command === 'seek' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 604800) player.seekTo(seconds, true);
  if (command === 'rate' && player.getAvailablePlaybackRates().includes(rate)) player.setPlaybackRate(rate);
 }
 setTimeout(() => parent.postMessage({type:'present:video-result',requestId,...snapshot()}, location.origin), command === 'status' ? 0 : 700);
});
`;
