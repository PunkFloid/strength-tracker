// calendar.js - počet tréninků v čase a pauzy mezi nimi
const Calendar = (() => {
  const PAUSE_MIN_DAYS = 7;    // pauza = aspoň tolik dní po sobě bez tréninku
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diffDays = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

  // dny, ve kterých je zaznamenaná aspoň jedna série
  function trainingDays(sets) {
    return [...new Set(sets.map(s => s.day))].filter(Boolean).sort();
  }

  // týdenní počty tréninků (týden začíná v pondělí) a pauzy za zvolené období
  function weekly(days, period, today) {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let from;
    if (period === '3M') from = new Date(end.getFullYear(), end.getMonth() - 3, end.getDate());
    else if (period === '1Y') from = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
    else from = days.length ? parseDay(days[0]) : end;
    const fromKey = dayKey(from), endKey = dayKey(end);

    const start = new Date(from);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));   // pondělí
    const buckets = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      buckets.push({ start: new Date(d), end: addDays(d, 6), count: 0 });
    }
    let total = 0;
    for (const day of days) {
      if (day < fromKey || day > endKey) continue;
      total++;
      const dd = parseDay(day);
      const b = buckets[Math.floor(diffDays(start, dd) / 7)];
      if (b) b.count++;
    }

    // pauzy: souvislé úseky aspoň PAUSE_MIN_DAYS dní bez tréninku
    const pauses = [];
    const all = days.map(parseDay);
    for (let i = 1; i < all.length; i++) {
      const rest = diffDays(all[i - 1], all[i]) - 1;
      if (rest >= PAUSE_MIN_DAYS) pauses.push({ from: addDays(all[i - 1], 1), to: addDays(all[i], -1), rest, ongoing: false });
    }
    if (all.length) {
      const sinceLast = diffDays(all[all.length - 1], end);
      if (sinceLast >= PAUSE_MIN_DAYS + 1) pauses.push({ from: addDays(all[all.length - 1], 1), to: end, rest: sinceLast, ongoing: true });
    }
    const inRange = pauses.filter(p => dayKey(p.to) >= fromKey && dayKey(p.from) <= endKey);
    const span = diffDays(from, end) + 1;
    return {
      from, end, buckets, total,
      perWeek: span > 0 ? total / (span / 7) : 0,
      pauses: inRange,
      longest: inRange.reduce((m, p) => (!m || p.rest > m.rest ? p : m), null)
    };
  }

  return { trainingDays, weekly };
})();
if (typeof module !== 'undefined') module.exports = Calendar;