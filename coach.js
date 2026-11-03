// coach.js - záložka "Trénink": týdenní objem a rovnováha svalů, rekordy a plateau + přepínač záložek
// Načítá se po app.js. Používá globální mergedSets, Muscles, E1rm a funkce z app.js (escapeHtml).
const Coach = (() => {
  const DAY_MS = 86400000;
  const CFG = {
    volumeWindowDays: 7,      // aktuální týden = posledních 7 dní včetně dneška
    baselineDays: 42,         // průměr se bere z 6 týdnů před aktuálním týdnem
    laggingShare: 0.7,        // sval je zvýrazněný, když má méně než 70 % svého průměru
    minBaselinePerWeek: 3,    // průměr pod 3 sériemi týdně se nehodnotí (málo dat)
    recordDays: 14,           // nový rekord = za posledních 14 dní
    recordGain: 0.01,         // rekord musí překonat dřívější maximum aspoň o 1 %
    recordMinPrior: 2,        // aspoň 2 dřívější tréninky cviku
    plateauRecentDays: 28,    // sledované období (4 týdny)
    plateauRefDays: 84,       // porovnává se s tréninky 28 až 111 dní zpět
    plateauMinRecent: 3,      // aspoň 3 tréninky za posledních 28 dní
    plateauMinRef: 2,         // aspoň 2 tréninky v referenčním období
    plateauBand: 0.97         // 97 % a víc = stagnace, méně = výkon pod dřívějším maximem
  };
  const WORK = new Set(['standard', 'failure']);
  const isWork = s => WORK.has(s.category) && s.weight > 0 && s.reps !== null && s.reps !== undefined;
  const toNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
  const todayNum = today => Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY_MS;

  function weeklyVolume(sets, today) {
    const tN = todayNum(today);
    const cur = {}, base = {};
    for (const [key] of Muscles.LIST) { cur[key] = 0; base[key] = 0; }
    let lastDay = null;
    for (const s of sets) {
      if (!isWork(s)) continue;
      if (lastDay === null || s.day > lastDay) lastDay = s.day;
      const w = Muscles.WEIGHTS[s.exercise];
      if (!w) continue;
      const age = tN - toNum(s.day);
      if (age < 0) continue;
      let target = null;
      if (age <= CFG.volumeWindowDays - 1) target = cur;
      else if (age <= CFG.volumeWindowDays - 1 + CFG.baselineDays) target = base;
      if (!target) continue;
      for (const [key] of Muscles.LIST) if (w[key]) target[key] += w[key];
    }
    const weeks = CFG.baselineDays / 7;
    const rows = Muscles.LIST.map(([key, label]) => {
      const avg = base[key] / weeks;
      const lagging = avg >= CFG.minBaselinePerWeek && cur[key] < CFG.laggingShare * avg;
      return { key, label, current: cur[key], avg, ratio: avg > 0 ? cur[key] / avg : null, lagging };
    });
    return { rows, lastDay, staleData: lastDay === null || tN - toNum(lastDay) > CFG.volumeWindowDays - 1 };
  }

  function trends(sets, today) {
    const tN = todayNum(today);
    const records = [], plateaus = [];
    for (const info of E1rm.exerciseList(sets)) {
      const sess = E1rm.sessions(sets, info.name).map(s => ({ day: s.day, value: s.value, age: tN - toNum(s.day) }))
        .filter(s => s.age >= 0);
      if (sess.length < 3) continue;

      let record = null;
      for (let i = sess.length - 1; i >= 0; i--) {
        const s = sess[i];
        if (s.age > CFG.recordDays - 1) break;
        const prior = sess.slice(0, i);
        if (prior.length < CFG.recordMinPrior) continue;
        const prev = Math.max(...prior.map(p => p.value));
        if (s.value >= prev * (1 + CFG.recordGain)) { record = { name: info.name, value: s.value, gain: s.value / prev - 1, day: s.day, perHand: info.perHand }; break; }
      }
      if (record) { records.push(record); continue; }

      const recent = sess.filter(s => s.age <= CFG.plateauRecentDays - 1);
      const ref = sess.filter(s => s.age >= CFG.plateauRecentDays && s.age <= CFG.plateauRecentDays + CFG.plateauRefDays - 1);
      if (recent.length >= CFG.plateauMinRecent && ref.length >= CFG.plateauMinRef) {
        const m = Math.max(...recent.map(s => s.value)), p = Math.max(...ref.map(s => s.value));
        const ratio = m / p;
        if (ratio < 1 + CFG.recordGain) {
          plateaus.push({ name: info.name, ratio, recent: recent.length, best: m, ref: p, status: ratio >= CFG.plateauBand ? 'stagnuje' : 'pod' , perHand: info.perHand });
        }
      }
    }
    records.sort((a, b) => b.gain - a.gain);
    plateaus.sort((a, b) => b.recent - a.recent || a.ratio - b.ratio);
    return { records, plateaus };
  }

  return { CFG, weeklyVolume, trends };
})();
if (typeof module !== 'undefined') module.exports = Coach;

// ---------- zobrazení a přepínač záložek ----------
(function () {
  if (typeof document === 'undefined') return;
  const main = document.querySelector('main');
  const box = document.getElementById('coach');
  if (!main || !box) return;

  const css = document.createElement('style');
  css.textContent = `
    .tabs { position: sticky; top: 0; z-index: 5; display: flex; gap: 4px; padding: 6px; margin: 12px 0 16px; background: #22222f; border-radius: 14px; box-shadow: 0 6px 12px rgba(26,26,36,0.9); }
    .tabs button { flex: 1; padding: 11px 6px; border: 0; border-radius: 10px; background: transparent; color: #ffffff; font-size: 1rem; }
    .tabs button.on { background: #4a4a5c; font-weight: 600; }
    main[data-tab="train"] .ov { display: none !important; }
    main[data-tab="overview"] #coach { display: none; }
    .vrow { padding: 10px 0; border-bottom: 1px solid #2e2e3d; }
    .vrow:last-of-type { border-bottom: 0; }
    .vtop { display: flex; justify-content: space-between; gap: 8px; font-size: 0.95rem; }
    .vtop b.low { color: #e0405e; }
    .vbar { position: relative; height: 8px; margin-top: 6px; border-radius: 4px; background: #1a1a24; }
    .vbar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: #4a4a5c; }
    .vbar i.cur { background: #7bd88f; }
    .vbar i.cur.low { background: #e0405e; }
    .vbar u { position: absolute; top: -3px; bottom: -3px; width: 2px; background: #ffffff; }
    .tlist { list-style: none; padding: 0; margin: 0; }
    .tlist li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #2e2e3d; font-size: 0.95rem; }
    .tlist li:last-child { border-bottom: 0; }
    .tlist small { display: block; color: #8a8a99; }
    .tlist b { white-space: nowrap; }
    .pos { color: #7bd88f; }
    .neg { color: #e0405e; }
  `;
  document.head.appendChild(css);

  ['importMsg', 'dropzone', 'strength', 'e1rm', 'bodycomp', 'sync', 'storage', 'merged', 'results'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('ov');
  });

  const bar = document.createElement('div');
  bar.className = 'tabs';
  bar.innerHTML = '<button data-tab="overview">Přehled</button><button data-tab="train">Trénink</button>';
  const h1 = main.querySelector('h1');
  if (h1) h1.insertAdjacentElement('afterend', bar); else main.prepend(bar);

  function setTab(tab) {
    if (tab !== 'train') tab = 'overview';
    main.dataset.tab = tab;
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    try { localStorage.setItem('st:tab', tab); } catch (e) { /* bez ukládání */ }
    if (tab === 'train') renderCoach();
    window.scrollTo(0, 0);
  }
  bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });

  const fmtSets = n => (Math.round(n * 2) / 2).toString().replace('.', ',');
  const pct = r => `${r >= 0 ? '+' : '−'}${Math.round(Math.abs(r) * 100)} %`;
  const dayCz = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d}. ${m}. ${y}`; };
  const kg = v => v.toFixed(1).replace('.', ',') + ' kg';

  function renderCoach() {
    const sets = (typeof mergedSets !== 'undefined' && mergedSets) ? mergedSets : [];
    if (!sets.length) {
      box.innerHTML = '<section class="card"><p class="muted">Zatím tu nejsou žádná data. Nahraj export na záložce Přehled.</p></section>';
      return;
    }
    const today = new Date();
    const vol = Coach.weeklyVolume(sets, today);
    const tr = Coach.trends(sets, today);

    const scale = Math.max(1, ...vol.rows.map(r => Math.max(r.current, r.avg)));
    const volRows = vol.rows.map(r => {
      const diff = r.ratio === null ? '' : ` (${pct(r.ratio - 1)})`;
      return `
      <div class="vrow">
        <div class="vtop"><span>${escapeHtml(r.label)}</span><span><b class="${r.lagging ? 'low' : ''}">${fmtSets(r.current)}</b> sérií · průměr ${fmtSets(r.avg)}${diff}</span></div>
        <div class="vbar"><i class="cur ${r.lagging ? 'low' : ''}" style="width:${Math.min(100, r.current / scale * 100)}%"></i><u style="left:${Math.min(100, r.avg / scale * 100)}%"></u></div>
      </div>`;
    }).join('');
    const staleMsg = vol.staleData
      ? `<p class="error note">Poslední záznam v datech je ${vol.lastDay ? dayCz(vol.lastDay) : '–'}, takže aktuální týden je nejspíš nekompletní. Nahraj čerstvý export.</p>` : '';
    const lagging = vol.rows.filter(r => r.lagging);
    const lagMsg = lagging.length && !vol.staleData
      ? `<p class="note">Pod 70 % svého průměru: <b>${lagging.map(r => escapeHtml(r.label)).join(', ')}</b>.</p>` : '';

    const recList = tr.records.length
      ? `<ul class="tlist">${tr.records.map(r => `<li><span>${escapeHtml(r.name)}<small>${dayCz(r.day)}${r.perHand ? ' · na jednu činku' : ''}</small></span><b><span class="pos">${pct(r.gain)}</span> · ${kg(r.value)}</b></li>`).join('')}</ul>`
      : '<p class="muted">Za posledních 14 dní žádný nový rekord.</p>';
    const platList = tr.plateaus.length
      ? `<ul class="tlist">${tr.plateaus.map(p => `<li><span>${escapeHtml(p.name)}<small>${p.status === 'stagnuje' ? 'stagnuje' : 'pod dřívějším maximem'} · ${p.recent} tréninky za 4 týdny${p.perHand ? ' · na jednu činku' : ''}</small></span><b>${kg(p.best)} <span class="${p.status === 'stagnuje' ? '' : 'neg'}">(${pct(p.ratio - 1)})</span></b></li>`).join('')}</ul>`
      : '<p class="muted">Žádný cvik nestagnuje.</p>';

    box.innerHTML = `
      <section class="card">
        <h2>Týdenní objem a rovnováha</h2>
        <p class="muted tiny">Pracovní série za posledních 7 dní. Svislá čárka je průměr týdne za předchozích 6 týdnů.</p>
        ${staleMsg}${volRows}${lagMsg}
        <p class="muted note">Hlavní sval se počítá za 1 sérii, pomocný za 0,5 (podle tabulky cviků). Zvýrazněný je sval s méně než 70 % svého průměru, pokud má průměr aspoň 3 série týdně.</p>
      </section>
      <section class="card">
        <h2>Nové rekordy</h2>
        <p class="muted tiny">Odhad 1RM za posledních 14 dní, který překonal dřívější maximum aspoň o 1 %.</p>
        ${recList}
      </section>
      <section class="card">
        <h2>Stagnace</h2>
        <p class="muted tiny">Cviky s aspoň 3 tréninky za 4 týdny, jejichž nejlepší odhad 1RM nepřekonal maximum z předchozích 12 týdnů o 1 %. Stagnace je do −3 %, níže už je výkon pod dřívějším maximem.</p>
        ${platList}
        <p class="muted note">Při stagnaci zvaž lehčí týden (deload) nebo změnu rozsahu opakování. Jde o orientační pravidlo podle odhadů 1RM, ne o jistotu: odhad kolísá s RIR a počtem opakování.</p>
      </section>`;
  }

  if (typeof renderMerged === 'function') {
    const originalRenderMerged = renderMerged;
    renderMerged = function () {
      const r = originalRenderMerged.apply(this, arguments);
      try { renderCoach(); } catch (err) { console.warn('Záložka Trénink se nevykreslila:', err); }
      return r;
    };
  }

  let startTab = 'overview';
  try { startTab = localStorage.getItem('st:tab') || 'overview'; } catch (e) { /* bez ukládání */ }
  setTab(startTab);
  window.scrollTo(0, 0);
})();
