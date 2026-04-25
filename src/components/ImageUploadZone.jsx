import { useRef, useState, useCallback, useEffect } from 'react';
import { maybeConvertHeic, removeBg, autoTagWithClaude, applyTags } from '../lib/imageUtils';

export default function ImageUploadZone({ pending, onChange, onTagApply, isFirstUpload }) {
  const [dzState, setDzState] = useState('');
  const [dzMsg, setDzMsg]     = useState('');
  const [tagging, setTagging] = useState(false);
  const inputRef = useRef(null);

  const setDropzone = useCallback((state, msg = '') => {
    setDzState(state);
    setDzMsg(msg);
  }, []);

  async function processFiles(rawFiles) {
    if (!rawFiles.length) return;
    setDropzone('processing');
    const newItems = [];
    let firstBlob = null;
    for (const raw of rawFiles) {
      const file = await maybeConvertHeic(raw);
      let blob;
      try {
        blob = await removeBg(file);
      } catch (e) {
        blob = file;
        setDzMsg(`BG ERR: ${e.message?.slice(0, 60)}`);
      }
      if (!firstBlob) firstBlob = { blob, originalFile: raw };
      newItems.push({ src: URL.createObjectURL(blob), blob, url: null });
    }
    onChange([...pending, ...newItems]);
    const n = rawFiles.length;
    setDropzone('done', `${n} PHOTO${n > 1 ? 'S' : ''} ADDED`);

    setDzMsg(`cb=${!!onTagApply} 1st=${isFirstUpload} blob=${!!firstBlob}`);

    // AI tag only on first-ever upload and only if callback provided
    if (onTagApply && isFirstUpload && firstBlob) {
      setTagging(true);
      try {
        const tags    = await autoTagWithClaude(firstBlob.blob);
        const patches = applyTags(tags, {});
        if (Object.keys(patches).length) { onTagApply(patches); setDzMsg('AI TAGGED ✓'); }
        else setDzMsg('AI: no tags returned');
      } catch (e) { setDzMsg(`AI ERR: ${e.message?.slice(0, 60)}`); }
      finally { setTagging(false); }
    }
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
                 : tagging            ? 'AI TAGGING…'
                 : dzState === 'processing' ? 'PROCESSING...'
                 : 'DRAG & DROP OR CLICK TO UPLOAD';

  return (
    <div className="field">
      <label>Photos</label>
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
