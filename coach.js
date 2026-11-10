// coach.js - záložka "Trénink": týdenní objem, stagnace, svaly podle posledních maxim, nová maxima + přepínač záložek
// Načítá se po app.js. Používá globální mergedSets, Muscles, E1rm a funkce z app.js (escapeHtml).
const Coach = (() => {
  const DAY_MS = 86400000;
  const CFG = {
    volumeWindowDays: 7,      // aktuální týden = posledních 7 dní včetně dneška
    baselineDays: 42,         // průměr se bere z 6 týdnů před aktuálním týdnem
    laggingShare: 0.7,        // pod 70 % svého průměru = sval zaostává (červeně)
    minBaselinePerWeek: 3,    // průměr pod 3 sériemi týdně se nehodnotí (málo dat)
    recordsShown: 5,          // kolik posledních maxim se zobrazí
    recordGain: 0.01,         // maximum musí překonat dřívější maximum aspoň o 1 %
    recordMinPrior: 2,        // aspoň 2 dřívější tréninky cviku
    recentDays: 28,           // "nedávné" období pro pořadí svalů = 4 týdny
    refDays: 84,              // porovnává se s předchozími 12 týdny před nedávným obdobím
    stagWindows: { '3W': 21, '3M': 91 },  // období stagnace: 3 týdny / 3 měsíce
    plateauMinRecent: 3,      // stagnace: aspoň 3 tréninky v nedávném období
    plateauMinRef: 2,         // stagnace: aspoň 2 tréninky v referenčním období
    plateauBand: 0.97,        // 97 % a víc = stagnace, méně = výkon pod dřívějším maximem
    muscleMinRecent: 2,       // pořadí svalů: cvik má aspoň 2 tréninky za 28 dní ...
    muscleMinRef: 2           // ... a aspoň 2 v referenčním období
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
      const rated = avg >= CFG.minBaselinePerWeek;
      const ratio = avg > 0 ? cur[key] / avg : null;
      const lagging = rated && cur[key] < CFG.laggingShare * avg;
      return { key, label, current: cur[key], avg, ratio, lagging };
    });
    return { rows, lastDay, staleData: lastDay === null || tN - toNum(lastDay) > CFG.volumeWindowDays - 1 };
  }

  // nejnovější maximum cviku: poslední trénink, který překonal všechny dřívější o aspoň 1 %
  function latestRecord(sess, name, perHand) {
    for (let i = sess.length - 1; i >= CFG.recordMinPrior; i--) {
      const prev = Math.max(...sess.slice(0, i).map(p => p.value));
      if (sess[i].value >= prev * (1 + CFG.recordGain)) {
        return { name, value: sess[i].value, gain: sess[i].value / prev - 1, day: sess[i].day, perHand };
      }
    }
    return null;
  }

  // recentDays = délka nedávného období ve dnech (výchozí 28); referenční období jsou 12 týdnů před ním
  function trends(sets, today, recentDays) {
    const rd = recentDays || CFG.recentDays;
    const tN = todayNum(today);
    const records = [], plateaus = [], changes = [];
    for (const info of E1rm.exerciseList(sets)) {
      const sess = E1rm.sessions(sets, info.name).map(s => ({ day: s.day, value: s.value, age: tN - toNum(s.day) }))
        .filter(s => s.age >= 0);
      if (sess.length < 3) continue;

      const rec = latestRecord(sess, info.name, info.perHand);
      if (rec) records.push(rec);

      const recent = sess.filter(s => s.age <= rd - 1);
      const ref = sess.filter(s => s.age >= rd && s.age <= rd + CFG.refDays - 1);
      if (!recent.length || !ref.length) continue;
      const m = Math.max(...recent.map(s => s.value)), p = Math.max(...ref.map(s => s.value));
      const ratio = m / p;
      changes.push({ name: info.name, ratio, recent: recent.length, ref: ref.length });
      if (recent.length >= CFG.plateauMinRecent && ref.length >= CFG.plateauMinRef && ratio < 1 + CFG.recordGain) {
        plateaus.push({ name: info.name, ratio, recent: recent.length, best: m, status: ratio >= CFG.plateauBand ? 'stagnuje' : 'pod', perHand: info.perHand });
      }
    }
    records.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.gain - a.gain));
    plateaus.sort((a, b) => b.recent - a.recent || a.ratio - b.ratio);
    return { records: records.slice(0, CFG.recordsShown), plateaus, changes };
  }

  // pořadí svalů: vážený průměr změny nejlepšího 1RM (poslední 4 týdny vs. předchozí maximum)
  function muscleRanking(changes) {
    const rows = Muscles.LIST.map(([key, label], order) => {
      let num = 0, den = 0, n = 0;
      for (const c of changes) {
        if (c.recent < CFG.muscleMinRecent || c.ref < CFG.muscleMinRef) continue;
        const w = (Muscles.WEIGHTS[c.name] || {})[key];
        if (!w) continue;
        num += w * (c.ratio - 1); den += w; n++;
      }
      return { key, label, order, n, change: den > 0 ? num / den : null };
    });
    rows.sort((a, b) => {
      if (a.change === null && b.change === null) return a.order - b.order;
      if (a.change === null) return 1;
      if (b.change === null) return -1;
      return b.change - a.change || a.order - b.order;
    });
    return rows;
  }

  // stagnace celých svalů: vážený průměr změny cviků svalu (stejná pravidla a prahy jako u cviků)
  function musclePlateaus(changes) {
    const rows = [];
    for (const [key, label] of Muscles.LIST) {
      let num = 0, den = 0, n = 0;
      for (const c of changes) {
        if (c.recent < CFG.plateauMinRecent || c.ref < CFG.plateauMinRef) continue;
        const w = (Muscles.WEIGHTS[c.name] || {})[key];
        if (!w) continue;
        num += w * (c.ratio - 1); den += w; n++;
      }
      if (den <= 0) continue;
      const change = num / den;
      if (change < CFG.recordGain) rows.push({ key, label, n, change, status: change + 1 >= CFG.plateauBand ? 'stagnuje' : 'pod' });
    }
    rows.sort((a, b) => a.change - b.change);
    return rows;
  }

  return { CFG, weeklyVolume, trends, muscleRanking, musclePlateaus };
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
    .tlist li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #2e2e3d; font-size: 0.95rem; }
    .tlist li:last-child { border-bottom: 0; }
    .tlist small { display: block; color: #8a8a99; }
    .tlist b { white-space: nowrap; }
    .rank { display: inline-block; width: 1.4em; color: #8a8a99; }
    .pos { color: #7bd88f; }
    .neg { color: #e0405e; }
    .flat { color: #8a8a99; }
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

  const STAG_LABELS = { '3W': '3 týdny', '3M': '3 měsíce' };
  let stagKey = '3W';
  try { const saved = localStorage.getItem('st:stag'); if (saved && STAG_LABELS[saved]) stagKey = saved; } catch (e) { /* bez ukládání */ }
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-stag]');
    if (!b || !STAG_LABELS[b.dataset.stag]) return;
    stagKey = b.dataset.stag;
    try { localStorage.setItem('st:stag', stagKey); } catch (err) { /* bez ukládání */ }
    renderCoach();
  });

  const fmtSets = n => (Math.round(n * 2) / 2).toString().replace('.', ',');
  const pct = r => `${r >= 0 ? '+' : '−'}${Math.round(Math.abs(r) * 100)} %`;
  const dayCz = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d}. ${m}. ${y}`; };
  const kg = v => v.toFixed(1).replace('.', ',') + ' kg';
  const nWorkouts = n => `${n} ${n === 1 ? 'trénink' : n < 5 ? 'tréninky' : 'tréninků'}`;
  const nExercises = n => `${n} ${n === 1 ? 'cvik' : n < 5 ? 'cviky' : 'cviků'}`;

  function renderCoach() {
    const sets = (typeof mergedSets !== 'undefined' && mergedSets) ? mergedSets : [];
    if (!sets.length) {
      box.innerHTML = '<section class="card"><p class="muted">Zatím tu nejsou žádná data. Nahraj export na záložce Přehled.</p></section>';
      return;
    }
    const today = new Date();
    const vol = Coach.weeklyVolume(sets, today);
    const tr = Coach.trends(sets, today);
    const rank = Coach.muscleRanking(tr.changes);
    const stagLabel = STAG_LABELS[stagKey];
    const trStag = Coach.trends(sets, today, Coach.CFG.stagWindows[stagKey]);
    const musclePlat = Coach.musclePlateaus(trStag.changes);

    const scale = Math.max(1, ...vol.rows.map(r => Math.max(r.current, r.avg)));
    // nejvíc trénované svaly nahoře: podle sérií za aktuální týden, při shodě podle průměru, pak podle původního pořadí
    const volSorted = vol.rows.map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.current - a.r.current || b.r.avg - a.r.avg || a.i - b.i)
      .map(x => x.r);
    const volRows = volSorted.map(r => {
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

    const stagToggle = `<div class="seg" data-kind="stag">${Object.keys(STAG_LABELS).map(k =>
      `<button data-stag="${k}" class="${k === stagKey ? 'on' : ''}">${STAG_LABELS[k]}</button>`).join('')}</div>`;

    const platList = trStag.plateaus.length
      ? `<ul class="tlist">${trStag.plateaus.map(p => `<li><span>${escapeHtml(p.name)}<small>${p.status === 'stagnuje' ? 'stagnuje' : 'pod dřívějším maximem'} · ${nWorkouts(p.recent)} za ${stagLabel}${p.perHand ? ' · na jednu činku' : ''}</small></span><b>${kg(p.best)} <span class="${p.status === 'stagnuje' ? 'flat' : 'neg'}">(${pct(p.ratio - 1)})</span></b></li>`).join('')}</ul>`
      : `<p class="muted">Žádný cvik nestagnuje (za ${stagLabel}).</p>`;

    const musclePlatList = musclePlat.length
      ? `<ul class="tlist">${musclePlat.map(m => `<li><span>${escapeHtml(m.label)}<small>${m.status === 'stagnuje' ? 'stagnuje' : 'pod dřívějším maximem'} · ${nExercises(m.n)}</small></span><b class="${m.status === 'stagnuje' ? 'flat' : 'neg'}">${pct(m.change)}</b></li>`).join('')}</ul>`
      : `<p class="muted">Žádný sval nestagnuje (za ${stagLabel}).</p>`;

    const rankList = `<ul class="tlist">${rank.map((r, i) => {
      if (r.change === null) return `<li><span><span class="rank">${i + 1}.</span>${escapeHtml(r.label)}<small>málo dat za poslední 4 týdny</small></span><b class="flat">–</b></li>`;
      const cls = r.change >= 0.005 ? 'pos' : r.change <= -0.005 ? 'neg' : 'flat';
      const arrow = r.change >= 0.005 ? '▲' : r.change <= -0.005 ? '▼' : '■';
      return `<li><span><span class="rank">${i + 1}.</span>${escapeHtml(r.label)}<small>${nExercises(r.n)}</small></span><b class="${cls}">${arrow} ${pct(r.change)}</b></li>`;
    }).join('')}</ul>`;

    const recList = tr.records.length
      ? `<ul class="tlist">${tr.records.map(r => `<li><span>${escapeHtml(r.name)}<small>${dayCz(r.day)}${r.perHand ? ' · na jednu činku' : ''}</small></span><b><span class="pos">${pct(r.gain)}</span> · ${kg(r.value)}</b></li>`).join('')}</ul>`
      : '<p class="muted">Zatím žádné nové maximum.</p>';

    box.innerHTML = `
      <section class="card">
        <h2>Týdenní objem a rovnováha</h2>
        <p class="muted tiny">Pracovní série za posledních 7 dní. Svislá čárka je průměr týdne za předchozích 6 týdnů. Nahoře jsou nejvíc trénované svaly.</p>
        ${staleMsg}${volRows}${lagMsg}
        <p class="muted note">Hlavní sval se počítá za 1 sérii, pomocný za 0,5 (podle tabulky cviků). Zvýrazněný je sval s méně než 70 % svého průměru, pokud má průměr aspoň 3 série týdně.</p>
      </section>
      <section class="card">
        <h2>Stagnace</h2>
        ${stagToggle}
        <p class="muted tiny">Cviky s aspoň 3 tréninky za ${stagLabel}, jejichž nejlepší odhad 1RM nepřekonal maximum z předchozích 12 týdnů o 1 %. Stagnace je do −3 %, níže už je výkon pod dřívějším maximem.</p>
        ${platList}
        <p class="muted note">Při stagnaci zvaž lehčí týden (deload) nebo změnu rozsahu opakování. Jde o orientační pravidlo podle odhadů 1RM, ne o jistotu: odhad kolísá s RIR a počtem opakování.</p>
      </section>
      <section class="card">
        <h2>Stagnace svalů</h2>
        <p class="muted tiny">Stejné období jako výše (${stagLabel}). Sval se bere jako vážený průměr změny cviků, které splňují stejná pravidla jako u stagnace cviků. Zobrazené jsou svaly, jejichž průměr nepřekonal předchozí maximum o 1 %; nejhorší nahoře.</p>
        ${musclePlatList}
        <p class="muted note">Hlavní sval má váhu 1, pomocný 0,5 (podle tabulky cviků). Sval bez cviků s dostatkem tréninků se nehodnotí, takže tu nemusí být všechny.</p>
      </section>
      <section class="card">
        <h2>Svaly podle posledních maxim</h2>
        <p class="muted tiny">Změna nejlepšího odhadu 1RM za poslední 4 týdny oproti nejlepšímu z předchozích 12 týdnů. Nahoře svaly, kde se zlepšuješ nejvíc.</p>
        ${rankList}
        <p class="muted note">Počítá se vážený průměr cviků daného svalu (hlavní sval 1, pomocný 0,5) a jen cviky s aspoň 2 tréninky v obou obdobích.</p>
      </section>
      <section class="card">
        <h2>Nová maxima</h2>
        <p class="muted tiny">Posledních 5 cviků, u kterých odhad 1RM překonal všechny dřívější tréninky aspoň o 1 %. U každého cviku se ukazuje jen jeho nejnovější maximum.</p>
        ${recList}
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
