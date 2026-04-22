export const gyroState = { x: 0, y: 0 };
export const gyroCallbacks = new Set();
let gyroActive = false;
let baseline = null;

export function isGyroActive() { return gyroActive; }

function startGyro() {
  if (gyroActive) return;
  gyroActive = true;
  window.addEventListener('deviceorientation', e => {
    if (e.beta === null && e.gamma === null) return;
    if (!baseline) baseline = { beta: e.beta || 0, gamma: e.gamma || 0 };
    gyroState.x = Math.max(-1, Math.min(1, ((e.gamma || 0) - baseline.gamma) / 20));
    gyroState.y = Math.max(-1, Math.min(1, ((e.beta  || 0) - baseline.beta)  / 20));
    gyroCallbacks.forEach(fn => fn());
  }, { passive: true });
}

// Returns 'active' | 'denied' | 'unsupported'
export async function enableGyro() {
  if (gyroActive) return 'active';
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return 'unsupported';
  if (typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission();
      if (res === 'granted') { startGyro(); return 'active'; }
      return 'denied';
    } catch { return 'denied'; }
  }
  startGyro();
  return 'active';
}
