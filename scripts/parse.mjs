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
    else if (k.startsWith('archive warning')) vals.forEach(v => { const c = warnCode(v); if (c === 'underage') r.problems.push('underage'); else if (c && !r.warnings.includes(c)) r.warnings.push(c); });
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

export async function parseFile(name, buffer) {
  const n = name.toLowerCase();
  if (n.endsWith('.epub')) return parseEpub(buffer);
  if (/\.(x?html?)$/.test(n)) return parseAO3Doc(htmlDoc(buffer.toString('utf8')));
  throw new Error('unsupported file type (use HTML or EPUB)');
}
