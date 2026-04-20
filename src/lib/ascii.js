const ACHARS = '.,-~:;=!*#$@';

const LETTER_PATTERNS = {
  G:[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  A:[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  R:[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  D:[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  E:[[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  O:[[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  B:[[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
};

function getLetter(ch) {
  return LETTER_PATTERNS[ch] || Array.from({ length: 7 }, () => [0, 0, 0, 0, 0]);
}

let _angle = 0;

export function renderAsciiTitle() {
  const W = 280, H = 50;
  const zBuf = new Float32Array(W * H);
  const cBuf = new Uint8Array(W * H).fill(255);
  const A = _angle;
  _angle += 0.04;
  const cosA = Math.cos(A), sinA = Math.sin(A);
  const text = 'GARDEROBE';
  for (let i = 0; i < text.length; i++) {
    const pat = getLetter(text[i]);
    const ox = (i - text.length / 2) * 8 + 2;
    for (let py = 0; py < pat.length; py++) {
      for (let px = 0; px < pat[py].length; px++) {
        if (!pat[py][px]) continue;
        for (let pz = -2; pz <= 2; pz++) {
          const rx = (px + ox) * cosA - pz * sinA;
          const rz = (px + ox) * sinA + pz * cosA + 100;
          if (rz <= 0) continue;
          const sc = 320 / rz;
          const x2 = Math.floor(W / 2 + rx * sc);
          const y2 = Math.floor(H / 2 + (py - pat.length / 2) * sc);
          if (x2 >= 0 && x2 < W && y2 >= 0 && y2 < H) {
            const idx = x2 + y2 * W;
            if (rz > zBuf[idx]) {
              zBuf[idx] = rz;
              const light = cosA * 0.5 + sinA * 0.5 + 0.5;
              cBuf[idx] = Math.max(0, Math.min(ACHARS.length - 1, Math.floor(light * (ACHARS.length - 1))));
            }
          }
        }
      }
    }
  }
  let out = '';
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) { const v = cBuf[c + r * W]; out += v < 255 ? ACHARS[v] : ' '; }
    out += '\n';
  }
  return out;
}

export function resetAsciiAngle() { _angle = 0; }

// Scatter card frame
const SC_FW = 26, SC_FH = 21;
export const SC_PERIM_LEN = (SC_FW + SC_FH) * 2 - 4;

export function buildScatterFrame(offset) {
  const path = [];
  for (let c = 0; c < SC_FW; c++) path.push([0, c]);
  for (let r = 1; r < SC_FH; r++) path.push([r, SC_FW - 1]);
  for (let c = SC_FW - 2; c >= 0; c--) path.push([SC_FH - 1, c]);
  for (let r = SC_FH - 2; r >= 1; r--) path.push([r, 0]);
  const grid = Array.from({ length: SC_FH }, () => Array(SC_FW).fill(' '));
  for (const [r, c] of path) grid[r][c] = '·';
  grid[0][0] = '+'; grid[0][SC_FW - 1] = '+';
  grid[SC_FH - 1][0] = '+'; grid[SC_FH - 1][SC_FW - 1] = '+';
  const wave = ['·', '·', '-', '+', '*', '◆', '#', '◆', '*', '+', '-', '·', '·'];
  wave.forEach((ch, i) => {
    const [r, c] = path[(offset + i) % path.length];
    grid[r][c] = ch;
  });
  return grid.map(row => row.join('')).join('\n');
}
