import { useEffect, useState, useCallback } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { sb } from '../lib/supabase';

// Derive per-item tracking summary from raw source + history data
function deriveTracking(sources) {
  if (!sources || sources.length === 0) return null;

  const active = sources.filter(s => s.is_active !== false);
  if (!active.length) return null;

  // Best (lowest) current price across all active sources
  const withPrice = active.filter(s => s.last_price != null);
  const bestSource = withPrice.reduce((b, s) => (!b || s.last_price < b.last_price) ? s : b, null);
  const latestPrice = bestSource?.last_price ?? null;

  // Last checked — most recent last_seen_at
  const lastChecked = active
    .map(s => s.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  // Delta — use price history: latest vs second-to-latest observation across all sources
  const allHistory = active
    .flatMap(s => (s.wishlist_price_history || []).map(h => ({ price: h.observed_price, at: h.observed_at })))
    .filter(h => h.price != null)
    .sort((a, b) => b.at.localeCompare(a.at));

  let deltaAmt = null, deltaPct = null;
  if (allHistory.length >= 2) {
    const latest   = allHistory[0].price;
    const previous = allHistory[1].price;
    deltaAmt = latest - previous;
    deltaPct = previous !== 0 ? ((latest - previous) / previous) * 100 : null;
  } else if (allHistory.length === 1) {
    deltaAmt = 0;
    deltaPct = 0;
  }

  return {
    latestPrice,
    deltaAmt,
    deltaPct,
    lastChecked,
    sourceCount: active.length,
    bestSourceName: bestSource?.source_name ?? null,
  };
}

function formatChecked(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffH = Math.round((now - d) / 3_600_000);
  if (diffH < 1) return 'JUST NOW';
  if (diffH < 24) return `${diffH}H AGO`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}D AGO`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.');
}

function DeltaBadge({ amt, pct }) {
  if (amt == null) return <span className="mono-dim" style={{ fontSize: 9 }}>—</span>;
  const up    = amt > 0;
  const zero  = amt === 0;
  const color = zero ? 'var(--text2)' : up ? '#c0392b' : '#27ae60';
  const sign  = up ? '+' : '';
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color }}>
      {sign}{pct != null ? `${pct.toFixed(1)}%` : ''} ({sign}${Math.abs(amt).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })})
    </span>
  );
}

export default function WishlistView({ items, onItemClick, onAdd }) {
  const wishlist = items.filter(i => i.status === 'wishlist');
  const [tracking, setTracking] = useState({}); // itemId → derived tracking object
  const [loading, setLoading] = useState(false);

  const fetchTracking = useCallback(async () => {
    if (!wishlist.length) return;
    setLoading(true);
    const ids = wishlist.map(i => i.id);

    // Fetch sources with last 2 history rows each (for delta)
    const { data } = await sb
      .from('wishlist_price_sources')
      .select('id, item_id, source_name, last_price, last_seen_at, is_active, wishlist_price_history(observed_price, observed_at)')
      .in('item_id', ids)
      .eq('is_active', true)
      .order('observed_at', { referencedTable: 'wishlist_price_history', ascending: false })
      .limit(12, { referencedTable: 'wishlist_price_history' });

    if (data) {
      // Group by item_id
      const grouped = {};
      for (const row of data) {
        if (!grouped[row.item_id]) grouped[row.item_id] = [];
        grouped[row.item_id].push(row);
      }
      const derived = {};
      for (const [itemId, sources] of Object.entries(grouped)) {
        derived[itemId] = deriveTracking(sources);
      }
      setTracking(derived);
    }
    setLoading(false);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTracking(); }, [fetchTracking]);

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">WISHLIST</div>
          <div className="v-screen-sub">{String(wishlist.length).padStart(2, '0')} ITEMS · PRICE TRACKING</div>
        </div>
        <button className="toolbar-add" style={{ alignSelf: 'flex-end' }} onClick={onAdd}>+ TRACK NEW</button>
      </div>

      <div className="v-body">
        <div className="mob-pad" style={{ padding: '0 36px 24px' }}>
          {wishlist.length === 0 && (
            <div className="v-empty">No wishlist items. Add an item and set its status to "wishlist".</div>
          )}

          {wishlist.length > 0 && (
            <>
              <div className="wish-header">
                <div>№</div>
                <div />
                <div>BRAND · ITEM</div>
                <div>DELTA</div>
                <div style={{ textAlign: 'right' }}>BEST PRICE</div>
                <div style={{ textAlign: 'right' }}>LAST CHECKED</div>
                <div style={{ textAlign: 'right' }}>SOURCES</div>
                <div style={{ textAlign: 'right' }}>ACTION</div>
              </div>

              {wishlist.map((it, i) => {
                const imgs = parseImageUrls(it.image_url);
                const t    = tracking[it.id];
                const hasSources = t !== null && t !== undefined;

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
                      {hasSources && t.bestSourceName && (
                        <div className="mono-dim" style={{ fontSize: 8, marginTop: 2 }}>{t.bestSourceName.toUpperCase()}</div>
                      )}
                    </div>

                    {/* Delta */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {hasSources
                        ? <DeltaBadge amt={t.deltaAmt} pct={t.deltaPct} />
                        : <span className="mono-dim" style={{ fontSize: 9 }}>NO SOURCES</span>
                      }
                    </div>

                    {/* Best price */}
                    <div style={{ textAlign: 'right' }}>
                      {hasSources && t.latestPrice != null
                        ? <div className="wish-current">${Number(t.latestPrice).toLocaleString()}</div>
                        : <div className="mono-dim" style={{ fontSize: 10 }}>—</div>
                      }
                    </div>

                    {/* Last checked */}
                    <div className="mono-dim" style={{ fontSize: 9, textAlign: 'right', letterSpacing: '0.08em' }}>
                      {hasSources ? formatChecked(t.lastChecked) : '—'}
                    </div>

                    {/* Source count */}
                    <div style={{ textAlign: 'right' }}>
                      {hasSources
                        ? <span className="mono-dim" style={{ fontSize: 9 }}>{t.sourceCount} SOURCE{t.sourceCount !== 1 ? 'S' : ''}</span>
                        : <span className="mono-dim" style={{ fontSize: 9 }}>—</span>
                      }
                    </div>

                    {/* Action */}
                    <div style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {!hasSources && (
                        <button
                          className="mode-btn"
                          style={{ border: '1px solid var(--border)', padding: '7px 14px', fontSize: 9, letterSpacing: '0.12em' }}
                          onClick={() => onItemClick(it)}
                        >+ ADD SOURCE</button>
                      )}
                      <button
                        className="mode-btn"
                        style={{ border: '1px solid var(--border)', padding: '7px 14px' }}
                        onClick={() => onItemClick(it)}
                      >VIEW →</button>
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
