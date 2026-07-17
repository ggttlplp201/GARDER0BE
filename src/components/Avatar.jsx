import { frameOf } from '../lib/cosmetics';

// Shared avatar with an equipped cosmetic frame overlay. `frame` is a cosmetic id;
// null/unknown falls back to the free default frame (thin_line).
export default function Avatar({ url, size = 60, frame }) {
  const f = frameOf(frame);
  return (
    <div className="cos-avatar" style={{ width: size, height: size }}>
      {url
        ? <img src={url} alt="" className="cos-avatar-img" />
        : <div className="cos-avatar-ph">
            <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg>
          </div>}
      <span className="cos-frame" dangerouslySetInnerHTML={{ __html: f.renderFrame(size) }} />
    </div>
  );
}
