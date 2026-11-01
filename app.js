// app.js - obrazovka pro import souborů a sloučená historie
const FORMAT_NAMES = {
  macrofactor: 'MacroFactor (Workout Log)',
  old: 'Starý export (WorkoutExport)',
  unknown: 'Neznámý formát'
};

const loaded = { macrofactor: null, old: null };

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const results = document.getElementById('results');
const mergedBox = document.getElementById('merged');

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
  const { stats } = Normalize.merge(loaded.macrofactor || [], loaded.old || []);
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
      <div><b>${Object.keys(s.exercises).length}</b><span>cviků po sloučení</span></div>
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