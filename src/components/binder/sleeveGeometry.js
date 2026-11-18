const PI = Math.PI;
const clamp = value => Math.max(0, Math.min(1, value));

/**
 * Dimensionless displacement of thin, tensioned pocket film. The three welded
 * edges remain on the sheet while the upper opening can lift. Callers scale
 * this bounded field by the stack's existing bulge/lip clearance budget.
 *
 * The seed shifts broad stress fields instead of adding high-frequency noise;
 * individual pockets differ without looking crumpled at a 16 x 18 resolution.
 */
export function sampleSleeveHeight(u, v, seed = 0, lip = false) {
  const x = clamp(u);
  const y = clamp(v);
  if (x === 0 || x === 1 || (!lip && y === 0)) return 0;
  const across = Math.sin(PI * x);
  const phase = seed * 2.399963229728653 + 0.7;

  if (lip) {
    // A narrow turned-over lip rises then gently rolls down at its free edge.
    // Its attached edge starts at approximately the height of the main film.
    const curl = 0.18 + 0.64 * Math.sin(PI * y * 0.5) + 0.18 * Math.sin(PI * y);
    const unevenness = 0.88 + 0.12 * Math.sin(PI * x + phase);
    return across * curl * unevenness;
  }

  const along = Math.sin(PI * y);
  const bow = along * (0.86 + 0.14 * Math.sin(2.2 * x + 1.4 * y + phase));
  const opening = y ** 4 * (0.8 + 0.2 * Math.sin(3 * x + phase));
  const tension = along * (1 - across)
    * (0.5 + 0.5 * Math.sin(PI * (3 * y + 0.7 * x) + phase));
  // Each component is in [0, 1]; the weights sum to one. No wrinkle can
  // exceed the physical allowance or sink below the underlying card surface.
  return across * (0.66 * bow + 0.24 * opening + 0.1 * tension);
}
