import { useRef, useState, useCallback, useEffect } from 'react';
import { maybeConvertHeic, removeBg, autoTagWithClaude, applyTags } from '../lib/imageUtils';

export default function ImageUploadZone({ pending, onChange, fields, onTagApply, isFirstUpload }) {
  const [dzState, setDzState] = useState('');
  const [dzMsg, setDzMsg]     = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [aiClass, setAiClass]   = useState('');
  const inputRef = useRef(null);

  const setDropzone = useCallback((state, msg = '') => {
    setDzState(state);
    setDzMsg(msg);
  }, []);

  async function processFiles(rawFiles) {
    if (!rawFiles.length) return;
    const shouldTag = isFirstUpload && !fields.name;
    setDropzone('processing');
    const newItems = [];
    for (const raw of rawFiles) {
      const file = await maybeConvertHeic(raw);
      const blob = await removeBg(file, raw.name);
      if (shouldTag && raw === rawFiles[0]) {
        setAiStatus('AI ANALYZING...'); setAiClass('analyzing');
        autoTagWithClaude(blob)
          .then(tags => {
            const patches = applyTags(tags, fields);
            onTagApply(patches);
            setAiStatus('AI TAGGED ✓'); setAiClass('done');
            setTimeout(() => { setAiStatus(''); setAiClass(''); }, 3000);
          })
          .catch(err => { setAiStatus('ERR: ' + err.message); setAiClass('analyzing'); });
      }
      newItems.push({ src: URL.createObjectURL(blob), blob, url: null });
    }
    onChange([...pending, ...newItems]);
    const n = rawFiles.length;
    setDropzone('done', `${n} PHOTO${n > 1 ? 'S' : ''} ADDED`);
  }

  function handleChange(e) {
    const files = Array.from(e.target.files);
    if (inputRef.current) inputRef.current.value = '';
    processFiles(files);
  }

  function handleDragOver(e) { e.preventDefault(); setDropzone('drag-over'); }
  function handleDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) setDropzone('', ''); }
  function handleDrop(e) {
    e.preventDefault(); setDropzone('', '');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) processFiles(files);
  }

  useEffect(() => {
    return () => {
      pending.forEach(item => { if (item.src?.startsWith('blob:')) URL.revokeObjectURL(item.src); });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function removeItem(idx) {
    const item = pending[idx];
    if (item?.src?.startsWith('blob:')) URL.revokeObjectURL(item.src);
    onChange(pending.filter((_, i) => i !== idx));
  }
  function moveItem(idx, dir) {
    const n = idx + dir;
    if (n < 0 || n >= pending.length) return;
    const next = [...pending];
    [next[idx], next[n]] = [next[n], next[idx]];
    onChange(next);
  }

  const mainText = dzState === 'drag-over' ? 'RELEASE TO UPLOAD'
                 : dzState === 'processing' ? 'PROCESSING...'
                 : 'DRAG & DROP OR CLICK TO UPLOAD';

  return (
    <div className="field">
      <label>Photos <span className={`ai-tag-status${aiClass ? ' ' + aiClass : ''}`}>{aiStatus}</span></label>
      <div
        className={`img-dropzone${dzState ? ' ' + dzState : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={handleChange} style={{ display: 'none' }} />
        <div className="img-dropzone-icon">↑</div>
        <div className="img-dropzone-main">{mainText}</div>
        <div className="img-dropzone-hint">JPG · PNG · HEIC</div>
        {dzMsg && <div className="img-dropzone-status">{dzMsg}</div>}
      </div>

      {pending.length > 0 && (
        <div className="img-gallery">
          {pending.map((item, idx) => (
            <div key={idx} className="img-thumb">
              <img src={item.src} alt="" />
              <button className="img-thumb-x" onClick={() => removeItem(idx)}>×</button>
              {pending.length > 1 && <>
                <button
                  className="img-thumb-move img-thumb-ml"
                  onClick={() => moveItem(idx, -1)}
                  style={idx === 0 ? { opacity: 0.3, pointerEvents: 'none' } : {}}
                >‹</button>
                <button
                  className="img-thumb-move img-thumb-mr"
                  onClick={() => moveItem(idx, 1)}
                  style={idx === pending.length - 1 ? { opacity: 0.3, pointerEvents: 'none' } : {}}
                >›</button>
              </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
