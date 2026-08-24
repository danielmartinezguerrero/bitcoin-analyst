/**
 * Renderer logic. Buttons on the left, conversation on the right.
 *
 * Everything the app can say is built here from the engine's output — no text
 * is invented in the UI, and every number shown carries the caveat the engine
 * attached to it.
 *
 * LANGUAGE HANDLING: messages are stored as {kind, payload}, never as finished
 * HTML. Switching language re-renders the whole conversation from that stored
 * data. Translating only new messages would leave the chat half in English and
 * half in Spanish, which is worse than not translating at all.
 */
import { t, tr, LANGUAGES } from './i18n.js';

const chat = document.getElementById('chat');
const statusBar = document.getElementById('status');
const statusText = document.getElementById('status-text');
const priceEl = document.getElementById('price');
const priceTime = document.getElementById('price-time');

const buttons = ['btn-analyze', 'btn-refresh', 'btn-whales', 'btn-validation']
  .map((id) => document.getElementById(id));

let lang = localStorage.getItem('lang') || 'en';
/** Conversation as data, so it can be re-rendered in another language. */
const history = [];
let lastPrice = null;

const money = (x) => Math.round(x).toLocaleString(lang === 'es' ? 'de-DE' : 'en-US');
const signed = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const T = (key, vars) => t(key, lang, vars);

// ---------------------------------------------------------------- language

function applyLanguage() {
  document.documentElement.lang = lang;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = T(el.dataset.i18n);
  }
  for (const b of document.querySelectorAll('.lang-btn')) {
    b.classList.toggle('active', b.dataset.lang === lang);
  }
  if (lastPrice !== null) {
    priceEl.textContent = money(lastPrice.price);
    priceTime.textContent = `${T('updated')} ${lastPrice.time} UTC`;
  } else {
    priceTime.textContent = T('notLoaded');
  }
  render();
}

function setLanguage(code) {
  if (code === lang) return;
  lang = code;
  localStorage.setItem('lang', code);
  applyLanguage();
}

document.getElementById('lang-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('.lang-btn');
  if (btn) setLanguage(btn.dataset.lang);
});

// ------------------------------------------------------------------- chat

function push(kind, payload) {
  history.push({ kind, payload });
  render();
}

function render() {
  chat.innerHTML = '';
  for (const { kind, payload } of history) {
    const el = document.createElement('div');
    if (kind === 'user') {
      el.className = 'msg user';
      el.innerHTML = '<div class="bubble"></div>';
      el.querySelector('.bubble').textContent = T(payload);
    } else {
      el.className = 'msg bot';
      el.innerHTML = `<div class="bubble">${RENDERERS[kind](payload)}</div>`;
    }
    chat.appendChild(el);
  }
  chat.scrollTop = chat.scrollHeight;
}

function busy(on, textKey = '') {
  statusBar.classList.toggle('hidden', !on);
  statusText.textContent = textKey ? T(textKey) : '';
  buttons.forEach((b) => { b.disabled = on; });
}

window.api.onProgress((message) => { statusText.textContent = message; });

const settings = () => ({
  capital: Number(document.getElementById('capital').value) || 0,
  feeProfile: document.getElementById('profile').value,
  entryAsMaker: document.getElementById('maker').checked,
});

// -------------------------------------------------------------- renderers

const RENDERERS = {
  welcome: () => `
    <h2>${T('welcomeTitle')}</h2>
    <p>${T('welcomeIntro')}</p>
    <h3>${T('gettingStarted')}</h3>
    <ul>
      <li>${T('step1')}</li><li>${T('step2')}</li>
      <li>${T('step3')}</li><li>${T('step4')}</li>
    </ul>
    <div class="footnote">${T('welcomeFoot')}</div>`,

  error: (p) => `
    <h2>${T('errorTitle')}</h2><p>${escape(p.message)}</p>
    <div class="footnote">${T('errorFoot')}</div>`,

  errorPos: (p) => `<h2>${T('errorPos')}</h2><p>${escape(p.message)}</p>`,

  analysis: ({ result: r, explanation: x }) => {
    const readingKey = x.reading === 'BULLISH' ? 'BULLISH' : x.reading === 'BEARISH' ? 'BEARISH' : null;
    const label = readingKey ? T(readingKey) : x.reading;
    const cls = x.reading === 'BULLISH' ? 'bull' : x.reading === 'BEARISH' ? 'bear' : 'flat';
    const arrow = x.reading === 'BULLISH' ? '↑' : x.reading === 'BEARISH' ? '↓' : '→';

    let html = `
      <h2>${T('marketRead')} — ${new Date(r.generatedAt).toISOString().slice(0, 10)}</h2>
      <div class="verdict ${cls}">${arrow} ${escape(label)}
        ${x.isTrending ? '' : `<span class="pill info">${T('noClearTrend')}</span>`}
        ${x.qualifier ? `<span class="pill no">${T('momentumDeteriorating')}</span>` : ''}</div>`;

    /**
     * The momentum conflict sits directly under the headline, not in the list.
     * A verdict that reads BULLISH while short-term momentum accelerates the
     * other way is a contradiction, and it has to be visible at the same
     * glance as the verdict itself.
     */
    if (x.momentum && x.momentum.text) {
      html += `<div class="momentum-flag">${escape(tr(x.momentum.text, lang))}</div>`;
    }

    html += `<h3>${T('why')}</h3>
      <ul>${x.reasons.map((s) => `<li>${escape(tr(s, lang))}</li>`).join('')}</ul>`;

    if (x.against.length) {
      html += `<h3>${T('against')}</h3>
        <ul>${x.against.map((s) => `<li class="warn">${escape(tr(s, lang))}</li>`).join('')}</ul>`;
    }
    html += r.proposal ? renderTrade(r) : renderNoTrade(r);
    html += `<div class="footnote">${escape(r.validation.note)}</div>`;
    return html;
  },

  positioning: ({ positioning: p, funding: f }) => {
    const gap = p.whaleRetailGap;
    const verdict = gap === null ? '—'
      : gap > 0.3 ? T('moreLong') : gap < -0.3 ? T('moreShort') : T('noDivergence');
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;

    return `
      <h2>${T('posTitle')}</h2>
      <table class="data">
        ${row(T('topByPosition'), p.topByPosition ?? '—')}
        ${row(T('topByAccount'), p.topByAccount ?? '—')}
        ${row(T('allAccounts'), p.allAccounts ?? '—')}
        ${row(T('whaleGap'), gap ?? '—')}
        ${row(T('openInterest'), p.openInterestBTC ? money(p.openInterestBTC) + ' BTC' : '—')}
        ${row(T('takerRatio'), p.takerBuySell ?? '—')}
        ${f ? row(T('fundingRate'), f.ratePct.toFixed(4) + '%') : ''}
        ${f ? row(T('fundingPct'), Math.round(f.percentile30d * 100)) : ''}
      </table>
      <p style="margin-top:12px"><strong>${verdict}.</strong></p>
      <div class="footnote">${T('posFoot')}</div>`;
  },

  validation: (v) => `
    <h2>${T('valTitle')}</h2>
    <p>${T('valIntro', { n: v.trades })}</p>
    <table class="data">
      <tr><td>${T('valNoFilter')}</td><td style="color:var(--red)">${v.expectancyNoFilter}R</td></tr>
      <tr><td>${T('valWithFilter')}</td><td style="color:var(--green)">${signed(v.expectancyWithFilter, 4)}R</td></tr>
      <tr><td>${T('valHitRate')}</td><td>${(v.winRateWithFilter * 100).toFixed(1)}%</td></tr>
      <tr><td>${T('valPValue')}</td><td><span class="pill no">${v.pValue}</span></td></tr>
      <tr><td>${T('valLevels')}</td><td><span class="pill no">p = ${v.levelsPValue}</span></td></tr>
      <tr><td>${T('valSampleSize')}</td><td>${v.sampleSize}</td></tr>
      <tr><td>${T('valBonferroni')}</td><td>p &lt; ${v.bonferroniThreshold.toFixed(4)} (${v.configurationsTried})</td></tr>
    </table>
    <h3>${T('plainTerms')}</h3>
    <ul>
      <li>${T('valPoint1', { p: v.pValue })}</li>
      <li>${T('valPoint2', { p: v.levelsPValue })}</li>
      <li>${T('valPoint3')}</li>
      <li>${T('valPoint4')}</li>
    </ul>
    <div class="footnote">${T('valFoot')}</div>`,
};

function renderTrade(r) {
  const p = r.proposal, tg = p.target;
  const side = p.direction === 'bullish' ? T('LONG') : T('SHORT');

  /**
   * THE BANNER GOES FIRST, above the numbers.
   *
   * Previously the trade plan was printed in full and the statistics sat in a
   * footnote below it. Nobody reads a plan with an entry, a stop and a size
   * and then decides not to trade because of small grey text underneath. If
   * the system has no proven edge, that has to be the first thing seen, not
   * the last.
   */
  const banner = r.validation.hasProvenEdge ? '' : `
    <div class="not-actionable">
      <strong>${T('notActionable')}</strong>
      <span>${T('notActionableWhy')}</span>
    </div>`;

  let html = `<h3>${T('suggested')} — ${side} (${escape(p.timeframe)} ${T('reference')})</h3>
    ${banner}
    <div class="trade">
      <div class="trade-row"><span class="k">${T('entry')}</span>
        <span class="v">${money(p.price)}</span></div>
      <div class="trade-row"><span class="k">${T('stopLoss')}</span>
        <span class="v stop">${money(p.invalidation.price)}
        <span class="note">${signed(p.invalidation.distancePct)}% · ${p.riskATR} ATR</span></span></div>
      <div class="trade-row"><span class="k">${T('takeProfit')}</span>
        <span class="v target">${money(tg.price)}
        <span class="note">${signed(tg.distancePct)}% · ${tg.distanceATR} ATR</span></span></div>
      <div class="trade-row"><span class="k">${T('netRR')}</span>
        <span class="v">${tg.netRR}:1
        <span class="note">${T('needsHitRate')} ${tg.netMinWinRatePct}%</span></span></div>
      <div class="trade-row"><span class="k">${T('feesTake')}</span>
        <span class="v">${tg.costBitePct}%<span class="note">${T('ofGross')}</span></span></div>
    </div>`;

  if (r.sizing) {
    const s = r.sizing;
    html += `<h3>${T('withCapital', { n: s.capital })}</h3>
      <table class="data">
        <tr><td>${T('positionSize')}</td><td>${s.notional.toFixed(2)} USDT · ${s.btc.toFixed(6)} BTC</td></tr>
        <tr><td>${T('ifTarget')}</td><td style="color:var(--green)">+${s.netWin.toFixed(2)} USDT (${signed(s.winPctOfCapital)}%)</td></tr>
        <tr><td>${T('ifStop')}</td><td style="color:var(--red)">-${s.netLoss.toFixed(2)} USDT (-${s.lossPctOfCapital.toFixed(2)}%)</td></tr>
        <tr><td>${T('feesIncluded')}</td><td>${s.feesWin.toFixed(3)} / ${s.feesLoss.toFixed(3)} USDT</td></tr>
        <tr><td>${T('expectedFees')}</td><td>${s.expectedFees.toFixed(3)} USDT (${s.expectedFeesInR.toFixed(4)}R)</td></tr>
      </table>`;
    if (s.tooSmall) html += `<p class="footnote">${T('tooSmall')}</p>`;
  }

  /**
   * Honest labels first (distances in ATR — what the levels actually are),
   * the original wording second and in parentheses. Leading with "structure"
   * would restore authority the random-levels test already removed.
   */
  /**
   * The original labels ("structure", "zone with 2 touches") are gone, not
   * parenthesised. Keeping them alongside re-lent the authority the
   * random-levels test had just removed — a caveat one line below does not
   * undo a claim made one line above.
   */
  html += `<p class="footnote">${T('stopRests')}: <strong>${escape(p.honestStopLabel)}</strong><br>
    ${T('targetFrom')}: <strong>${escape(p.honestTargetLabel)}</strong><br>
    <em>${T('levelsCaveat')}</em></p>`;

  if (p.penalties && p.penalties.length) {
    html += `<h3>${T('weakPoints')}</h3>
      <ul>${p.penalties.map((x) => `<li class="warn">${escape(tr(x.reason, lang))}</li>`).join('')}</ul>`;
  }
  return html;
}

function renderNoTrade(r) {
  const reason = !r.regime.isTrending
    ? `${T('notTrending', { er: r.regime.er, th: r.regime.erTrendThreshold })}
       ${escape(tr('Regime: ' + r.regime.kind + '. ' + r.regime.description, lang))}`
    : T('noneAligned', { dir: r.regime.direction });

  return `<h3>${T('noTrade')}</h3>
    <div class="trade"><p>${reason}</p></div>
    <p class="footnote">${T('noTradeFoot')}</p>`;
}

// ---------------------------------------------------------------- actions

async function analyze(refresh = false) {
  push('user', refresh ? 'askRefresh' : 'askAnalyze');
  busy(true, 'starting');

  const res = await window.api.runAnalysis({ ...settings(), refresh });
  busy(false);

  if (!res.ok) { push('error', { message: res.error }); return; }

  lastPrice = { price: res.result.price, time: new Date(res.result.generatedAt).toISOString().slice(11, 16) };
  priceEl.textContent = money(lastPrice.price);
  priceTime.textContent = `${T('updated')} ${lastPrice.time} UTC`;
  push('analysis', res);
}

async function whales() {
  push('user', 'askWhales');
  busy(true, 'loadingPos');
  const res = await window.api.getPositioning();
  busy(false);
  if (!res.ok) { push('errorPos', { message: res.error }); return; }
  push('positioning', res);
}

async function validation() {
  push('user', 'askValidation');
  busy(true, 'loadingVal');
  const v = await window.api.getValidation();
  busy(false);
  push('validation', v);
}

/**
 * Clearing wipes the conversation but keeps the welcome message: an empty
 * panel with no explanation looks broken, and the welcome text is where the
 * buttons are explained.
 */
function clearChat() {
  history.length = 0;
  history.push({ kind: 'welcome', payload: null });
  render();
}

document.getElementById('btn-analyze').addEventListener('click', () => analyze(false));
document.getElementById('btn-refresh').addEventListener('click', () => analyze(true));
document.getElementById('btn-whales').addEventListener('click', whales);
document.getElementById('btn-validation').addEventListener('click', validation);
document.getElementById('btn-clear').addEventListener('click', clearChat);

history.push({ kind: 'welcome', payload: null });
applyLanguage();
