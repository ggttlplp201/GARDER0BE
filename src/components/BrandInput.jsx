import { useState, useRef, useEffect } from 'react';
import { BRANDS } from '../lib/brands';

export default function BrandInput({ value, onChange }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState(value || '');
  const wrapRef = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    function handleClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const matches = query.length < 1 ? [] : BRANDS.filter(b =>
    b.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 8);

  function select(brand) {
    setQuery(brand);
    onChange(brand);
    setOpen(false);
  }

  function handleChange(e) {
    setQuery(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  }

  return (
    <div className="brand-input-wrap" ref={wrapRef}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => query.length >= 1 && setOpen(true)}
        placeholder="e.g. Acne Studios"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="brand-dropdown">
          {matches.map(b => (
            <div key={b} className="brand-option" onMouseDown={() => select(b)}>{b}</div>
          ))}
        </div>
      )}
    </div>
  );
}
