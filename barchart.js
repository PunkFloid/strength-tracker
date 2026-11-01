// barchart.js - jednoduchý SVG sloupcový graf (počet tréninků za týden)
const BarChart = (() => {
  const H = 200, LEFT = 6, RIGHT = 36, TOP = 12, BOTTOM = 36;

  function render(data, wide) {
    const W = wide ? 640 : 360;
    const n = data.buckets.length;
    if (!n) return '';
    const yMax = Math.max(3, ...data.buckets.map(b => b.count));
    const pw = W - LEFT - RIGHT, ph = H - TOP - BOTTOM;
    const colW = pw / n;
    const y = v => TOP + ph - (v / yMax) * ph;

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
    for (let v = 0; v <= yMax; v++) {
      svg += `<line x1="${LEFT}" y1="${y(v)}" x2="${LEFT + pw}" y2="${y(v)}" class="grid"/>`;
      svg += `<text x="${W - RIGHT + 6}" y="${y(v) + 4}" class="axis">${v}</text>`;
    }
    let lastMonth = -1;
    data.buckets.forEach((b, i) => {
      const x = LEFT + colW * i;
      if (b.count === 0) svg += `<rect x="${x}" y="${TOP}" width="${colW}" height="${ph}" class="gapbar"/>`;
      else svg += `<rect x="${x + colW * 0.15}" y="${y(b.count)}" width="${colW * 0.7}" height="${TOP + ph - y(b.count)}" rx="2" class="bar"/>`;
      const m = b.start.getMonth();
      if (m !== lastMonth) {
        svg += `<text x="${x + colW / 2}" y="${H - 20}" text-anchor="middle" class="axis">${m + 1}</text>`;
        if (m === 0 || i === 0) svg += `<text x="${x + colW / 2}" y="${H - 7}" text-anchor="middle" class="axis small">’${String(b.start.getFullYear()).slice(2)}</text>`;
        lastMonth = m;
      }
    });
    return svg + '</svg>';
  }

  return { render };
})();
if (typeof module !== 'undefined') module.exports = BarChart;