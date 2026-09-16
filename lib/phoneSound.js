let audioCtx = null;
let ringTimer = null;
let ringing = false;

function audioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(audio, freq1, freq2, durationSec) {
  const now = audio.currentTime;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  gain.connect(audio.destination);
  for (const freq of [freq1, freq2]) {
    const osc = audio.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + durationSec);
  }
}

export function unlockPhoneAudio() {
  audioContext();
}

export function startRingtone() {
  if (ringing) return;
  ringing = true;
  const audio = audioContext();
  if (!audio) return;
  const ring = () => {
    if (!ringing) return;
    tone(audio, 440, 480, 0.4);
    setTimeout(() => {
      if (ringing) tone(audio, 440, 480, 0.4);
    }, 500);
  };
  ring();
  ringTimer = setInterval(ring, 2600);
}

export function stopRingtone() {
  ringing = false;
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
}
