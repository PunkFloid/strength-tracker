// body.js - váha a složení těla (export z váhy Megafit): denní průměry, vyhlazení, body pro graf
const Body = (() => {
  const METRICS = {
    weight: { label: 'Váha', unit: 'kg', delta: 'kg', col: 'Hmotnost(kg)' },
    fat: { label: 'Tuk', unit: '%', delta: 'b.', col: 'Tělesný tuk(%)' },
    lean: { label: 'Lean mass', unit: 'kg', delta: 'kg', col: 'Hmotnost bez tuku(kg)' }
  };
  // vyhlazení: poločas exponenciálního průměru ve dnech (0 = bez vyhlazení, v grafu průměr za období)
  const SMOOTHING = [['raw', 'Bez'], ['light', 'Slabé'], ['medium', 'Střední'], ['strong', 'Silné']];
  const HALF_LIFE = { raw: 0, light: 5, medium: 10, strong: 21 };
  const MAX_STALE_DAYS = 14;   // bod grafu se nevykreslí, pokud poslední vážení je starší než tolik dní
  const DAY = 86400000;

  const num = v => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(String(v).trim().replace(',', '.'));
    return isNaN(n) ? null : n;
  };
  const toNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const toDate = n => { const d = new Date(n * DAY); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // denní průměry (někdy je v jednom dni víc vážení)
  function daily(rows) {
    const byDay = new Map();
    for (const r of rows) {
      const day = Parser.czechDay(r['Čas vážení']);
      if (!day) continue;
      if (!byDay.has(day)) byDay.set(day, { day, sum: {}, cnt: {} });
      const o = byDay.get(day);
      for (const [k, m] of Object.entries(METRICS)) {
        const v = num(r[m.col]);
        if (v !== null) { o.sum[k] = (o.sum[k] || 0) + v; o.cnt[k] = (o.cnt[k] || 0) + 1; }
      }
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(o => {
      const p = { day: o.day, t: toNum(o.day) };
      for (const k of Object.keys(METRICS)) p[k] = o.cnt[k] ? o.sum[k] / o.cnt[k] : null;
      return p;
    });
  }

  // exponenciální průměr s nepravidelnými mezerami mezi vážením
  function smooth(points, metric, halfLife) {
    const out = [];
    let val = null, prevT = null;
    for (const p of points) {
      const x = p[metric];
      if (x === null) continue;
      if (halfLife <= 0 || val === null) val = x;
      else val += (1 - Math.pow(0.5, (p.t - prevT) / halfLife)) * (x - val);
      prevT = p.t;
      out.push({ t: p.t, raw: x, value: val });
    }
    return out;
  }

  // body grafu: 3M po týdnech, 1Y a All po měsících (stejně jako u cviků)
  function series(rows, metric, smoothing, period, today) {
    const pts = smooth(daily(rows), metric, HALF_LIFE[smoothing]);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let from;
    const buckets = [];
    if (period === '3M') {
      from = new Date(end.getFullYear(), end.getMonth() - 3, end.getDate());
      const start = new Date(from);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // pondělí
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
        buckets.push({ start: new Date(d), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6) });
      }
    } else {
      from = period === '1Y'
        ? new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())
        : (pts.length ? toDate(pts[0].t) : end);
      for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        buckets.push({ start: new Date(d), end: new Date(d.getFullYear(), d.getMonth() + 1, 0) });
      }
    }
    for (const b of buckets) {
      const s = toNum(dayKey(b.start)), e = Math.min(toNum(dayKey(b.end)), toNum(dayKey(end)));
      b.value = null; b.estimated = false; b.at = null;
      if (smoothing === 'raw') {
        const inB = pts.filter(p => p.t >= s && p.t <= e);
        if (inB.length) { b.value = inB.reduce((a, p) => a + p.raw, 0) / inB.length; b.at = inB[inB.length - 1].t; }
      } else {
        let last = null;
        for (const p of pts) if (p.t <= e) last = p; else break;
        if (last && last.t >= s - MAX_STALE_DAYS) { b.value = last.value; b.at = last.t; }
      }
    }
    const points = buckets.filter(b => b.value !== null);
    const values = points.map(p => p.value);
    const first = points[0] || null, last = points[points.length - 1] || null;
    const months = first && last ? (last.at - first.at) / 30.44 : 0;
    const change = first && last ? last.value - first.value : null;
    return {
      from, end, buckets, points,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      change, perMonth: months > 0.25 ? change / months : null,
      current: last ? last.value : null,
      latestRaw: (() => { const raw = smooth(daily(rows), metric, 0); const r = raw[raw.length - 1]; return r ? { day: toDate(r.t), value: r.raw } : null; })()
    };
  }

  return { METRICS, SMOOTHING, daily, series };
})();
if (typeof module !== 'undefined') module.exports = Body;