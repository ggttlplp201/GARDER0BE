export const gyroState = { x: 0, y: 0 };
export const gyroCallbacks = new Set();
let gyroActive = false;
let gyroRequested = false;

export function isGyroActive() { return gyroActive; }

function startGyro() {
  if (gyroActive) return;
  gyroActive = true;
  window.addEventListener('deviceorientation', e => {
    gyroState.x = (e.gamma || 0) / 30;
    gyroState.y = ((e.beta  || 0) - 70) / 40;
    gyroCallbacks.forEach(fn => fn());
  }, { passive: true });
}

export async function enableGyro() {
  if (gyroRequested) return;
  gyroRequested = true;
  if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') startGyro();
      else gyroRequested = false;
    } catch { gyroRequested = false; }
  } else if ('DeviceOrientationEvent' in window) {
    startGyro();
  }
}
