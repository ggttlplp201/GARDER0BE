import { useRef } from 'react';
import { QUOTES } from '../lib/constants';

const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];

export default function MusicPlayer({ track, trackIdx, playing, progress, timeCur, timeDur, onToggle, onNext, onPrev, onVolume, onSeek }) {
  const discRef  = useRef(null);
  const shineRef = useRef(null);
  const wrapRef  = useRef(null);

  function handleDiscMove(e) {
    const wrap = wrapRef.current; if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    wrap.style.transform = `perspective(300px) rotateY(${x*20}deg) rotateX(${-y*20}deg) scale(1.08)`;
    if (shineRef.current) {
      shineRef.current.style.opacity = '1';
      shineRef.current.style.background = `radial-gradient(ellipse at ${50+x*80}% ${50+y*80}%, rgba(255,255,255,0.35) 0%, transparent 65%)`;
    }
  }
  function handleDiscLeave() {
    if (wrapRef.current) wrapRef.current.style.transform = '';
    if (shineRef.current) shineRef.current.style.opacity = '0';
  }

  function handleSeekClick(e) {
    const bg = e.currentTarget;
    const r  = bg.getBoundingClientRect();
    onSeek((e.clientX - r.left) / r.width);
  }

  return (
    <div className="player-col">
      <div className="player" id="compact-player">
        <div
          ref={wrapRef}
          className="disc-wrap"
          onMouseMove={handleDiscMove}
          onMouseLeave={handleDiscLeave}
        >
          <div ref={discRef} className={`disc${playing ? ' playing' : ''}`} />
          <div ref={shineRef} className="disc-shine" />
        </div>
        <div className="track-info">
          <div className="track-name">{track.name}</div>
          <div className="track-sub">Track {trackIdx + 1} / 3</div>
          <div className="track-meta">{track.key} · {track.bpm} BPM</div>
        </div>
        <div className="controls">
          <button className="ctrl-btn" onClick={onPrev} title="Previous">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <polygon points="12,0 4,6 12,12"/><rect x="0" y="0" width="3" height="12"/>
            </svg>
          </button>
          <button className="ctrl-btn" onClick={onToggle} title="Play/Pause">
            {playing
              ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="0" width="4" height="12"/><rect x="7" y="0" width="4" height="12"/></svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,0 12,6 2,12"/></svg>
            }
          </button>
          <button className="ctrl-btn" onClick={onNext} title="Next">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <polygon points="0,0 8,6 0,12"/><rect x="9" y="0" width="3" height="12"/>
            </svg>
          </button>
        </div>
        <div className="progress-wrap">
          <div className="progress-bar-bg" onClick={handleSeekClick}>
            <div className="progress-bar-fill" style={{ width: progress + '%' }} />
          </div>
          <div className="time-row">
            <span>{timeCur}</span>
            <span>{timeDur}</span>
          </div>
        </div>
        <div className="volume-wrap">
          <input
            type="range" className="vol-slider"
            min="0" max="1" step="0.01" defaultValue="0.8"
            onChange={e => onVolume(e.target.value)}
          />
        </div>
      </div>
      <div className="player-quote">"{quote.text}" — {quote.author}</div>
    </div>
  );
}
