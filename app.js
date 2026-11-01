// app.js - import souborů, ukládání dat, skóre síly a odhad 1RM
const FORMAT_NAMES = {
  macrofactor: 'MacroFactor (Workout Log)',
  old: 'Starý export (WorkoutExport)',
  unknown: 'Neznámý formát'
};
const FORMATS = ['macrofactor', 'old'];

const saved = { macrofactor: null, old: null };   // uložené řádky z exportů
const loaded = { macrofactor: null, old: null };  // z nich spočítané série
let mergedSets = [];
let strengthResults = null;
let storageNote = '';
const e1rmState = { exercise: null, period: '1Y' };
const strengthState = { key: 'overall', period: '1Y', mode: 'form' };
const PERIODS = [['3M', '3 měsíce'], ['1Y', 'Rok'], ['All', 'Vše']];
const MODES = [['form', 'Forma'], ['max', 'Maximum']];
const numFmt = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const dateFmt = d => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
const isoToCz = iso => (iso ? dateFmt(new Date(iso)) : '?');
const wideQuery = window.matchMedia('(min-width: 900px)');

const dayOf = {
  macrofactor: r => (r['Date'] || '').slice(0, 10),
  old: r => Parser.pragueDay(r['Date'])
};

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const results = document.getElementById('results');
const storageBox = document.getElementById('storage');
const mergedBox = document.getElementById('merged');
const strengthBox = document.getElementById('strength');
const e1rmBox = document.getElementById('e1rm');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
['dragenter', 'dragover'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('hover'); }));
['dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('hover'); }));
dropzone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
wideQuery.addEventListener('change', () => { renderStrength(); renderE1rm(); });

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
    await Store.requestPersistent();
  } catch (err) {
    storageNote = 'Ukládání v tomto prohlížeči není dostupné (' + err.message + '). Data se po zavření stránky ztratí.';
  }
  rebuild();
  renderStorage();
  renderMerged();
}

async function clearAll() {
  if (!confirm('Opravdu smazat všechna data uložená v tomto zařízení?')) return;
  for (const f of FORMATS) { await Store.remove('rows:' + f); saved[f] = null; }
  rebuild();
  mergedSets = [];
  strengthResults = null;
  mergedBox.innerHTML = '';
  strengthBox.innerHTML = '';
  e1rmBox.innerHTML = '';
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
      <p class="muted note">Data jsou uložená jen v tomto prohlížeči a tomto zařízení. Mac a iPhone mají každý vlastní kopii a apka na ploše iPhonu má úložiště oddělené od Safari. Zálohu (JSON) nahraješ do stejného pole jako CSV.</p>
    </section>`;
  storageBox.querySelector('#backupBtn').addEventListener('click', backup);
  storageBox.querySelector('#clearBtn').addEventListener('click', clearAll);
}

// ---------- import souborů ----------

async function handleFiles(fileList) {
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
    } catch (err) {
      card.innerHTML = `<h2>${escapeHtml(file.name)}</h2><p class="error">Soubor se nepodařilo přečíst: ${escapeHtml(err.message)}</p>`;
    }
  }
  fileInput.value = '';
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

function renderSummary(card, name, s) {
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