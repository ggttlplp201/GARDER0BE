import { parseImageUrls } from '../lib/imageUtils';

const MONTH_NAMES = { '01':'JAN','02':'FEB','03':'MAR','04':'APR','05':'MAY','06':'JUN','07':'JUL','08':'AUG','09':'SEP','10':'OCT','11':'NOV','12':'DEC' };

function catNum(idx) { return String(idx + 1).padStart(3, '0'); }

export default function TimelineView({ items, onItemClick }) {
  const by = {};
  items.forEach(it => {
    const d = new Date(it.created_at);
    const key = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    (by[key] = by[key] || []).push(it);
  });
  const months = Object.keys(by).sort().reverse();

  const earliest = items.length ? new Date(Math.min(...items.map(i => new Date(i.created_at)))).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '.') : '—';
  const latest   = items.length ? new Date(Math.max(...items.map(i => new Date(i.created_at)))).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '.') : '—';

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">ACQUISITIONS</div>
          <div className="v-screen-sub">{items.length} ENTRIES · EARLIEST {earliest} · LATEST {latest}</div>
        </div>
        <div className="v-header-action" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', alignSelf: 'flex-end' }}>SORT / DESC ↓</div>
      </div>

      <div className="v-body">
        <div style={{ padding: '0 36px 24px' }}>
          {months.length === 0 && <div className="v-empty">No items yet.</div>}
          {months.map((m, mi) => {
            const [yr, mo] = m.split('.');
            const mItems = by[m].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const total = mItems.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
            return (
              <div key={m} style={{ marginTop: mi === 0 ? 16 : 40 }}>
                <div className="timeline-month-header">
                  <div className="timeline-month-name">{MONTH_NAMES[mo]}</div>
                  <div style={{ flex: 1 }} />
                  <div className="timeline-month-meta" style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>
                    {yr} · {mItems.length} ENTR{mItems.length === 1 ? 'Y' : 'IES'} · ${Math.round(total).toLocaleString()} ↓
                  </div>
                </div>
                <div>
                  {mItems.map(it => {
                    const gi = items.findIndex(i => i.id === it.id);
                    const imgs = parseImageUrls(it.image_url);
                    const d = new Date(it.created_at);
                    const dateStr = `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}.${String(d.getFullYear()).slice(-2)}`;
                    return (
                      <div key={it.id} className="timeline-row" onClick={() => onItemClick(it)}>
                        <div className="mono-dim" style={{ fontSize: 11 }}>{dateStr}</div>
                        <div className="timeline-thumb">
                          {imgs.length > 0
                            ? <img src={imgs[0]} alt={it.name} />
                            : <div className="timeline-thumb-placeholder"><span>{(it.brand || '').split(' ')[0]?.slice(0, 3).toUpperCase() || '—'}</span></div>
                          }
                        </div>
                        <div>
                          <div className="mono-dim" style={{ fontSize: 9, letterSpacing: '0.12em' }}>
                            № {catNum(gi)} · {(it.brand || '—').toUpperCase()}
                          </div>
                          <div className="timeline-item-name">{it.name || 'Untitled'}</div>
                        </div>
                        <div className="mono-dim" style={{ fontSize: 11 }}>{it.condition || '—'}</div>
                        <div className="list-meta">{it.type || '—'}</div>
                        <div className="timeline-price">{parseFloat(it.price) ? `$${parseFloat(it.price).toLocaleString()}` : 'N/A'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
