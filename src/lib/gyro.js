export const gyroState = { x: 0, y: 0 };
export const gyroCallbacks = new Set();
let gyroActive = false;
let baseline = null;

export function isGyroActive() { return gyroActive; }

function startGyro() {
  if (gyroActive) return;
  gyroActive = true;
  console.log('[gyro] startGyro: registering deviceorientation listener');
  window.addEventListener('deviceorientation', e => {
    console.log('[gyro] event', e.beta, e.gamma, 'callbacks:', gyroCallbacks.size);
    if (e.beta === null && e.gamma === null) return;
    if (!baseline) {
      baseline = { beta: e.beta || 0, gamma: e.gamma || 0 };
      console.log('[gyro] baseline set', baseline);
    }
    gyroState.x = Math.max(-1, Math.min(1, ((e.gamma || 0) - baseline.gamma) / 20));
    gyroState.y = Math.max(-1, Math.min(1, ((e.beta  || 0) - baseline.beta)  / 20));
    gyroCallbacks.forEach(fn => fn());
  }, { passive: true });
}

// Returns 'active' | 'denied' | 'unsupported'
export async function enableGyro() {
  if (gyroActive) return 'active';
  const DOE = window.DeviceOrientationEvent;
  console.log('[gyro] enableGyro called, DOE:', !!DOE, 'hasRequestPermission:', typeof DOE?.requestPermission);
  if (!DOE) return 'unsupported';
  if (typeof DOE.requestPermission === 'function') {
    try {
      console.log('[gyro] requesting iOS permission...');
      const res = await DOE.requestPermission();
      console.log('[gyro] permission result:', res);
      if (res === 'granted') { startGyro(); return 'active'; }
      return 'denied';
    } catch (err) {
      console.log('[gyro] permission error:', err);
      return 'denied';
    }
  }
  startGyro();
  return 'active';
}
