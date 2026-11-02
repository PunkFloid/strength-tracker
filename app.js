// app.js - import souborů, ukládání dat, synchronizace přes GitHub, skóre síly, odhad 1RM a tělesné složení
const FORMAT_NAMES = {
  macrofactor: 'MacroFactor (Workout Log)',
  old: 'Starý export (WorkoutExport)',
  body: 'Váha a složení těla (Megafit)',
  unknown: 'Neznámý formát'
};
const FORMATS = ['macrofactor', 'old', 'body'];

const saved = { macrofactor: null, old: null, body: null };   // uložené řádky z exportů
const loaded = { macrofactor: null, old: null };  // z nich spočítané série
let mergedSets = [];
let strengthResults = null;
let storageNote = '';
let syncConfig = null;     // { repo, token, auto, lastSync } - jen v tomto zařízení
let syncPromise = null;    // běžící synchronizace
let syncMsg = { text: '', kind: '' };
let lastAutoSync = 0;
const e1rmState = { exercise: null, period: '1Y' };
const strengthState = { key: 'overall', period: '1Y', mode: 'form' };
const bodyState = { metric: 'weight', period: '1Y', smooth: 'medium' };
const PERIODS = [['3M', '3 měsíce'], ['1Y', 'Rok'], ['All', 'Vše']];
const MODES = [['form', 'Forma'], ['max', 'Maximum']];
const numFmt = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const dateFmt = d => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
const dateTimeFmt = d => `${dateFmt(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const isoToCz = iso => (iso ? dateFmt(new Date(iso)) : '?');
const wideQuery = window.matchMedia('(min-width: 900px)');

const dayOf = {
  macrofactor: r => (r['Date'] || '').slice(0, 10),
  old: r => Parser.pragueDay(r['Date']),
  body: r => Parser.czechDay(r['Čas vážení'])
};

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const results = document.getElementById('results');
const storageBox = document.getElementById('storage');
const mergedBox = document.getElementById('merged');
const strengthBox = document.getElementById('strength');
const e1rmBox = document.getElementById('e1rm');
const bodyBox = document.getElementById('bodycomp');
const syncBox = document.getElementById('sync');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
['dragenter', 'dragover'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('hover'); }));
['dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('hover'); }));
dropzone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
wideQuery.addEventListener('change', () => { renderStrength(); renderE1rm(); renderBody(); });
// po návratu do apky (např. z pozadí na iPhonu) se data znovu synchronizují
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });

// ---------- ukládání ----------

// dny z nového souboru nahradí stejné dny v uložených datech, ostatní dny zůstanou
function mergeByDay(existing, incoming, getDay) {
  const newDays = new Set(incoming.map(getDay));
  return existing.filter(r => !newDays.has(getDay(r))).concat(incoming);
}

async function addRows(format, rows, fileName) {
  const cur = saved[format] || { rows: [], files: [] };
  const next = {
    rows: mergeByDay(cur.rows, rows, dayOf[format]),
    updatedAt: new Date().toISOString(),
    files: [...new Set([...(cur.files || []), fileName])].slice(-10)
  };
  await Store.set('rows:' + format, next);
  saved[format] = next;
  rebuild();
}

function rebuild() {
  loaded.macrofactor = saved.macrofactor ? Normalize.fromMacroFactor(saved.macrofactor.rows) : null;
  loaded.old = saved.old ? Normalize.fromOld(saved.old.rows) : null;
}

async function restore() {
  try {
    for (const f of FORMATS) saved[f] = (await Store.get('rows:' + f)) || null;
    syncConfig = (await Store.get('sync:config')) || null;
    await Store.requestPersistent();
  } catch (err) {
    storageNote = 'Ukládání v tomto prohlížeči není dostupné (' + err.message + '). Data se po zavření stránky ztratí.';
  }
  rebuild();
  renderStorage();
  renderMerged();
  renderBody();
  renderSync();
  autoSync(true);
}

async function clearAll() {
  const extra = syncConfig ? ' Data v GitHubu zůstanou a při příští synchronizaci se sem vrátí.' : '';
  if (!confirm('Opravdu smazat všechna data uložená v tomto zařízení?' + extra)) return;
  for (const f of FORMATS) { await Store.remove('rows:' + f); saved[f] = null; }
  rebuild();
  mergedSets = [];
  strengthResults = null;
  mergedBox.innerHTML = '';
  strengthBox.innerHTML = '';
  e1rmBox.innerHTML = '';
  bodyBox.innerHTML = '';
  renderStorage();
}

async function backup() {
  const payload = { app: 'strength-tracker', version: 1, exportedAt: new Date().toISOString() };
  for (const f of FORMATS) payload[f] = saved[f] ? { rows: saved[f].rows } : null;
  const name = `strength-tracker-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function describeSaved(format) {
  const s = saved[format];
  if (!s || !s.rows.length) return `<li>${FORMAT_NAMES[format]}: zatím nic</li>`;
  const days = s.rows.map(dayOf[format]).filter(Boolean).sort();
  const nDays = new Set(days).size;
  return `<li>${FORMAT_NAMES[format]}: ${s.rows.length} řádků, ${nDays} dnů (${days[0]} až ${days[days.length - 1]}), naposledy ${isoToCz(s.updatedAt)}</li>`;
}

function renderStorage() {
  const any = FORMATS.some(f => saved[f] && saved[f].rows.length);
  storageBox.innerHTML = `
    <section class="card data">
      <h2>Data v tomto zařízení</h2>
      <ul>${FORMATS.map(describeSaved).join('')}</ul>
      ${storageNote ? `<p class="error">${escapeHtml(storageNote)}</p>` : ''}
      <div class="btns">
        <button id="backupBtn" ${any ? '' : 'disabled'}>Zálohovat (JSON)</button>
        <button id="clearBtn" class="danger" ${any ? '' : 'disabled'}>Smazat data</button>
      </div>
      <p class="muted note">Data jsou uložená v tomto prohlížeči a tomto zařízení. Apka na ploše iPhonu má úložiště oddělené od Safari. Mezi zařízeními je přenese synchronizace přes GitHub (karta výše) nebo záloha (JSON), kterou nahraješ do stejného pole jako CSV.</p>
    </section>`;
  storageBox.querySelector('#backupBtn').addEventListener('click', backup);
  storageBox.querySelector('#clearBtn').addEventListener('click', clearAll);
}

// ---------- synchronizace přes GitHub ----------

function setSyncMsg(text, kind) {
  syncMsg = { text, kind: kind || '' };
  const el = document.getElementById('syncMsg');
  if (el) { el.textContent = text; el.className = 'note ' + (kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : 'muted'); }
}

function renderSync() {
  const msgClass = 'note ' + (syncMsg.kind === 'error' ? 'error' : syncMsg.kind === 'ok' ? 'ok' : 'muted');
  if (!syncConfig) {
    syncBox.innerHTML = `
      <section class="card sync">
        <h2>Synchronizace přes GitHub</h2>
        <p class="muted">Data se uloží do tvého soukromého repozitáře a stáhnou se do každého zařízení, kde zadáš stejný repozitář a token.</p>
        <input id="syncRepo" class="input" placeholder="uživatel/repozitář, např. PunkFloid/strength-tracker-data" autocapitalize="off" autocorrect="off" spellcheck="false">
        <input id="syncToken" class="input" type="password" placeholder="Token (začíná github_pat_)" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="btns"><button id="syncConnect">Připojit a synchronizovat</button></div>
        <p id="syncMsg" class="${msgClass}">${escapeHtml(syncMsg.text)}</p>
      </section>`;
    syncBox.querySelector('#syncConnect').addEventListener('click', connectSync);
    return;
  }
  const busy = !!syncPromise;
  syncBox.innerHTML = `
    <section class="card sync">
      <h2>Synchronizace přes GitHub</h2>
      <p class="muted">Repozitář: <b>${escapeHtml(syncConfig.repo)}</b></p>
      <p class="muted">Poslední synchronizace: ${syncConfig.lastSync ? dateTimeFmt(new Date(syncConfig.lastSync)) : 'zatím žádná'}</p>
      <label class="check"><input type="checkbox" id="syncAuto" ${syncConfig.auto ? 'checked' : ''}> <span>Synchronizovat automaticky při otevření apky a po importu souboru</span></label>
      <div class="btns">
        <button id="syncNow" ${busy ? 'disabled' : ''}>${busy ? 'Synchronizuji…' : 'Synchronizovat'}</button>
        <button id="syncOff" class="danger" ${busy ? 'disabled' : ''}>Odpojit</button>
      </div>
      <p id="syncMsg" class="${msgClass}">${escapeHtml(syncMsg.text)}</p>
      <p class="muted note">Token je uložený jen v tomto zařízení (není v záloze ani ve veřejném repozitáři). Stejná data se slučují po dnech, takže nic nezdvojíš. Smazání dat v zařízení neodstraní data z GitHubu.</p>
    </section>`;
  syncBox.querySelector('#syncNow').addEventListener('click', () => runSync());
  syncBox.querySelector('#syncOff').addEventListener('click', disconnectSync);
  syncBox.querySelector('#syncAuto').addEventListener('change', async e => {
    syncConfig.auto = e.target.checked;
    await Store.set('sync:config', syncConfig);
  });
}

// stáhne z GitHubu nová data, nahraje tam nová data z tohoto zařízení a uloží výsledek
async function doSync(cfg) {
  const res = await Sync.sync(cfg, saved, FORMATS, dayOf);
  for (const [f, obj] of Object.entries(res.updates)) {
    await Store.set('rows:' + f, obj);
    saved[f] = obj;
  }
  if (Object.keys(res.updates).length) {
    rebuild();
    renderStorage();
    renderMerged();
    renderBody();
  }
  return res.summary;
}

function runSync() {
  if (!syncConfig || syncPromise) return syncPromise;
  setSyncMsg('Synchronizuji…', '');
  syncPromise = (async () => {
    try {
      const summary = await doSync(syncConfig);
      syncConfig.lastSync = new Date().toISOString();
      await Store.set('sync:config', syncConfig);
      setSyncMsg(summary, 'ok');
    } catch (err) {
      setSyncMsg(Sync.explain(err), err && err.offline ? '' : 'error');
    }
  })().finally(() => { syncPromise = null; renderSync(); });
  renderSync();
  return syncPromise;
}

function autoSync(force) {
  if (!syncConfig || !syncConfig.auto) return;
  if (!force && Date.now() - lastAutoSync < 60000) return;
  lastAutoSync = Date.now();
  runSync();
}

async function connectSync() {
  if (syncPromise) return;
  const repo = Sync.parseRepo(document.getElementById('syncRepo').value);
  const token = document.getElementById('syncToken').value.trim();
  if (!repo) { setSyncMsg('Zadej repozitář ve tvaru uživatel/repozitář.', 'error'); return; }
  if (!token) { setSyncMsg('Vlož token.', 'error'); return; }
  const button = document.getElementById('syncConnect');
  button.disabled = true;
  setSyncMsg('Ověřuji přístup a synchronizuji…', '');
  const cfg = { repo, token, auto: true, lastSync: null };
  syncPromise = (async () => {
    try {
      const summary = await doSync(cfg);
      cfg.lastSync = new Date().toISOString();
      await Store.set('sync:config', cfg);
      syncConfig = cfg;
      setSyncMsg(summary, 'ok');
    } catch (err) {
      setSyncMsg(Sync.explain(err), 'error');
    }
  })().finally(() => {
    syncPromise = null;
    if (syncConfig) renderSync();
    else { const b = document.getElementById('syncConnect'); if (b) b.disabled = false; }
  });
}

async function disconnectSync() {
  if (!confirm('Odpojit synchronizaci? Token se z tohoto zařízení smaže. Data v zařízení i v GitHubu zůstanou.')) return;
  await Store.remove('sync:config');
  syncConfig = null;
  syncMsg = { text: '', kind: '' };
  renderSync();
}

// ---------- import souborů ----------

async function handleFiles(fileList) {
  if (syncPromise) await syncPromise;   // počkáme, až doběhne synchronizace
  for (const file of fileList) {
    const card = document.createElement('section');
    card.className = 'card';
    results.prepend(card);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        card.innerHTML = `<h2>${escapeHtml(file.name)}</h2><p class="muted">Soubory .xlsx přidáme v jednom z dalších kroků. Teď použij prosím .csv.</p>`;
        continue;
      }
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        await importBackup(text, file.name, card);
      } else {
        const rows = Parser.parseCSV(text);
        const summary = Parser.summarize(rows);
        renderSummary(card, file.name, summary);
        if (summary.format !== 'unknown') {
          await addRows(summary.format, rows, file.name);
          card.insertAdjacentHTML('beforeend', '<p class="ok">Uloženo v tomto zařízení.</p>');
        }
      }
      renderStorage();
      renderMerged();
      renderBody();
    } catch (err) {
      card.innerHTML = `<h2>${escapeHtml(file.name)}</h2><p class="error">Soubor se nepodařilo přečíst: ${escapeHtml(err.message)}</p>`;
    }
  }
  fileInput.value = '';
  autoSync(true);
}

async function importBackup(text, fileName, card) {
  const data = JSON.parse(text);
  if (data.app !== 'strength-tracker') throw new Error('To není záloha z této aplikace.');
  let info = '';
  for (const f of FORMATS) {
    if (data[f] && Array.isArray(data[f].rows) && data[f].rows.length) {
      await addRows(f, data[f].rows, fileName);
      info += `<li>${FORMAT_NAMES[f]}: ${data[f].rows.length} řádků</li>`;
    }
  }
  card.innerHTML = `<h2>${escapeHtml(fileName)}</h2><p class="format old">Záloha</p><ul>${info || '<li>Záloha je prázdná.</li>'}</ul><p class="ok">Obnoveno do tohoto zařízení.</p>`;
}

// ---------- zobrazení ----------

function renderMerged() {
  if (!loaded.macrofactor && !loaded.old) {
    mergedSets = []; strengthResults = null;
    mergedBox.innerHTML = ''; strengthBox.innerHTML = ''; e1rmBox.innerHTML = '';
    return;
  }
  const merged = Normalize.merge(loaded.macrofactor || [], loaded.old || []);
  const stats = merged.stats;
  mergedSets = merged.sets;
  const mfOnly = !loaded.old, oldOnly = !loaded.macrofactor;
  const unmapped = stats.unmapped.length
    ? `<p class="error">Cviky bez záznamu v tabulce (${stats.unmapped.length}): ${stats.unmapped.map(escapeHtml).join(', ')}</p>`
    : `<p class="muted">Všechny názvy cviků jsou v tabulce cviků.</p>`;
  mergedBox.innerHTML = `
    <section class="card merged">
      <h2>Sloučená historie</h2>
      <p class="muted">${oldOnly ? 'Zatím jen starý export.' : mfOnly ? 'Zatím jen MacroFactor.' : 'MacroFactor má přednost, starý export doplňuje dny, které v něm chybí.'}</p>
      <div class="stats">
        <div><b>${stats.days}</b><span>tréninkových dnů</span></div>
        <div><b>${stats.totalSets}</b><span>sérií</span></div>
        <div><b>${stats.exercises}</b><span>cviků po sjednocení</span></div>
      </div>
      <p class="muted">Období: ${stats.minDay} až ${stats.maxDay}</p>
      <p class="muted">Dny z MacroFactoru: ${stats.daysMF} · dny jen ze starého exportu: ${stats.daysOldKept} · překrývající se dny (použit MacroFactor): ${stats.overlapDays}</p>
      <p class="muted">Série použitelné pro odhad 1RM: <b>${stats.eligibleSets}</b> (z toho odhad RIR ze starého exportu: ${stats.eligibleFromOld}, doplněné RIR u nohou: ${stats.eligibleLegsAssumed}) u <b>${stats.eligibleExercises}</b> cviků.</p>
      ${unmapped}
    </section>`;
  const today = new Date();
  strengthResults = { form: Strength.compute(mergedSets, today, 'form'), max: Strength.compute(mergedSets, today, 'max') };
  renderStrength();
  renderE1rm();
}

function renderStrength() {
  if (!strengthResults || !strengthResults[strengthState.mode]) { strengthBox.innerHTML = ''; return; }
  const keys = [['overall', 'Overall'], ...Muscles.LIST];
  const key = strengthState.key;
  const today = new Date();

  // obě varianty (Forma i Maximum) se počítají vždy a osa Y je pro ně společná
  const byMode = {};
  for (const [m] of MODES) byMode[m] = E1rm.series(Strength.sessionsFor(strengthResults[m], key), strengthState.period, today);
  const withData = Object.values(byMode).filter(d => d.points.length > 0);
  const yRange = withData.length ? { min: Math.min(...withData.map(d => d.min)), max: Math.max(...withData.map(d => d.max)) } : null;

  const data = byMode[strengthState.mode];
  const hasData = data.points.length > 0;
  const lo = hasData ? intFmt.format(data.min) : '–';
  const hi = hasData ? intFmt.format(data.max) : '–';
  const range = !hasData ? '–' : (lo === hi ? lo : `${lo}–${hi}`);
  const result = strengthResults[strengthState.mode];
  const vals = key === 'overall' ? result.overall : result.muscles[key];
  const current = vals[vals.length - 1];
  const modeNote = strengthState.mode === 'form'
    ? 'Forma: výkon z posledních tří tréninků cviku (nejnovější váží nejvíc), nový rekord ji zvedne výrazněji a po týdnu bez cviku klesá o 3 % týdně (nejvýš o 30 %). Vidíš tedy dopad pauz i slabších tréninků.'
    : 'Maximum: nejlepší výkon cviku v klouzavém okně. Pauzy skóre nesnižují.';

  strengthBox.innerHTML = `
    <section class="card strength">
      <h2>Skóre síly</h2>
      <select id="strengthSelect" class="select">
        ${keys.map(([k, label]) => `<option value="${k}"${k === key ? ' selected' : ''}>${label}</option>`).join('')}
      </select>
      <div class="seg" data-kind="period">
        ${PERIODS.map(([k, label]) => `<button data-period="${k}" class="${k === strengthState.period ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <div class="seg" data-kind="mode">
        ${MODES.map(([k, label]) => `<button data-mode="${k}" class="${k === strengthState.mode ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <p class="eyebrow">SKÓRE SÍLY · ${strengthState.mode === 'form' ? 'FORMA' : 'MAXIMUM'}</p>
      <div class="big">${range} <small>bodů</small></div>
      <p class="muted">${dateFmt(data.from)} – ${dateFmt(data.end)}</p>
      ${hasData ? LineChart.render(data, strengthState.period, wideQuery.matches, yRange, v => intFmt.format(v) + ' bodů') : '<p class="muted pad">V tomto období nejsou data.</p>'}
      <div class="row"><span>Osobní rekord</span><b>${hasData ? intFmt.format(data.max) : '–'}</b></div>
      <div class="row"><span>Tvůj průměr</span><b>${hasData ? intFmt.format(data.avg) : '–'}</b></div>
      <div class="row"><span>Aktuálně</span><b>${current === null ? 'málo dat' : intFmt.format(current)}</b></div>
      <p class="muted note">${modeNote} Osa Y je pro Formu i Maximum stejná, takže je můžeš přímo porovnat. 50 bodů odpovídá průměru prvních čtyř týdnů od září 2025, hodnota 60 znamená o 20 % vyšší odhad síly. Týdny před 1. 9. 2025 jsou orientační (prázdné kolečko) a mohou být pod 50. Sval se zobrazí, jen když má v posledních 6 týdnech aspoň 6 pracovních sérií a aspoň jednu sérii s RIR. Starší týdny se po nahrání nových dat mohou lehce posunout.</p>
    </section>`;

  strengthBox.querySelector('#strengthSelect').addEventListener('change', e => { strengthState.key = e.target.value; renderStrength(); });
  strengthBox.querySelectorAll('.seg[data-kind="period"] button').forEach(b =>
    b.addEventListener('click', () => { strengthState.period = b.dataset.period; renderStrength(); }));
  strengthBox.querySelectorAll('.seg[data-kind="mode"] button').forEach(b =>
    b.addEventListener('click', () => { strengthState.mode = b.dataset.mode; renderStrength(); }));
}

function renderE1rm() {
  const list = E1rm.exerciseList(mergedSets);
  if (!list.length) { e1rmBox.innerHTML = ''; return; }
  if (!list.some(e => e.name === e1rmState.exercise)) e1rmState.exercise = list[0].name;
  const info = list.find(e => e.name === e1rmState.exercise);
  const data = E1rm.series(E1rm.sessions(mergedSets, info.name), e1rmState.period, new Date());
  const hasData = data.points.length > 0;
  const range = !hasData ? '–'
    : (numFmt.format(data.min) === numFmt.format(data.max) ? numFmt.format(data.min) : `${numFmt.format(data.min)}–${numFmt.format(data.max)}`);

  e1rmBox.innerHTML = `
    <section class="card e1rm">
      <h2>Odhad 1RM</h2>
      <select id="e1rmSelect" class="select">
        ${list.map(e => `<option value="${escapeHtml(e.name)}"${e.name === info.name ? ' selected' : ''}>${escapeHtml(e.name)} (${e.sessions})</option>`).join('')}
      </select>
      <div class="seg">
        ${PERIODS.map(([k, label]) => `<button data-period="${k}" class="${k === e1rmState.period ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <p class="eyebrow">ODHAD 1RM${info.perHand ? ' · NA JEDNU ČINKU' : ''}</p>
      <div class="big">${range} <small>kg v 1 opakování</small></div>
      <p class="muted">${dateFmt(data.from)} – ${dateFmt(data.end)}</p>
      ${hasData ? LineChart.render(data, e1rmState.period, wideQuery.matches, v => numFmt.format(v) + ' kg') : '<p class="muted pad">V tomto období nejsou data.</p>'}
      <div class="row"><span>Osobní rekord</span><b>${hasData ? numFmt.format(data.pr) + ' kg' : '–'}</b></div>
      <div class="row"><span>Tvůj průměr</span><b>${hasData ? numFmt.format(data.avg) + ' kg' : '–'}</b></div>
      <p class="muted note">Každý bod je nejlepší výkon v týdnu (3 měsíce) nebo v měsíci. Prázdné kolečko znamená, že hodnota vychází z odhadnutého RIR (starý export a nohy bez RIR).</p>
    </section>`;

  e1rmBox.querySelector('#e1rmSelect').addEventListener('change', e => { e1rmState.exercise = e.target.value; renderE1rm(); });
  e1rmBox.querySelectorAll('.seg button').forEach(b =>
    b.addEventListener('click', () => { e1rmState.period = b.dataset.period; renderE1rm(); }));
}

function renderBody() {
  const s = saved.body;
  if (!s || !s.rows.length) { bodyBox.innerHTML = ''; return; }
  const today = new Date();
  const metric = bodyState.metric;
  const info = Body.METRICS[metric];

  // osa Y je společná pro obě varianty vyhlazení, aby se při přepínání nehýbala
  const variants = {};
  for (const [k] of Body.SMOOTHING) variants[k] = Body.series(s.rows, metric, k, bodyState.period, today);
  const withData = Object.values(variants).filter(d => d.points.length > 0);
  const yRange = withData.length ? { min: Math.min(...withData.map(d => d.min)), max: Math.max(...withData.map(d => d.max)) } : null;

  const data = variants[bodyState.smooth];
  const hasData = data.points.length > 0;
  const val = v => numFmt.format(v) + ' ' + info.unit;
  const signed = (d, unit) => `${d > 0.049 ? '+' : d < -0.049 ? '−' : '±'}${numFmt.format(Math.abs(d))} ${unit}`;
  const unitPer = bodyState.period === '3M' ? 'za týden' : 'za měsíc';
  // popisek bodu: hodnota + změna oproti předchozímu týdnu / měsíci
  const tipFmt = (v, b, prev) => val(v) + (prev ? ` · ${signed(v - prev.value, info.delta)} ${unitPer}` : '');
  const range = !hasData ? '–'
    : (numFmt.format(data.min) === numFmt.format(data.max) ? numFmt.format(data.min) : `${numFmt.format(data.min)}–${numFmt.format(data.max)}`);
  const smoothLabel = Body.SMOOTHING.find(x => x[0] === bodyState.smooth)[1];

  bodyBox.innerHTML = `
    <section class="card body">
      <h2>Váha a složení těla</h2>
      <div class="seg" data-kind="metric">
        ${Object.entries(Body.METRICS).map(([k, m]) => `<button data-metric="${k}" class="${k === metric ? 'on' : ''}">${m.label}</button>`).join('')}
      </div>
      <div class="seg" data-kind="period">
        ${PERIODS.map(([k, label]) => `<button data-period="${k}" class="${k === bodyState.period ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <div class="seg" data-kind="smooth">
        ${Body.SMOOTHING.map(([k, label]) => `<button data-smooth="${k}" class="${k === bodyState.smooth ? 'on' : ''}">${label}</button>`).join('')}
      </div>
      <p class="eyebrow">${info.label.toUpperCase()} · ${smoothLabel.toUpperCase()}</p>
      <div class="big">${range} <small>${info.unit}</small></div>
      <p class="muted">${dateFmt(data.from)} – ${dateFmt(data.end)}</p>
      ${hasData ? LineChart.render(data, bodyState.period, wideQuery.matches, yRange, tipFmt) : '<p class="muted pad">V tomto období nejsou data.</p>'}
      <div class="row"><span>Změna za období</span><b>${data.change === null ? '–' : signed(data.change, info.delta)}</b></div>
      <div class="row"><span>Průměrně za měsíc</span><b>${data.perMonth === null ? '–' : signed(data.perMonth, info.delta)}</b></div>
      <div class="row"><span>Aktuálně${bodyState.smooth === 'raw' ? ' (průměr posledního období)' : ' (vyhlazeně)'}</span><b>${data.current === null ? '–' : val(data.current)}</b></div>
      <div class="row"><span>Poslední vážení</span><b>${data.latestRaw ? `${val(data.latestRaw.value)} · ${dateFmt(data.latestRaw.day)}` : '–'}</b></div>
      <p class="muted note">Denní vážení silně kolísá (váha asi ±0,4 kg, tuk a lean mass ±0,7), proto je ve výchozím stavu zapnuté střední vyhlazení: exponenciální průměr s poločasem 10 dní. Bez vyhlazení je bod grafu průměr všech vážení za týden (3 měsíce) nebo za měsíc. Klepnutím na bod uvidíš hodnotu a změnu oproti předchozímu týdnu nebo měsíci. Změna tuku je v procentních bodech (b.). Lean mass je hmotnost bez tuku z bioimpedance a ovlivňuje ji hydratace.</p>
    </section>`;

  bodyBox.querySelectorAll('.seg[data-kind="metric"] button').forEach(b =>
    b.addEventListener('click', () => { bodyState.metric = b.dataset.metric; renderBody(); }));
  bodyBox.querySelectorAll('.seg[data-kind="period"] button').forEach(b =>
    b.addEventListener('click', () => { bodyState.period = b.dataset.period; renderBody(); }));
  bodyBox.querySelectorAll('.seg[data-kind="smooth"] button').forEach(b =>
    b.addEventListener('click', () => { bodyState.smooth = b.dataset.smooth; renderBody(); }));
}

function renderSummary(card, name, s) {
  if (s.format === 'body') {
    card.innerHTML = `
      <h2>${escapeHtml(name)}</h2>
      <p class="format ${s.format}">${FORMAT_NAMES[s.format]}</p>
      <div class="stats">
        <div><b>${s.rowCount}</b><span>vážení</span></div>
        <div><b>${s.dayCount}</b><span>dnů</span></div>
      </div>
      <p class="muted">Období: ${s.minDay || '?'} až ${s.maxDay || '?'}</p>`;
    return;
  }
  const top = Object.entries(s.exercises).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const types = Object.entries(s.setTypes).sort((a, b) => b[1] - a[1]);
  card.innerHTML = `
    <h2>${escapeHtml(name)}</h2>
    <p class="format ${s.format}">${FORMAT_NAMES[s.format]}</p>
    <div class="stats">
      <div><b>${s.rowCount}</b><span>řádků</span></div>
      <div><b>${s.dayCount}</b><span>dnů</span></div>
      <div><b>${Object.keys(s.exercises).length}</b><span>cviků</span></div>
    </div>
    <p class="muted">Období: ${s.minDay || '?'} až ${s.maxDay || '?'}</p>
    <h3>Typy sérií</h3>
    <p class="muted">${types.map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(' · ')}</p>
    <h3>Nejčastější cviky</h3>
    <ul>${top.map(([k, v]) => `<li>${escapeHtml(k)} <span class="muted">(${v})</span></li>`).join('')}</ul>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

restore();