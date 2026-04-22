export const gyroState = { x: 0, y: 0 };
export const gyroCallbacks = new Set();
let gyroActive = false;
let permissionPending = false;
let baseline = null;

export function isGyroActive() { return gyroActive; }

function startGyro() {
  if (gyroActive) return;
  gyroActive = true;
  console.log('[gyro] started, callbacks registered:', gyroCallbacks.size);
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

// Must be called SYNCHRONOUSLY from a user gesture handler (not from async/await).
// Handles iOS requestPermission and non-iOS directly.
export function requestGyroPermission() {
  if (gyroActive || permissionPending) return;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  console.log('[gyro] requesting permission, hasRequestPermission:', typeof DOE.requestPermission);
  if (typeof DOE.requestPermission === 'function') {
    permissionPending = true;
    DOE.requestPermission()
      .then(res => {
        console.log('[gyro] permission result:', res);
        permissionPending = false;
        if (res === 'granted') startGyro();
      })
      .catch(err => {
        console.log('[gyro] permission error:', err);
        permissionPending = false;
      });
  } else {
    startGyro();
  }
}
