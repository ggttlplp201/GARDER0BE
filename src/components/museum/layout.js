// Preserve the corridor's proportions and scroll distances: 200 CSS px = 1 m.
export const WORLD_SCALE = 1 / 200;
export const PERSPECTIVE = 900;

export function getLayout(width) {
  const mobile = width < 640;
  const wallX = mobile ? Math.max(110, Math.floor(width * 0.37)) : 380;
  const frameW = mobile ? 110 : 200;
  const cameraStart = Math.max(mobile ? 200 : 430,
    Math.ceil(PERSPECTIVE * (1 - (wallX * 2 - 30) / width)));
  return {
    mobile,
    wallX: wallX * WORLD_SCALE,
    floorY: -(mobile ? 160 : 280) * WORLD_SCALE,
    ceilY: (mobile ? 200 : 360) * WORLD_SCALE,
    frameCY: (mobile ? 20 : 40) * WORLD_SCALE,
    frameW: frameW * WORLD_SCALE,
    frameH: (mobile ? 160 : 290) * WORLD_SCALE,
    frontGap: (mobile ? 360 : 380) * WORLD_SCALE,
    rowSpacing: (mobile ? 300 : 460) * WORLD_SCALE,
    stagger: (mobile ? 150 : 230) * WORLD_SCALE,
    cameraStart: cameraStart * WORLD_SCALE,
    cullBehind: Math.min(PERSPECTIVE + frameW / 2 - (2 * wallX * PERSPECTIVE) / width + 150, PERSPECTIVE - 80) * WORLD_SCALE,
  };
}

export function getPlacements(items, layout) {
  return items.map((item, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const depth = layout.frontGap + Math.floor(index / 2) * layout.rowSpacing + (side === 1 ? layout.stagger : 0);
    return { item, side, depth, idx: index };
  });
}

export function getRoomDepth(itemCount, layout) {
  const pairCount = Math.max(1, Math.ceil(itemCount / 2));
  return layout.frontGap + (pairCount - 1) * layout.rowSpacing + layout.stagger + 700 * WORLD_SCALE;
}
