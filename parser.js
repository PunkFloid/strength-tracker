// parser.js - čtení CSV a rozpoznání formátu (zatím bez ukládání)
const Parser = (() => {
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignorovat */ }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const headers = (rows.shift() || []).map(h => h.trim());
    return rows
      .filter(r => r.length > 1 || (r[0] || '') !== '')
      .map(r => {
        const o = {};
        headers.forEach((h, i) => { o[h.trim()] = r[i] === undefined ? '' : r[i].trim(); });
        return o;
      });
  }

  function detectFormat(headers) {
    if (headers.includes('Set Type') && headers.includes('Workout Duration')) return 'macrofactor';
    if (headers.includes('multiplier') && headers.includes('isWarmup')) return 'old';
    return 'unknown';
  }

  function pragueDay(value) {
    // "2026-04-20 10:31:00 +0000" -> ISO tvar, který čte i Safari
    const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-])(\d{2}):?(\d{2})$/);
    const iso = m ? `${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}` : String(value).trim();
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(d);
  }

  function summarize(rows) {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const format = detectFormat(headers);
    const days = new Set(), exercises = {}, setTypes = {};
    let minDay = '', maxDay = '';
    for (const r of rows) {
      let day = '';
      if (format === 'macrofactor') day = (r['Date'] || '').slice(0, 10);
      else if (format === 'old') day = pragueDay(r['Date']);
      if (!day) continue;
      days.add(day);
      if (!minDay || day < minDay) minDay = day;
      if (!maxDay || day > maxDay) maxDay = day;
      const ex = (r['Exercise'] || '').replace(/\s*∈.*$/, '');
      exercises[ex] = (exercises[ex] || 0) + 1;
      const st = format === 'macrofactor' ? r['Set Type'] : (r['isWarmup'].toLowerCase() === 'true' ? 'Warm-up' : 'Pracovní série');
      setTypes[st] = (setTypes[st] || 0) + 1;
    }
    return { format, rowCount: rows.length, dayCount: days.size, minDay, maxDay, exercises, setTypes };
  }

  return { parseCSV, detectFormat, summarize, pragueDay };
})();
if (typeof module !== 'undefined') module.exports = Parser;