// Reads fics downloaded from AO3 (HTML or EPUB) and returns their metadata and chapters.
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const norm = s => String(s ?? '').trim().toLowerCase();
const txt = el => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
const ratingCode = v => { v = norm(v); if (v.startsWith('general')) return 'G'; if (v.startsWith('teen')) return 'T'; if (v.startsWith('mature')) return 'M'; if (v.startsWith('explicit')) return 'E'; return 'N'; };
const warnCode = v => { v = norm(v); if (v.includes('chose not') || v.includes('choose not')) return 'choose'; if (v.startsWith('no archive')) return 'none'; if (v.includes('violence')) return 'violence'; if (v.includes('character death')) return 'death'; if (v.includes('non-con') || v.includes('rape')) return 'noncon'; if (v.includes('underage')) return 'underage'; return ''; };
const catCode = v => ({ 'f/f': 'ff', 'f/m': 'fm', 'gen': 'gen', 'm/m': 'mm', 'multi': 'multi', 'other': 'other' })[norm(v)] || '';
const LANGS = { en: 'English', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano' };
const htmlDoc = html => new JSDOM(html).window.document;

// Turns a chunk of HTML into the site's light text format: paragraphs, *italics*, **bold**, *** scene breaks.
export function toText(root) {
  const out = []; let cur = '';
  const flush = () => { const t = cur.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\*\*\*\*/g, '').trim(); if (t) out.push(t); cur = ''; };
  const BLOCK = /^(P|DIV|BLOCKQUOTE|H[1-6]|LI|UL|OL|SECTION|ARTICLE|TABLE|TR|CENTER|PRE|DL|DT|DD|FIGURE)$/;
  const walk = n => {
    if (n.nodeType === 3) { cur += n.nodeValue.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IMG' || tag === 'HEAD') return;
    if (tag === 'BR') { cur += '\n'; return; }
    if (tag === 'HR') { flush(); out.push('***'); return; }
    const block = BLOCK.test(tag); if (block) flush();
    const mark = (tag === 'EM' || tag === 'I' || tag === 'CITE') ? '*' : (tag === 'STRONG' || tag === 'B') ? '**' : '';
    if (mark) {
      const lead = cur.length; cur += mark; n.childNodes.forEach(walk);
      if (cur.length === lead + mark.length) cur = cur.slice(0, lead);
      else { const m = cur.slice(lead + mark.length).match(/^(\s*)([\s\S]*?)(\s*)$/); cur = cur.slice(0, lead) + m[1] + mark + m[2] + mark + m[3]; }
      return;
    }
    n.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(root); flush();
  return out.join('\n\n');
}

const LABEL = /^(chapter\s+)?(end\s+)?(summary|notes?)\s*:?$/i;
// Pulls "Summary / Notes / End Notes" sections out of a block (removing them) and returns their text.
function takeNotes(box) {
  const o = { summary: '', notes: '', endNotes: '' };
  if (!box) return o;
  for (const lab of [...box.querySelectorAll('p, h3, h4, h5, h6, b, strong, div, span')]) {
    if (!box.contains(lab) || !LABEL.test(txt(lab))) continue;
    let labEl = lab;
    while (!labEl.nextElementSibling && labEl.parentElement && labEl.parentElement !== box && txt(labEl.parentElement) === txt(lab)) labEl = labEl.parentElement;
    const target = labEl.nextElementSibling;
    const kind = txt(lab).toLowerCase();
    if (target && !/^h[1-6]$/i.test(target.tagName)) {
      const t = toText(target);
      if (/end/.test(kind)) o.endNotes = o.endNotes || t;
      else if (/summary/.test(kind)) o.summary = o.summary || t;
      else o.notes = o.notes || t;
      target.remove();
    }
    labEl.remove();
  }
  for (const el of [...box.querySelectorAll('p, div')]) if (box.contains(el) && /^\(?see the end of the (chapter|work) for/i.test(txt(el))) el.remove();
  return o;
}
const labeled = block => block ? takeNotes(block.cloneNode(true)) : {};

export function parseAO3Doc(doc, fb = {}) {
  const r = { title: '', creator: '', rating: '', warnings: [], category: [], fandoms: [], relationships: [], characters: [], tags: [], lang: '', series: null, summary: '', notes: '', endNotes: '', sourceUrl: '', published: '', expected: null, chapters: [], problems: [] };
  const dl = doc.querySelector('dl.tags') || [...doc.querySelectorAll('dl')].find(d => /^(rating|archive warning|fandom)/i.test(txt(d.querySelector('dt'))));
  if (dl) for (const dt of dl.querySelectorAll('dt')) {
    const k = txt(dt).replace(/:$/, '').toLowerCase(), dd = dt.nextElementSibling; if (!dd) continue;
    const links = [...dd.querySelectorAll('a')].map(txt).filter(Boolean);
    const vals = links.length ? links : txt(dd).split(',').map(x => x.trim()).filter(Boolean);
    if (k.startsWith('rating')) r.rating = ratingCode(vals[0]);
    else if (k.startsWith('archive warning')) vals.forEach(v => { const c = warnCode(v); if (c && !r.warnings.includes(c)) r.warnings.push(c); });
    else if (k.startsWith('categor')) vals.forEach(v => { const c = catCode(v); if (c && !r.category.includes(c)) r.category.push(c); });
    else if (k.startsWith('fandom')) r.fandoms = vals;
    else if (k.startsWith('relationship')) r.relationships = vals;
    else if (k.startsWith('character')) r.characters = vals;
    else if (k.startsWith('additional tag') || k.startsWith('freeform')) r.tags = vals;
    else if (k.startsWith('language')) r.lang = txt(dd);
    else if (k.startsWith('series')) { const m = txt(dd).match(/Part\s+(\d+)\s+of\s+(.+)/i); if (m) r.series = { part: +m[1], name: (links[0] || m[2]).trim() }; }
    else if (k.startsWith('stats')) {
      const s = txt(dd);
      const pb = s.match(/Published:\s*([\d-]+)/i); if (pb) r.published = pb[1];
      const c = s.match(/Chapters:\s*(\d+)\s*\/\s*(\d+|\?)/i); if (c && c[2] !== '?') r.expected = +c[2];
    }
  }
  const src = [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).find(h => /archiveofourown\.org\/works\/\d+/i.test(h || ''));
  if (src) r.sourceUrl = 'https://archiveofourown.org/works/' + src.match(/archiveofourown\.org\/works\/(\d+)/i)[1];
  const preface = doc.querySelector('#preface') || (dl && (dl.closest('.meta') || dl.parentElement));
  const h1 = (preface && preface.querySelector('h1')) || [...doc.querySelectorAll('h1')].find(h => !h.closest('.userstuff'));
  r.title = txt(h1) || fb.title || txt(doc.querySelector('title')).split(' - ')[0] || '';
  const authors = [...new Set([...doc.querySelectorAll('a[rel="author"]')].map(txt).filter(Boolean))];
  r.creator = authors.join(', ') || txt(doc.querySelector('.byline')).replace(/^by\s+/i, '') || fb.creator || '';
  if (!r.lang) r.lang = fb.lang ? (LANGS[fb.lang.slice(0, 2).toLowerCase()] || fb.lang) : '';
  const pre = labeled(preface); r.summary = pre.summary || ''; r.notes = pre.notes || '';

  const after = doc.querySelector('#afterword');
  if (after) { const a = labeled(after); r.endNotes = a.endNotes || a.notes || ''; }

  // Chapters: everything between one "Chapter N" heading and the next is the chapter;
  // labelled Summary / Notes / End Notes sections inside it are moved to the chapter notes.
  const out = el => el.closest('#preface, #afterword') || (preface && preface.contains(el));
  const heads = [...doc.querySelectorAll('h1, h2, h3, h4')].filter(h => !out(h) && /^chapter\s+\d+/i.test(txt(h)));
  let start = preface || dl;
  if (start && !preface) while (start.parentElement && start.parentElement !== doc.body && !heads.some(h => start.parentElement.contains(h))) start = start.parentElement;
  const region = (from, to) => {
    const rg = doc.createRange();
    if (from) rg.setStartAfter(from); else rg.setStart(doc.body, 0);
    if (to) rg.setEndBefore(to); else rg.setEnd(doc.body, doc.body.childNodes.length);
    const box = doc.createElement('div'); box.appendChild(rg.cloneContents());
    box.querySelectorAll('#afterword, script, style').forEach(x => x.remove());
    return box;
  };
  const pieces = heads.length
    ? heads.map((h, i) => ({ h, box: region(h, heads[i + 1] || after) }))
    : [{ h: null, box: region(start, after) }];
  r.chapters = pieces.map(({ h, box }) => {
    let title = h ? txt(h).replace(/^chapter\s+\d+\s*[:.\-–]?\s*/i, '').trim() : '';
    if (norm(title) === norm(r.title)) title = '';
    if (!h) box.querySelectorAll('h1').forEach(x => x.remove());
    const n = takeNotes(box);
    const notes = [n.summary ? 'Chapter summary: ' + n.summary : '', n.notes || ''].filter(Boolean).join('\n\n');
    return { title, body: toText(box), notes, endNotes: n.endNotes };
  }).filter(c => c.body.trim());
  return r;
}

const resolvePath = (base, href) => { const out = []; for (const p of (base + href).split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); };

export async function parseEpub(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const cont = zip.file('META-INF/container.xml'); if (!cont) throw new Error('damaged EPUB (no container.xml)');
  const opfPath = ((await cont.async('string')).match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath || !zip.file(opfPath)) throw new Error('damaged EPUB (no package file)');
  const opf = new JSDOM(await zip.file(opfPath).async('string'), { contentType: 'application/xml' }).window.document;
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const byId = {}; for (const it of opf.getElementsByTagNameNS('*', 'item')) byId[it.getAttribute('id')] = it.getAttribute('href');
  const parts = [];
  for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
    const href = byId[ref.getAttribute('idref')]; if (!href) continue;
    const f = zip.file(resolvePath(base, decodeURIComponent(href.split('#')[0]))); if (!f) continue;
    const d = htmlDoc(await f.async('string'));
    parts.push(d.body ? d.body.innerHTML : '');
  }
  const doc = htmlDoc('<!doctype html><html><body>' + parts.join('\n') + '</body></html>');
  const DC = 'http://purl.org/dc/elements/1.1/';
  const dc = n => { const el = opf.getElementsByTagNameNS(DC, n); return el.length ? el[0].textContent.trim() : ''; };
  const creators = [...opf.getElementsByTagNameNS(DC, 'creator')].map(e => e.textContent.trim()).filter(Boolean);
  return parseAO3Doc(doc, { title: dc('title'), creator: creators.join(', '), lang: dc('language') });
}

// Reads a fic written with the site's "Write" page: a header between --- lines, then "# Chapter" sections.
export function parseWritten(text) {
  text = text.replace(/\r/g, '').replace(/^\uFEFF/, '');
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/);
  if (!m) throw new Error('missing the header block between --- lines');
  const meta = {}, lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const mm = lines[i].match(/^([a-z_]+):[ \t]?(.*)$/i); if (!mm) continue;
    let v = mm[2];
    if (v.trim() === '|') { const buf = []; while (i + 1 < lines.length && (/^  /.test(lines[i + 1]) || !lines[i + 1].trim())) buf.push(lines[++i].replace(/^  /, '')); v = buf.join('\n'); }
    meta[mm[1].toLowerCase()] = v.trim();
  }
  const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const r = { title: meta.title || '', creator: meta.author || '', rating: ratingCode(meta.rating), warnings: [], category: [], fandoms: split(meta.fandoms),
    relationships: split(meta.relationships), characters: split(meta.characters), tags: split(meta.tags), lang: meta.language || '', series: null,
    summary: meta.summary || '', notes: meta.notes || '', endNotes: meta.end_notes || '', sourceUrl: '', published: '', expected: null, chapters: [], problems: [], original: true };
  split(meta.warnings).forEach(v => { const c = warnCode(v); if (c && !r.warnings.includes(c)) r.warnings.push(c); });
  split(meta.categories).forEach(v => { const c = catCode(v); if (c && !r.category.includes(c)) r.category.push(c); });
  const sm = String(meta.series || '').match(/^(.*?)\s*\|\s*(\d+)\s*$/); if (meta.series) r.series = { name: (sm ? sm[1] : meta.series).trim(), part: sm ? +sm[2] : 1 };
  if (/^\d+$/.test(meta.chapters_total || '')) r.expected = +meta.chapters_total;
  const parts = m[2].split(/^# (.*)$/m);
  const sections = parts.length > 1 ? parts.slice(1).reduce((a, x, i) => (i % 2 ? a[a.length - 1].body = x : a.push({ head: x, body: '' }), a), []) : [{ head: '', body: parts[0] }];
  r.chapters = sections.map(({ head, body }) => {
    const paras = body.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    let notes = '', endNotes = '';
    if (paras.length && /^notes:\s*/i.test(paras[0])) notes = paras.shift().replace(/^notes:\s*/i, '');
    if (paras.length && /^end notes:\s*/i.test(paras[paras.length - 1])) endNotes = paras.pop().replace(/^end notes:\s*/i, '');
    return { title: head.replace(/^chapter\s+\d+\s*[:.\-–]?\s*/i, '').trim(), body: paras.join('\n\n').replace(/^\\# /gm, '# '), notes, endNotes };
  }).filter(c => c.body.trim());
  return r;
}

// ---------- PDF (AO3 pages saved or printed as PDF, and AO3's own PDF downloads) ----------
const PDF_LABEL = /^(rating|archive warnings?|categor(?:y|ies)|fandoms?|relationships?|characters?|additional tags|language|series|collections?|stats)\s*:\s*(.*)$/i;
const SECTION = /^(chapter\s+)?(end\s+)?(summary|notes?)\s*:?$/i;
const JUNK = [/^\(?see the end of the (work|chapter) for/i, /^close\s*(\(\s*#?\s*\))?$/i, /^(chapter text|work text:?)$/i, /^\d+$/, /^\(\s*#\s*\)$/];
const STOP = /^(kudos \(\d+\)|leave kudos|comments \(\d+\)|post comment|hide comments)$/i;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const mode = a => { const c = new Map(); a.forEach(v => c.set(v, (c.get(v) || 0) + 1)); return [...c].sort((x, y) => y[1] - x[1])[0]?.[0] || 0; };

async function pdfLines(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(it);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const items = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      let text = '', end = null, space = false, x0 = null, x1 = 0, size = 0;
      for (const it of items) {
        const x = it.transform[4];
        if (!it.str.trim()) { space = true; continue; }
        if (text && (space || (end !== null && x - end > Math.max(1.5, it.height * 0.18)))) text += ' ';
        text += it.str; space = /\s$/.test(it.str); end = x + it.width;
        if (x0 === null) x0 = x; x1 = Math.max(x1, end); size = Math.max(size, Math.round(it.height));
      }
      text = text.replace(/\s*\((?:#[^)]*|https?:\/\/[^)\s]*)\)/g, '').replace(/\s+/g, ' ').trim();
      if (text) lines.push({ page: p, y, x0, x1, size, text });
    }
  }
  return lines;
}

export async function parsePdf(buffer) {
  const all = await pdfLines(buffer);
  const r = { title: '', creator: '', rating: '', warnings: [], category: [], fandoms: [], relationships: [], characters: [], tags: [], lang: '', series: null,
    summary: '', notes: '', endNotes: '', sourceUrl: '', published: '', expected: null, chapters: [], problems: [], fromPdf: true };
  const joined = all.map(l => l.text).join(' ');
  const src = joined.match(/archiveofourown\.org\/works\/(\d+)/i); if (src) r.sourceUrl = 'https://archiveofourown.org/works/' + src[1];
  let lines = [];
  for (const l of all) { if (STOP.test(l.text)) break; if (!JUNK.some(j => j.test(l.text))) lines.push(l); }
  if (!lines.length) return r;
  const bodySize = mode(lines.map(l => l.size));
  const isHead = l => l.size >= bodySize + 2;
  const gaps = []; for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page && !isHead(lines[i]) && !isHead(lines[i - 1])) gaps.push(lines[i - 1].y - lines[i].y);
  const lineGap = median(gaps.filter(g => g > 0)) || bodySize * 1.2;
  const bodyLines = lines.filter(l => !isHead(l));
  const base = mode(bodyLines.map(l => Math.round(l.x0)));
  const right = median(bodyLines.map(l => l.x1).sort((a, b) => b - a).slice(0, Math.max(5, Math.floor(bodyLines.length * 0.3))));

  // Title = first line in the largest heading size; everything before it is the tag block.
  const maxHead = Math.max(...lines.filter(isHead).map(l => l.size), 0);
  let ti = maxHead ? lines.findIndex(l => l.size === maxHead) : -1;
  const pre = ti > 0 ? lines.slice(0, ti) : [];
  if (pre.some(l => PDF_LABEL.test(l.text))) {
    let key = null; const vals = {};
    for (const l of pre) { const m = l.text.match(PDF_LABEL); if (m) { key = m[1].toLowerCase(); vals[key] = m[2]; } else if (key) vals[key] += ' ' + l.text; }
    const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
    for (const [k, v] of Object.entries(vals)) applyTag(r, k, list(v), v);
  } else if (pre.length) {
    const groups = [[]];
    pre.forEach((l, i) => { if (i && (l.page !== pre[i - 1].page || pre[i - 1].y - l.y > lineGap * 1.5 || Math.abs(l.x0 - pre[i - 1].x0) > 8)) groups.push([]); groups[groups.length - 1].push(l.text); });
    const rest = [];
    for (const g of groups) {
      if (g.every(t => /^(general audiences|teen and up audiences|mature|explicit|not rated)$/i.test(t))) r.rating = ratingCode(g[0]);
      else if (g.every(t => warnCode(t))) applyTag(r, 'archive warning', g);
      else if (g.every(t => catCode(t))) applyTag(r, 'category', g);
      else if (g.some(t => /published:/i.test(t))) applyTag(r, 'stats', [], g.join(' '));
      else if (g.length === 1 && /^part\s+\d+\s+of\s+/i.test(g[0])) applyTag(r, 'series', [], g[0]);
      else rest.push(g);
    }
    if (rest.length > 1 && rest[rest.length - 1].length === 1 && /^[\p{L}][\p{L} ()-]{1,30}$/u.test(rest[rest.length - 1][0]) && !rest[rest.length - 1][0].includes('/')) r.lang = rest.pop()[0];
    const order = ['fandoms', 'relationships', 'characters', 'tags'];
    let k = 0;
    for (const g of rest) {
      while (order[k] === 'relationships' && !g.some(t => /[\/&]/.test(t))) k++;
      if (k >= order.length) { r.tags.push(...g); continue; }
      r[order[k]] = g; k++;
    }
  }
  if (ti < 0) ti = 0;
  // Title may wrap over several lines of the same size.
  let j = ti; const tl = [];
  while (j < lines.length && lines[j].size === maxHead && (!tl.length || lines[j - 1].y - lines[j].y <= maxHead * 1.8)) tl.push(lines[j++].text);
  r.title = maxHead ? tl.join(' ') : '';
  if (j < lines.length && isHead(lines[j]) && lines[j].size < maxHead && !SECTION.test(lines[j].text) && !/^chapter\s+\d+/i.test(lines[j].text)) r.creator = lines[j++].text.replace(/^by\s+/i, '');

  // Paragraphs: break on headings, big gaps, short lines and indented first lines.
  const paras = [];
  for (const l of lines.slice(j)) {
    const prev = paras[paras.length - 1], pl = prev && prev.last;
    const brk = !prev || isHead(l) || isHead(pl) || l.page === pl.page && pl.y - l.y > lineGap * 1.5 || pl.x1 < right - 45 || l.x0 > pl.x0 + 12 && l.x0 > base + 12;
    if (brk) paras.push({ text: l.text, x0: l.x0, head: isHead(l), last: l });
    else { prev.text += ' ' + l.text; prev.x0 = Math.min(prev.x0, l.x0); prev.last = l; }
  }
  let ch = null, section = null, bodyStarted = false;
  const newCh = title => { ch = { title, body: [], notes: [], endNotes: [] }; r.chapters.push(ch); bodyStarted = false; section = null; };
  for (const p of paras) {
    const t = p.text.trim();
    if (/^chapter\s+\d+\b/i.test(t) && (p.head || t.length < 90)) { newCh(t.replace(/^chapter\s+\d+\s*[:.\-–]?\s*/i, '').trim()); continue; }
    const sm = t.match(SECTION);
    if (sm && (p.head || t.length < 25)) {
      const kind = /summary/i.test(t) ? 'summary' : 'notes';
      if (!ch && !bodyStarted) section = kind === 'summary' ? { to: 'summary' } : { to: 'notes' };
      else if (!bodyStarted) section = { to: kind === 'summary' ? 'chSummary' : 'chNotes' };
      else section = { to: /chapter/i.test(t) || !/^notes/i.test(t) ? 'chEnd' : 'endNotes' };
      continue;
    }
    if (section && p.x0 > base + 2) {
      if (section.to === 'summary') r.summary += (r.summary ? '\n\n' : '') + t;
      else if (section.to === 'notes') r.notes += (r.notes ? '\n\n' : '') + t;
      else if (section.to === 'endNotes') r.endNotes += (r.endNotes ? '\n\n' : '') + t;
      else if (ch) (section.to === 'chEnd' ? ch.endNotes : ch.notes).push(section.to === 'chSummary' && !ch.notes.length ? 'Chapter summary: ' + t : t);
      continue;
    }
    section = null;
    if (!ch) newCh('');
    ch.body.push(t); bodyStarted = true;
  }
  if (r.chapters.length === 1 && r.chapters[0].endNotes.length && !r.endNotes) { r.endNotes = r.chapters[0].endNotes.join('\n\n'); r.chapters[0].endNotes = []; }
  r.chapters = r.chapters.map(c => ({ title: c.title, body: c.body.join('\n\n'), notes: c.notes.join('\n\n'), endNotes: c.endNotes.join('\n\n') })).filter(c => c.body.trim());
  if (!r.lang) r.lang = 'English';
  return r;
}

function applyTag(r, k, vals, raw = '') {
  if (k.startsWith('rating')) r.rating = ratingCode(vals[0] || raw);
  else if (k.startsWith('archive warning')) vals.forEach(v => { const c = warnCode(v); if (c && !r.warnings.includes(c)) r.warnings.push(c); });
  else if (k.startsWith('categor')) vals.forEach(v => { const c = catCode(v); if (c && !r.category.includes(c)) r.category.push(c); });
  else if (k.startsWith('fandom')) r.fandoms = vals;
  else if (k.startsWith('relationship')) r.relationships = vals;
  else if (k.startsWith('character')) r.characters = vals;
  else if (k.startsWith('additional tag')) r.tags = vals;
  else if (k.startsWith('language')) r.lang = (raw || vals[0] || '').trim();
  else if (k.startsWith('series')) { const m = String(raw).match(/Part\s+(\d+)\s+of\s+(.+)/i); if (m) r.series = { part: +m[1], name: m[2].trim() }; }
  else if (k.startsWith('stats')) { const pb = String(raw).match(/Published:\s*([\d-]+)/i); if (pb) r.published = pb[1]; const c = String(raw).match(/Chapters:\s*(\d+)\s*\/\s*(\d+|\?)/i); if (c && c[2] !== '?') r.expected = +c[2]; }
}

export async function parseFile(name, buffer) {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return parsePdf(buffer);
  if (n.endsWith('.md')) return parseWritten(buffer.toString('utf8'));
  if (n.endsWith('.epub')) return parseEpub(buffer);
  if (/\.(x?html?)$/.test(n)) return parseAO3Doc(htmlDoc(buffer.toString('utf8')));
  throw new Error('unsupported file type (use HTML or EPUB)');
}