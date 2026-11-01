// linechart.js - jednoduchý SVG čárový graf ve stylu Fitbodu (s popiskem hodnoty nad grafem)
const LineChart = (() => {
  const H = 236, LEFT = 6, RIGHT = 36, TOP = 12, BOTTOM = 36;
  const fmt0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
  const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const HINT = 'Najeď na bod (na iPhonu na něj klepni) a zobrazí se hodnota.';
  const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function ticksFor(min, max) {
    if (max - min < 1e-9) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    const step = niceStep((max - min + 2 * pad) / 4);
    const lo = Math.floor((min - pad) / step) * step;
    const hi = Math.ceil((max + pad) / step) * step;
    const ticks = [];
    for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000);
    return ticks;
  }

  // wide = true: širší a nižší graf pro velké displeje (Mac, PC)
  // yRange = { min, max }: volitelný pevný rozsah osy Y (pro porovnání více grafů)
  // fmt = funkce, která z hodnoty udělá text do popisku (např. "31,2 kg")
  // Čtvrtý parametr může být buď yRange, nebo rovnou fmt; pátý je fmt.
  function render(data, period, wide, a, b) {
    const yRange = typeof a === 'function' ? null : a;
    const fmt = typeof a === 'function' ? a : b;
    const W = wide ? 640 : 360;
    const n = data.buckets.length;
    if (!data.points.length || !n) return '';
    const format = fmt || (v => fmt0.format(v));
    const ticks = ticksFor(yRange ? yRange.min : data.min, yRange ? yRange.max : data.max);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const pw = W - LEFT - RIGHT, ph = H - TOP - BOTTOM;
    const colW = pw / n;
    const xC = i => LEFT + colW * (i + 0.5);
    const y = v => TOP + ph - ((v - yMin) / (yMax - yMin)) * ph;

    let svg = `<p class="tip muted">${HINT}</p><svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
    for (let i = 0; i <= n; i++) {
      const x = LEFT + colW * i;
      svg += `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${TOP + ph}" class="grid"/>`;
    }
    for (const t of ticks) {
      svg += `<line x1="${LEFT}" y1="${y(t)}" x2="${LEFT + pw}" y2="${y(t)}" class="grid"/>`;
      svg += `<text x="${W - RIGHT + 6}" y="${y(t) + 4}" class="axis">${fmt0.format(t)}</text>`;
    }
    // popisky osy X: číslo měsíce, u ledna a prvního popisku navíc rok
    let lastMonth = -1;
    data.buckets.forEach((b, i) => {
      const m = b.start.getMonth();
      let show;
      if (period === '3M') { show = m !== lastMonth; lastMonth = m; }
      else show = n <= 16 || m % 3 === 0;
      if (!show) return;
      svg += `<text x="${xC(i)}" y="${H - 20}" text-anchor="middle" class="axis">${m + 1}</text>`;
      if (m === 0 || i === 0) {
        svg += `<text x="${xC(i)}" y="${H - 7}" text-anchor="middle" class="axis small">’${String(b.start.getFullYear()).slice(2)}</text>`;
      }
    });
    // čára
    const pts = data.buckets.map((b, i) => (b.value === null ? null : { x: xC(i), y: y(b.value), est: b.estimated, b })).filter(Boolean);
    if (pts.length > 1) svg += `<polyline points="${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" class="line"/>`;
    // body + neviditelné větší kolečko pro snadné najetí / klepnutí
    for (const p of pts) {
      const s = p.b.start;
      const label = period === '3M'
        ? `týden od ${s.getDate()}. ${s.getMonth() + 1}. ${s.getFullYear()}`
        : `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
      const tip = `${label} · ${format(p.b.value)}${p.est ? ' · odhad RIR' : ''}`;
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" class="${p.est ? 'dot est' : 'dot'}"/>`;
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="14" class="hit" data-tip="${attr(tip)}"/>`;
    }
    return svg + '</svg>';
  }

  // jedno společné ovládání pro všechny grafy: myš = najetí, dotyk = klepnutí
  if (typeof document !== 'undefined') {
    const hitOf = e => (e.target && e.target.closest ? e.target.closest('.hit') : null);
    const show = hit => {
      const card = hit.closest('.card');
      if (!card) return;
      const tip = card.querySelector('.tip');
      if (tip) { tip.textContent = hit.getAttribute('data-tip'); tip.classList.add('on'); }
      card.querySelectorAll('.chart .dot').forEach(d => d.classList.remove('sel'));
      if (hit.previousElementSibling) hit.previousElementSibling.classList.add('sel');
    };
    const reset = hit => {
      const card = hit.closest('.card');
      if (!card) return;
      const tip = card.querySelector('.tip');
      if (tip) { tip.textContent = HINT; tip.classList.remove('on'); }
      if (hit.previousElementSibling) hit.previousElementSibling.classList.remove('sel');
    };
    document.addEventListener('pointerover', e => { const h = hitOf(e); if (h && e.pointerType === 'mouse') show(h); });
    document.addEventListener('pointerout', e => { const h = hitOf(e); if (h && e.pointerType === 'mouse') reset(h); });
    document.addEventListener('click', e => { const h = hitOf(e); if (h) show(h); });
  }

  // attach už není potřeba (ovládání je společné), funkce zůstává kvůli starším voláním
  return { render, attach() {} };
})();
if (typeof module !== 'undefined') module.exports = LineChart;