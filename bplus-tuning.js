// bplus-tuning.js - kalibrace 1RM pro cviky horního těla + časová agregace Formy (B+)
// Vkládá se po e1rm.js, muscles.js a strength.js, ale před app.js.
const BPlusTuning = (() => {
  // Kalibrace vznikla z porovnání Dumbbell Bench Press s MacroFactorem a platí pro všechny cviky horního těla.
  // Cviky nohou (quads, hamstrings) a cviky mimo tabulku svalů používají původní Epley.
  const UPPER = { k: 2, maxEffectiveReps: 30 };

  const isUpperBody = name => {
    const w = Muscles.WEIGHTS[name];
    return !!w && !w.quads && !w.hamstrings;
  };

  const originalSetValue = E1rm.setValue;
  E1rm.setValue = function (s) {
    if (!isUpperBody(s.exercise)) return originalSetValue(s);
    const effectiveReps = Math.min(s.reps + s.rir, UPPER.maxEffectiveReps);
    return s.weight * (1 + UPPER.k * effectiveReps / 30) * s.perHandFactor;
  };

  // E1rm.sessions uvnitř volá lokální setValue, proto je potřeba ho přepsat zvlášť.
  E1rm.sessions = function (sets, exercise) {
    const byDay = new Map();
    for (const s of sets) {
      if (!s.eligible || s.exercise !== exercise) continue;
      const v = E1rm.setValue(s);
      const cur = byDay.get(s.day);
      if (!cur || v > cur.value) byDay.set(s.day, { day: s.day, value: v, estimated: s.rirEstimated });
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  };

  // Forma se zobrazuje jako stav na konci týdne/měsíce; Maximum dál ukazuje nejvyšší bod.
  const originalSessionsFor = Strength.sessionsFor;
  Strength.sessionsFor = function (result, key) {
    const sessions = originalSessionsFor(result, key);
    sessions.aggregation = result.mode === 'form' ? 'last' : 'max';
    return sessions;
  };

  const originalSeries = E1rm.series;
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  E1rm.series = function (sessions, period, today, aggregation) {
    const mode = aggregation || sessions.aggregation || 'max';
    const data = originalSeries(sessions, period, today);
    if (mode !== 'last' || !data.buckets.length) return data;

    const fromKey = dayKey(data.from), endKey = dayKey(data.end);
    const inRange = sessions.filter(s => s.day >= fromKey && s.day <= endKey);
    for (const bucket of data.buckets) {
      const start = dayKey(bucket.start), end = dayKey(bucket.end);
      let latest = null;
      for (const s of inRange) {
        if (s.day >= start && s.day <= end && (!latest || s.day > latest.day)) latest = s;
      }
      bucket.value = latest ? latest.value : null;
      bucket.estimated = latest ? latest.estimated : false;
    }
    data.points = data.buckets.filter(b => b.value !== null);
    const values = data.points.map(p => p.value);
    data.min = values.length ? Math.min(...values) : null;
    data.max = values.length ? Math.max(...values) : null;
    data.avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    data.pr = inRange.length ? Math.max(...inRange.map(s => s.value)) : null;
    return data;
  };

  return { upperBodyCalibration: UPPER, isUpperBody };
})();