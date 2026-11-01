// app.js - import souborů, sloučená historie a graf odhadu 1RM
const FORMAT_NAMES = {
  macrofactor: 'MacroFactor (Workout Log)',
  old: 'Starý export (WorkoutExport)',
  unknown: 'Neznámý formát'
};

const loaded = { macrofactor: null, old: null };
let mergedSets = [];
const e1rmState = { exercise: null, period: '1Y' };
const PERIODS = [['3M', '3 měsíce'], ['1Y', 'Rok'], ['All', 'Vše']];
const numFmt = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFmt = d => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const results = document.getElementById('results');
const mergedBox = document.getElementById('merged');
const e1rmBox = document.getElementById('e1rm');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
['dragenter', 'dragover'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('hover'); }));
['dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('hover'); }));
dropzone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

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
      const rows = Parser.parseCSV(text);
      const summary = Parser.summarize(rows);
      if (summary.format === 'macrofactor') loaded.macrofactor = Normalize.fromMacroFactor(rows);
      if (summary.format === 'old') loaded.old = Normalize.fromOld(rows);
      renderSummary(card, file.name, summary);
      renderMerged();
    } catch (err) {
      card.innerHTML = `<h2>${escapeHtml(file.name)}</h2><p class="error">Soubor se nepodařilo přečíst: ${escapeHtml(err.message)}</p>`;
    }
  }
  fileInput.value = '';
}

function renderMerged() {
  if (!loaded.macrofactor && !loaded.old) return;
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
      <p class="muted">Série použitelné pro odhad 1RM: <b>${stats.eligibleSets}</b> (z toho odhad RIR ze starého exportu: ${stats.eligibleFromOld}) u <b>${stats.eligibleExercises}</b> cviků</p>
      ${unmapped}
    </section>`;
  renderE1rm();
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
      ${hasData ? LineChart.render(data, e1rmState.period) : '<p class="muted pad">V tomto období nejsou data.</p>'}
      <div class="row"><span>Osobní rekord</span><b>${hasData ? numFmt.format(data.pr) + ' kg' : '–'}</b></div>
      <div class="row"><span>Tvůj průměr</span><b>${hasData ? numFmt.format(data.avg) + ' kg' : '–'}</b></div>
      <p class="muted note">Každý bod je nejlepší výkon v týdnu (3 měsíce) nebo v měsíci. Prázdné kolečko znamená, že hodnota vychází z odhadnutého RIR ze starého exportu.</p>
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