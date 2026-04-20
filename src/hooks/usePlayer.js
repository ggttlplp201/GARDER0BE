import { useState, useEffect, useRef } from 'react';
import { TRACKS } from '../lib/constants';

export function usePlayer() {
  const audioRef      = useRef(new Audio());
  const [trackIdx, setTrackIdx]   = useState(0);
  const [playing, setPlaying]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const [timeCur, setTimeCur]     = useState('0:00');
  const [timeDur, setTimeDur]     = useState('0:00');

  function fmt(s) {
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }

  useEffect(() => {
    const audio = audioRef.current;
    audio.volume = 0.8;
    audio.src = TRACKS[0].file;

    const onTimeUpdate = () => {
      if (!audio.duration) return;
      setProgress((audio.currentTime / audio.duration) * 100);
      setTimeCur(fmt(audio.currentTime));
      setTimeDur(fmt(audio.duration));
    };
    const onEnded = () => loadTrack((trackIdx + 1) % TRACKS.length);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  function loadTrack(idx) {
    const audio = audioRef.current;
    setTrackIdx(idx);
    audio.src = TRACKS[idx].file;
    setProgress(0); setTimeCur('0:00'); setTimeDur('0:00');
    if (playing) audio.play();
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().catch(() => {}); setPlaying(true); }
  }

  function nextTrack() { loadTrack((trackIdx + 1) % TRACKS.length); }
  function prevTrack() { loadTrack((trackIdx - 1 + TRACKS.length) % TRACKS.length); }

  function setVolume(v) { audioRef.current.volume = v; }

  function seekTo(pct) {
    const audio = audioRef.current;
    if (audio.duration) audio.currentTime = pct * audio.duration;
  }

  return { track: TRACKS[trackIdx], trackIdx, playing, progress, timeCur, timeDur,
           togglePlay, nextTrack, prevTrack, setVolume, seekTo };
}
