import { parseImageUrls } from '../lib/imageUtils';

export default function WishlistView({ items, onItemClick, onAdd }) {
  const wishlist = items.filter(i => i.status === 'wishlist');

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">WISHLIST</div>
          <div className="v-screen-sub">{String(wishlist.length).padStart(2, '0')} ITEMS · TRACKING PRICE</div>
        </div>
        <button className="toolbar-add" style={{ alignSelf: 'flex-end' }} onClick={onAdd}>+ TRACK NEW</button>
      </div>

      <div className="v-body">
        <div style={{ padding: '0 36px 24px' }}>
          {wishlist.length === 0 && (
            <div className="v-empty">
              No wishlist items yet. Add an item and set its status to "wishlist".
            </div>
          )}

          {wishlist.length > 0 && (
            <>
              <div className="wish-header">
                <div>№</div>
                <div></div>
                <div>BRAND · ITEM</div>
                <div>TREND · 12WK</div>
                <div style={{ textAlign: 'right' }}>CURRENT</div>
                <div style={{ textAlign: 'right' }}>Δ%</div>
                <div style={{ textAlign: 'right' }}>ACTION</div>
              </div>
              {wishlist.map((it, i) => {
                const imgs = parseImageUrls(it.image_url);
                const price = parseFloat(it.price) || 0;
                return (
                  <div key={it.id} className="wish-row">
                    <div className="mono-dim" style={{ fontSize: 10 }}>W.{String(i + 1).padStart(2, '0')}</div>
                    <div className="timeline-thumb">
                      {imgs.length > 0
                        ? <img src={imgs[0]} alt={it.name} />
                        : <div className="timeline-thumb-placeholder">{(it.brand || '').split(' ')[0]?.slice(0, 3) || '—'}</div>
                      }
                    </div>
                    <div>
                      <div className="mono-dim" style={{ fontSize: 9, letterSpacing: '0.12em' }}>{(it.brand || '—').toUpperCase()}</div>
                      <div className="timeline-item-name">{it.name || 'Untitled'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ height: 1, width: '100%', background: 'var(--border-light)' }} />
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="wish-current">{price ? `$${price.toLocaleString()}` : 'N/A'}</div>
                    </div>
                    <div className="mono-dim" style={{ fontSize: 10, textAlign: 'right' }}>—</div>
                    <div style={{ textAlign: 'right' }}>
                      <button className="mode-btn" style={{ border: '1px solid var(--border)', padding: '7px 14px' }} onClick={() => onItemClick(it)}>VIEW →</button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
