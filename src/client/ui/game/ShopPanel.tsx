/**
 * Shop screen (spec §11.5): buy from limited stock, sell carried items (prices drop as the shop
 * fills up), and haggle once a day with a Persuasion check. Prices come from the server.
 */
import { useEffect, useState } from 'preact/hooks';
import { gameState, send, shopView } from '../../net/gameSocket';
import { coins, t } from '../i18n';
import { itemText } from '../srdText';
import { localShops } from '../../data';

export function ShopPanel({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  useEffect(() => {
    shopView.value = null;
    send({ type: 'shop_open', shopId });
  }, [shopId]);
  const view = shopView.value?.id === shopId ? shopView.value : null;
  // The name in the current language (the server's view keeps the language it was opened in).
  const name = localShops.value.shops.find((s) => s.id === shopId)?.name ?? view?.name;
  const purse = gameState.value?.hero.coins ?? 0;

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('shop.aria')}>
      <section class="journal shop">
        <header class="journal-head">
          <h2>{name ?? t('shop.aria')}</h2>
          <span class="muted small">{t('shop.purse', { coins: coins(purse) })}</span>
          <button type="button" onClick={onClose} aria-label={t('shop.closeAria')}>
            {t('common.close')}
          </button>
        </header>
        {!view ? (
          <p class="hint" style={{ padding: '1rem' }}>
            {t('shop.opening')}
          </p>
        ) : !view.open ? (
          <p class="hint" style={{ padding: '1rem' }}>
            {t('shop.closed', { name: name ?? view.name })}
          </p>
        ) : view.refuses ? (
          <p class="hint" style={{ padding: '1rem' }}>
            {t('shop.refuses')}
          </p>
        ) : (
          <div class="shop-body">
            <div class="method-tabs">
              <button type="button" class={tab === 'buy' ? 'selected' : ''} onClick={() => setTab('buy')}>
                {t('shop.buy')}
              </button>
              <button type="button" class={tab === 'sell' ? 'selected' : ''} onClick={() => setTab('sell')}>
                {t('shop.sell')}
              </button>
              <button type="button" disabled={view.haggled !== undefined} title={t('shop.haggleTitle')} onClick={() => send({ type: 'shop_haggle', shopId })}>
                {t(view.haggled === undefined ? 'shop.haggle' : view.haggled ? 'shop.haggled' : 'shop.haggleFailed')}
              </button>
            </div>
            <ul class="inventory-list">
              {tab === 'buy' &&
                view.stock.map((l) => (
                  <li key={l.itemId}>
                    <span class="item-name">
                      {itemText(l.itemId)} <span class="muted">{t('shop.left', { n: l.qty })}</span>
                    </span>
                    <span class="item-actions">
                      <span class="price">{coins(l.price)}</span>
                      <button type="button" disabled={purse < l.price} onClick={() => send({ type: 'shop_buy', shopId, itemId: l.itemId, qty: 1 })}>
                        {t('shop.buy')}
                      </button>
                    </span>
                  </li>
                ))}
              {tab === 'sell' && view.offers.length === 0 && <li class="hint">{t('shop.nothingToSell')}</li>}
              {tab === 'sell' &&
                view.offers.map((o) => (
                  <li key={o.uid}>
                    <span class="item-name">
                      {o.qty > 1 && <span class="muted">{o.qty} × </span>}
                      {itemText(o.itemId)}
                    </span>
                    <span class="item-actions">
                      <span class="price">{coins(o.price)}</span>
                      <button type="button" onClick={() => send({ type: 'shop_sell', shopId, uid: o.uid, qty: 1 })}>
                        {t('shop.sell')}
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
