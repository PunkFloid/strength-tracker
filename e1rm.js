// e1rm.js - odhad 1RM z jednotlivých sérií a příprava dat pro graf
const E1rm = (() => {
  const MAX_EFF_REPS = 15;   // efektivní opakování (opakování + RIR) se pro výpočet omezí na tuto hodnotu
  const MIN_SESSIONS = 3;    // cvik se v seznamu objeví, až má aspoň tolik tréninků

  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Epley: váha × (1 + efektivní opakování / 30); u dvojic činek na jednu ruku
  function setValue(s) {
    const eff = Math.min(s.reps + s.rir, MAX_EFF_REPS);
    return s.weight * (1 + eff / 30) * s.perHandFactor;
  }

  // nejlepší výkon cviku v každém dni
  function sessions(sets, exercise) {
    const byDay = new Map();
    for (const s of sets) {
      if (!s.eligible || s.exercise !== exercise) continue;
      const v = setValue(s);
      const cur = byDay.get(s.day);
      if (!cur || v > cur.value) byDay.set(s.day, { day: s.day, value: v, estimated: s.rirEstimated });
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  function exerciseList(sets) {
    const info = new Map();
    for (const s of sets) {
      if (!s.eligible) continue;
      if (!info.has(s.exercise)) info.set(s.exercise, { days: new Set(), perHand: s.load === 'pair' });
      info.get(s.exercise).days.add(s.day);
    }
    return [...info]
      .map(([name, i]) => ({ name, sessions: i.days.size, perHand: i.perHand }))
      .filter(e => e.sessions >= MIN_SESSIONS)
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  }

  // body grafu: 3M po týdnech, 1Y a All po měsících; bod = nejlepší výkon v období
  function series(sess, period, today) {
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
        : (sess.length ? parseDay(sess[0].day) : end);
      for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        buckets.push({ start: new Date(d), end: new Date(d.getFullYear(), d.getMonth() + 1, 0) });
      }
    }
    const fromKey = dayKey(from), endKey = dayKey(end);
    const inRange = sess.filter(s => s.day >= fromKey && s.day <= endKey);
    for (const b of buckets) {
      const a = dayKey(b.start), z = dayKey(b.end);
      let best = null;
      for (const s of inRange) if (s.day >= a && s.day <= z && (!best || s.value > best.value)) best = s;
      b.value = best ? best.value : null;
      b.estimated = best ? best.estimated : false;
    }
    const points = buckets.filter(b => b.value !== null);
    const values = points.map(p => p.value);
    return {
      from, end, buckets, points,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      pr: inRange.length ? Math.max(...inRange.map(s => s.value)) : null
    };
  }

  return { sessions, exerciseList, series, setValue };
})();
if (typeof module !== 'undefined') module.exports = E1rm;