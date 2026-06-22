// ── Sound Effects (shared across all pages) ──
const _AudioCtx = window.AudioContext || window.webkitAudioContext;
let _audioCtx = null;
function _getAudioCtx(){
  if(!_audioCtx) _audioCtx = new _AudioCtx();
  return _audioCtx;
}
function _playBeep(freq, dur, type='sine', vol=0.3){
  try {
    const ctx = _getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch(e){}
}
window.playSaveSuccess = function(){
  _playBeep(880, 0.1, 'sine', 0.2);
  setTimeout(()=>_playBeep(1100, 0.15, 'sine', 0.2), 100);
};
window.playSaveFail = function(){
  _playBeep(220, 0.15, 'sawtooth', 0.25);
  setTimeout(()=>_playBeep(180, 0.2, 'sawtooth', 0.25), 160);
};
