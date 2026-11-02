// sync.js - synchronizace dat přes soukromý repozitář na GitHubu (Contents API)
// Každý zdroj dat (macrofactor, old, body) je v repozitáři jako data/<zdroj>.json.
// Synchronizace data slučuje po dnech: dny, které jsou jen na jedné straně, se přidají na druhou.
// Pro dny, které jsou na obou stranách, platí verze z té strany, kde byl naposledy proveden import.
const Sync = (() => {
  const API = 'https://api.github.com';
  const DIR = 'data';

  class SyncError extends Error {
    constructor(message, status, offline) {
      super(message);
      this.status = status || 0;
      this.offline = !!offline;
    }
  }

  // "PunkFloid/strength-tracker-data" nebo celá adresa repozitáře -> "PunkFloid/strength-tracker-data"
  function parseRepo(input) {
    const s = String(input || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const m = s.match(/^([\w.-]+)\/([\w.-]+)$/);
    return m ? `${m[1]}/${m[2]}` : null;
  }

  // text -> base64 (včetně češtiny)
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function request(cfg, method, suffix, opts) {
    opts = opts || {};
    const headers = {
      Authorization: 'Bearer ' + cfg.token,
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    // GitHub u čtení krátce drží odpovědi v mezipaměti, proto ke každému čtení přidáme jedinečný parametr
    const url = `${API}/repos/${cfg.repo}${suffix}` + (method === 'GET' ? (suffix.includes('?') ? '&' : '?') + '_=' + Date.now() : '');
    try {
      return await fetch(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch (e) {
      throw new SyncError('Nepodařilo se spojit s GitHubem. Jsi online?', 0, true);
    }
  }

  async function failure(res) {
    let msg = '';
    try { const j = await res.json(); msg = j && j.message ? j.message : ''; } catch (e) { /* bez těla */ }
    return new SyncError(msg || ('Chyba GitHubu ' + res.status), res.status);
  }

  // názvy a identifikátory (sha) souborů ve složce data/
  async function listDir(cfg) {
    const res = await request(cfg, 'GET', '/contents/' + DIR);
    if (res.ok) {
      const arr = await res.json();
      return new Map((Array.isArray(arr) ? arr : []).filter(x => x.type === 'file').map(x => [x.name, x.sha]));
    }
    if (res.status === 404) {
      // složka ještě neexistuje, nebo repozitář neexistuje / token k němu nemá přístup
      const repoRes = await request(cfg, 'GET', '');
      if (!repoRes.ok) throw await failure(repoRes);
      return new Map();
    }
    throw await failure(res);
  }

  async function getFile(cfg, name) {
    const res = await request(cfg, 'GET', `/contents/${DIR}/${name}`, { raw: true });
    if (!res.ok) throw await failure(res);
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { throw new SyncError(`Soubor ${name} v repozitáři je poškozený.`, 0); }
  }

  async function putFile(cfg, name, sha, text, message) {
    const body = { message, content: toBase64(text) };
    if (sha) body.sha = sha;
    const res = await request(cfg, 'PUT', `/contents/${DIR}/${name}`, { body });
    if (!res.ok) throw await failure(res);
  }

  // řádky seřazené podle dne (stabilně), aby měla stejná data na všech zařízeních stejné pořadí
  const sortByDay = (rows, getDay) => rows
    .map((r, i) => ({ r, d: getDay(r) || '', i }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i))
    .map(x => x.r);

  function perDay(rows, getDay) {
    const m = new Map();
    for (const r of rows) {
      const d = getDay(r) || '';
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(r);
    }
    const out = new Map();
    for (const [d, arr] of m) out.set(d, JSON.stringify(arr));
    return out;
  }
  const countDiff = (a, b) => { let n = 0; for (const [d, s] of a) if (b.get(d) !== s) n++; return n; };

  // sloučení místních a vzdálených dat jednoho zdroje
  function mergeSide(local, remote, getDay) {
    const L = local && Array.isArray(local.rows) ? local : null;
    const R = remote && Array.isArray(remote.rows) ? remote : null;
    const lRows = L ? sortByDay(L.rows, getDay) : [];
    const rRows = R ? sortByDay(R.rows, getDay) : [];
    const localNewer = !R || (!!L && (L.updatedAt || '') >= (R.updatedAt || ''));
    const newer = localNewer ? lRows : rRows;
    const older = localNewer ? rRows : lRows;
    const newDays = new Set(newer.map(r => getDay(r) || ''));
    const rows = sortByDay(older.filter(r => !newDays.has(getDay(r) || '')).concat(newer), getDay);
    const stamps = [L && L.updatedAt, R && R.updatedAt].filter(Boolean).sort();
    const updatedAt = stamps.length ? stamps[stamps.length - 1] : new Date().toISOString();
    const files = [...new Set([...((R && R.files) || []), ...((L && L.files) || [])])].slice(-10);
    const merged = perDay(rows, getDay);
    return {
      rows, updatedAt, files,
      toLocal: countDiff(merged, perDay(lRows, getDay)),     // dnů, které se změní / přibydou v tomto zařízení
      toRemote: countDiff(merged, perDay(rRows, getDay))     // dnů, které se změní / přibydou v GitHubu
    };
  }

  // jeden řádek na řádek souboru: přehledné změny v historii repozitáře
  function serialize(format, m) {
    const head = JSON.stringify({ app: 'strength-tracker', version: 1, format, updatedAt: m.updatedAt, files: m.files });
    return head.slice(0, -1) + ',"rows":[\n' + m.rows.map(r => JSON.stringify(r)).join(',\n') + '\n]}\n';
  }

  const czDays = n => (n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dnů');

  async function once(cfg, saved, formats, dayOf) {
    const listing = await listDir(cfg);
    const out = { updates: {}, pulledDays: 0, pushedDays: 0 };
    for (const f of formats) {
      const name = `${f}.json`;
      const remote = listing.has(name) ? await getFile(cfg, name) : null;
      const m = mergeSide(saved[f], remote, dayOf[f]);
      if (!m.rows.length) continue;
      const local = saved[f];
      if (m.toLocal > 0 || !local || (local.updatedAt || '') !== m.updatedAt) {
        out.updates[f] = { rows: m.rows, updatedAt: m.updatedAt, files: m.files };
        out.pulledDays += m.toLocal;
      }
      if (!remote || m.toRemote > 0 || (remote.updatedAt || '') !== m.updatedAt) {
        await putFile(cfg, name, listing.get(name), serialize(f, m), `Synchronizace: ${f}`);
        out.pushedDays += m.toRemote;
      }
    }
    return out;
  }

  // hlavní funkce: při konfliktu (jiné zařízení zapsalo mezitím) se celé zopakuje jednou
  async function sync(cfg, saved, formats, dayOf) {
    let result;
    for (let attempt = 0; ; attempt++) {
      try { result = await once(cfg, saved, formats, dayOf); break; }
      catch (e) { if (attempt === 0 && e && (e.status === 409 || e.status === 422)) continue; throw e; }
    }
    const parts = [];
    if (result.pulledDays) parts.push(`staženo ${result.pulledDays} ${czDays(result.pulledDays)}`);
    if (result.pushedDays) parts.push(`nahráno ${result.pushedDays} ${czDays(result.pushedDays)}`);
    result.summary = parts.length ? `Hotovo: ${parts.join(', ')}.` : 'Vše je aktuální.';
    return result;
  }

  function explain(err) {
    if (err instanceof SyncError) {
      if (err.offline) return err.message;
      if (err.status === 401) return 'Token není platný nebo vypršel. Vytvoř nový a vlož ho znovu.';
      if (err.status === 403) return 'GitHub odmítl přístup: token nemá oprávnění Contents (Read and write), nebo je překročený limit požadavků.';
      if (err.status === 404) return 'Repozitář nebyl nalezen, nebo k němu token nemá přístup. Zkontroluj název, oprávnění tokenu a že repozitář není prázdný (stačí v něm mít README).';
      if (err.status === 409 || err.status === 422) return 'Data se mezitím změnila na jiném zařízení. Zkus synchronizovat znovu.';
      return err.message || ('Chyba GitHubu ' + err.status);
    }
    return 'Neočekávaná chyba: ' + (err && err.message ? err.message : err);
  }

  return { parseRepo, sync, explain, SyncError };
})();
if (typeof module !== 'undefined') module.exports = Sync;