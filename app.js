// app.js - obrazovka pro import souborů
const FORMAT_NAMES = {
  macrofactor: 'MacroFactor (Workout Log)',
  old: 'Starý export (WorkoutExport)',
  unknown: 'Neznámý formát'
};

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const results = document.getElementById('results');

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
      renderSummary(card, file.name, Parser.summarize(rows));
    } catch (err) {
      card.innerHTML = `<h2>${escapeHtml(file.name)}</h2><p class="error">Soubor se nepodařilo přečíst: ${escapeHtml(err.message)}</p>`;
    }
  }
  fileInput.value = '';
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