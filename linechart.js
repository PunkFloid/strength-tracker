// linechart.js - jednoduchý SVG čárový graf ve stylu Fitbodu
const LineChart = (() => {
  const H = 236, LEFT = 6, RIGHT = 36, TOP = 12, BOTTOM = 36;
  const fmt0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });

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
  function render(data, period, wide) {
    const W = wide ? 640 : 360;
    const n = data.buckets.length;
    if (!data.points.length || !n) return '';
    const ticks = ticksFor(data.min, data.max);
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const pw = W - LEFT - RIGHT, ph = H - TOP - BOTTOM;
    const colW = pw / n;
    const xC = i => LEFT + colW * (i + 0.5);
    const y = v => TOP + ph - ((v - yMin) / (yMax - yMin)) * ph;

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
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
    // čára a body
    const pts = data.buckets.map((b, i) => (b.value === null ? null : { x: xC(i), y: y(b.value), est: b.estimated })).filter(Boolean);
    if (pts.length > 1) svg += `<polyline points="${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" class="line"/>`;
    for (const p of pts) svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" class="${p.est ? 'dot est' : 'dot'}"/>`;
    return svg + '</svg>';
  }

  return { render };
})();
if (typeof module !== 'undefined') module.exports = LineChart;