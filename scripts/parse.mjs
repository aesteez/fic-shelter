// Reads fics downloaded from AO3 (HTML or EPUB) and returns their metadata and chapters.
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
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

function labeled(block) {
  const o = {}; if (!block) return o;
  for (const p of block.querySelectorAll('p, h3, h4, h5, b, strong')) {
    let bq = p.nextElementSibling;
    while (bq && !/^blockquote$/i.test(bq.tagName) && !bq.classList.contains('userstuff')) {
      if (/^(p|h3|h4|h5)$/i.test(bq.tagName)) { bq = null; break; }
      bq = bq.nextElementSibling;
    }
    if (!bq) continue;
    const k = txt(p).toLowerCase();
    if (/summary/.test(k) && !o.summary) o.summary = toText(bq);
    else if (/note/.test(k) && !o.notes) o.notes = toText(bq);
  }
  return o;
}
const follows = (a, b) => !!(a.compareDocumentPosition(b) & FOLLOWING);

export function parseAO3Doc(doc, fb = {}) {
  const r = { title: '', creator: '', rating: '', warnings: [], category: [], fandoms: [], relationships: [], characters: [], tags: [], lang: '', series: null, summary: '', notes: '', endNotes: '', sourceUrl: '', published: '', expected: null, chapters: [], problems: [] };
  const dl = doc.querySelector('dl.tags');
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
  const after = doc.querySelector('#afterword'); if (after) r.endNotes = labeled(after).notes || '';

  const isOut = el => el.closest('#preface, #afterword, .meta, dl.tags, .preface, .afterword, .end.notes, .endnotes, [id$="endnotes"]');
  let cands = [...doc.querySelectorAll('.userstuff')].filter(el => el.id !== 'chapters' && !isOut(el));
  cands = cands.filter(el => !cands.some(o => o !== el && o.contains(el)));
  if (!cands.length) cands = [...doc.querySelectorAll('[id="chapters"]')];
  if (!cands.length && doc.body) { const b = doc.body.cloneNode(true); b.querySelectorAll('#preface, #afterword, dl.tags, .meta, h1').forEach(x => x.remove()); cands = [b]; }
  const heads = [...doc.querySelectorAll('h2, h3')].filter(h => !h.closest('#preface, #afterword, .userstuff:not(#chapters)') && txt(h));
  const metas = [...doc.querySelectorAll('.meta, .chapter.preface')].filter(m => !m.closest('#preface') && m !== preface && !(dl && m.contains(dl)));
  const ends = [...doc.querySelectorAll('.end.notes, [id$="endnotes"]')].filter(e => !e.closest('#afterword'));
  r.chapters = cands.map((el, i) => {
    const prev = cands[i - 1], next = cands[i + 1];
    const between = x => (!prev || follows(prev, x)) && follows(x, el) && !x.contains(el);
    const h = [...heads].reverse().find(between);
    let title = h ? txt(h).replace(/^chapter\s+\d+\s*[:.\-–]?\s*/i, '').trim() : '';
    if (norm(title) === norm(r.title)) title = '';
    const lm = labeled([...metas].reverse().find(between));
    const notes = [lm.summary ? 'Chapter summary: ' + lm.summary : '', lm.notes || ''].filter(Boolean).join('\n\n');
    const e = ends.find(x => follows(el, x) && (!next || follows(x, next)));
    const endNotes = e ? (labeled(e).notes || toText(e.querySelector('blockquote') || e)) : '';
    return { title, body: toText(el), notes, endNotes };
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
