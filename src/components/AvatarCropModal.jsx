import { useState, useRef, useEffect, useCallback } from 'react';

const SIZE = 280; // viewport px

export default function AvatarCropModal({ file, onConfirm, onCancel }) {
  const [zoom, setZoom]     = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [srcUrl, setSrcUrl] = useState(null);
  const imgRef    = useRef(null);
  const dragging  = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrcUrl(url);
    const img = new Image();
    img.onload = () => {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      const fit = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
      setZoom(fit);
      setOffset({ x: (SIZE - img.naturalWidth  * fit) / 2,
                  y: (SIZE - img.naturalHeight * fit) / 2 });
    };
    img.src = url;
    imgRef.current = img;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const clampOffset = useCallback((ox, oy, z) => {
    const dw = imgSize.w * z;
    const dh = imgSize.h * z;
    return {
      x: Math.min(0, Math.max(SIZE - dw, ox)),
      y: Math.min(0, Math.max(SIZE - dh, oy)),
    };
  }, [imgSize]);

  function onZoomChange(e) {
    const z = parseFloat(e.target.value);
    // re-center around viewport center when zooming
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const imgX = (cx - offset.x) / zoom;
    const imgY = (cy - offset.y) / zoom;
    const newOx = cx - imgX * z;
    const newOy = cy - imgY * z;
    setZoom(z);
    setOffset(clampOffset(newOx, newOy, z));
  }

  function startDrag(mx, my) {
    dragging.current = true;
    dragStart.current = { mx, my, ox: offset.x, oy: offset.y };
  }
  function moveDrag(mx, my) {
    if (!dragging.current) return;
    const dx = mx - dragStart.current.mx;
    const dy = my - dragStart.current.my;
    setOffset(clampOffset(dragStart.current.ox + dx, dragStart.current.oy + dy, zoom));
  }
  function endDrag() { dragging.current = false; }

  function confirm() {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 400;
    const ctx = canvas.getContext('2d');
    // circle clip
    ctx.beginPath();
    ctx.arc(200, 200, 200, 0, Math.PI * 2);
    ctx.clip();
    const cropX = -offset.x / zoom;
    const cropY = -offset.y / zoom;
    const cropS = SIZE / zoom;
    ctx.drawImage(imgRef.current, cropX, cropY, cropS, cropS, 0, 0, 400, 400);
    canvas.toBlob(blob => onConfirm(blob), 'image/jpeg', 0.92);
  }

  const minZoom = imgSize.w && imgSize.h
    ? Math.max(SIZE / imgSize.w, SIZE / imgSize.h)
    : 1;

  return (
    <div className="modal-bg open" role="dialog" aria-modal="true" aria-label="Adjust profile photo">
      <div className="modal avatar-crop-modal">
        <h2>ADJUST PHOTO</h2>
        <div
          className="avatar-crop-viewport"
          style={{ width: SIZE, height: SIZE }}
          onMouseDown={e => startDrag(e.clientX, e.clientY)}
          onMouseMove={e => moveDrag(e.clientX, e.clientY)}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={e => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={e => { e.preventDefault(); moveDrag(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchEnd={endDrag}
        >
          {srcUrl && (
            <img
              src={srcUrl}
              alt=""
              style={{
                position: 'absolute',
                width:  imgSize.w * zoom,
                height: imgSize.h * zoom,
                left:   offset.x,
                top:    offset.y,
                userSelect: 'none',
                pointerEvents: 'none',
                draggable: false,
              }}
            />
          )}
          <div className="avatar-crop-ring" />
        </div>
        <div className="avatar-crop-zoom-row">
          <span>−</span>
          <input
            type="range"
            min={minZoom}
            max={minZoom * 4}
            step={0.001}
            value={zoom}
            onChange={onZoomChange}
          />
          <span>+</span>
        </div>
        <p className="avatar-crop-hint">Drag to reposition</p>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>CANCEL</button>
          <button className="btn-add" onClick={confirm}>USE PHOTO</button>
        </div>
      </div>
    </div>
  );
}
