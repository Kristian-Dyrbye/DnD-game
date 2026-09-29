/**
 * Shop screen (spec §11.5): buy from limited stock, sell carried items (prices drop as the shop
 * fills up), and haggle once a day with a Persuasion check. Prices come from the server.
 */
import { useEffect, useState } from 'preact/hooks';
import { gameState, send, shopView } from '../../net/gameSocket';
import { formatCoins } from '../text';

export function ShopPanel({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  useEffect(() => {
    shopView.value = null;
    send({ type: 'shop_open', shopId });
  }, [shopId]);
  const view = shopView.value?.id === shopId ? shopView.value : null;
  const coins = gameState.value?.hero.coins ?? 0;

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Shop">
      <section class="journal shop">
        <header class="journal-head">
          <h2>{view?.name ?? 'Shop'}</h2>
          <span class="muted small">Your purse: {formatCoins(coins)}</span>
          <button type="button" onClick={onClose} aria-label="Close shop">
            Close
          </button>
        </header>
        {!view ? (
          <p class="hint" style={{ padding: '1rem' }}>
            Opening…
          </p>
        ) : !view.open ? (
          <p class="hint" style={{ padding: '1rem' }}>
            {view.name} is closed at this hour.
          </p>
        ) : view.refuses ? (
          <p class="hint" style={{ padding: '1rem' }}>
            The shopkeeper refuses to deal with you.
          </p>
        ) : (
          <div class="shop-body">
            <div class="method-tabs">
              <button type="button" class={tab === 'buy' ? 'selected' : ''} onClick={() => setTab('buy')}>
                Buy
              </button>
              <button type="button" class={tab === 'sell' ? 'selected' : ''} onClick={() => setTab('sell')}>
                Sell
              </button>
              <button type="button" disabled={view.haggled !== undefined} title="Persuasion DC 15, once a day" onClick={() => send({ type: 'shop_haggle', shopId })}>
                {view.haggled === undefined ? 'Haggle' : view.haggled ? 'Haggled: better prices today' : 'Haggle failed today'}
              </button>
            </div>
            <ul class="inventory-list">
              {tab === 'buy' &&
                view.stock.map((l) => (
                  <li key={l.itemId}>
                    <span class="item-name">
                      {l.name} <span class="muted">({l.qty} left)</span>
                    </span>
                    <span class="item-actions">
                      <span class="price">{formatCoins(l.price)}</span>
                      <button type="button" disabled={coins < l.price} onClick={() => send({ type: 'shop_buy', shopId, itemId: l.itemId, qty: 1 })}>
                        Buy
                      </button>
                    </span>
                  </li>
                ))}
              {tab === 'sell' && view.offers.length === 0 && <li class="hint">Nothing this shop wants to buy (equipped items can't be sold).</li>}
              {tab === 'sell' &&
                view.offers.map((o) => (
                  <li key={o.uid}>
                    <span class="item-name">
                      {o.qty > 1 && <span class="muted">{o.qty} × </span>}
                      {o.name}
                    </span>
                    <span class="item-actions">
                      <span class="price">{formatCoins(o.price)}</span>
                      <button type="button" onClick={() => send({ type: 'shop_sell', shopId, uid: o.uid, qty: 1 })}>
                        Sell
                      </button>
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
