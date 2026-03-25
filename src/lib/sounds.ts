// 8-bit sound effects using Web Audio API
// No external files needed — all sounds are synthesized

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Play a short tone sequence */
function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "square",
  volume = 0.15,
) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

/** Task complete — cheerful ascending arpeggio */
export function playTaskComplete() {
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.15, "square", 0.12);
    }, i * 80);
  });
}

/** Approval needed — alert double-beep */
export function playApprovalNeeded() {
  playTone(880, 0.1, "square", 0.15);
  setTimeout(() => playTone(880, 0.1, "square", 0.15), 150);
}

/** Agent stuck — descending warning */
export function playAgentStuck() {
  playTone(440, 0.15, "sawtooth", 0.1);
  setTimeout(() => playTone(330, 0.2, "sawtooth", 0.1), 180);
}

/** Orchestration complete — victory fanfare */
export function playOrchestrationComplete() {
  const notes = [523, 659, 784, 1047, 1319]; // C5 E5 G5 C6 E6
  notes.forEach((freq, i) => {
    setTimeout(() => {
      playTone(freq, 0.2, "square", 0.1);
    }, i * 100);
  });
}

/** Orchestration had failures — somber tone */
export function playOrchestrationWarning() {
  playTone(392, 0.2, "triangle", 0.12);
  setTimeout(() => playTone(330, 0.3, "triangle", 0.12), 220);
}

/** Generic notification pop */
export function playNotificationPop() {
  playTone(1200, 0.06, "square", 0.08);
}

import { getSetting, setSetting } from "./settings";

// ─── In-memory cache for sync reads ────────────────────────────
// Sound/notification checks happen in synchronous event handlers,
// so we cache the values and refresh them async.

let _soundsEnabled = true;
let _desktopNotifsEnabled = true;

/** Load cached values from SQLite (call once at startup). */
export async function initSoundSettings(): Promise<void> {
  const [s, n] = await Promise.all([
    getSetting("outworked_sounds"),
    getSetting("outworked_desktop_notifs"),
  ]);
  _soundsEnabled = s !== "0";
  _desktopNotifsEnabled = n !== "0";
}

/** Check if sounds are enabled (user preference) — sync, uses cache */
export function getSoundsEnabled(): boolean {
  return _soundsEnabled;
}

export function setSoundsEnabled(enabled: boolean) {
  _soundsEnabled = enabled;
  setSetting("outworked_sounds", enabled ? "1" : "0");
}

/** Check if desktop notifications are enabled — sync, uses cache */
export function getDesktopNotificationsEnabled(): boolean {
  return _desktopNotifsEnabled;
}

export function setDesktopNotificationsEnabled(enabled: boolean) {
  _desktopNotifsEnabled = enabled;
  setSetting("outworked_desktop_notifs", enabled ? "1" : "0");
}
