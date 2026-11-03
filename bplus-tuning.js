// bplus-tuning.js - kalibrace 1RM Dumbbell Bench Press + časová agregace Formy
// Vkládá se po e1rm.js a strength.js, ale před app.js.
const BPlusTuning = (() => {
  // Pilotní kalibrace z 11 screenshotových porovnání s MacroFactorem.
  // Koeficient se týká jen Dumbbell Bench Press; jiné cviky používají současný Epley.
  const BENCH = { k: 2, maxEffectiveReps: 30 };

  const originalSetValue = E1rm.setValue;
  E1rm.setValue = function (s) {
    if (s.exercise !== 'Dumbbell Bench Press') return originalSetValue(s);
    const effectiveReps = Math.min(s.reps + s.rir, BENCH.maxEffectiveReps);
    return s.weight * (1 + BENCH.k * effectiveReps / 30) * s.perHandFactor;
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

  return { benchCalibration: BENCH };
})();