// Builds the static site in _site/ from the fics in fics/.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseFile } from './parse.mjs';

const ROOT = process.cwd();
const FICS = path.join(ROOT, 'fics');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, '_site');
const words = s => (String(s || '').trim().match(/\S+/g) || []).length;

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(x?html?|epub)$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}
function gitAdded(file) {
  try {
    const log = execFileSync('git', ['log', '--diff-filter=A', '--follow', '--format=%an|%at', '--', file], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean);
    const [name, at] = (log[log.length - 1] || '').split('|');
    return name ? { uploader: name, added: +at * 1000 } : null;
  } catch { return null; }
}

const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));
const takedown = new Set((await fs.readFile(path.join(ROOT, 'takedown.txt'), 'utf8').catch(() => ''))
  .split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean)
  .map(l => (l.match(/works\/(\d+)/) || l.match(/^(\d+)$/) || [, l])[1]));

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'data', 'works'), { recursive: true });
await fs.cp(WEB, OUT, { recursive: true });
await fs.writeFile(path.join(OUT, '.nojekyll'), '');

const index = [], seen = new Map(), report = { ok: 0, skipped: [] };
for (const file of await walk(FICS)) {
  const rel = path.relative(ROOT, file);
  try {
    const st = await fs.stat(file);
    const r = await parseFile(file, await fs.readFile(file));
    if (!r.chapters.length) { report.skipped.push([rel, 'no story text found']); continue; }
    const ao3 = (r.sourceUrl.match(/works\/(\d+)/) || [])[1];
    if (ao3 && takedown.has(ao3)) { report.skipped.push([rel, 'listed in takedown.txt']); continue; }
    const id = ao3 ? 'ao3-' + ao3 : 'f-' + crypto.createHash('sha1').update(rel).digest('hex').slice(0, 10);
    if (takedown.has(id)) { report.skipped.push([rel, 'listed in takedown.txt']); continue; }
    if (seen.has(id)) { report.skipped.push([rel, 'duplicate of ' + seen.get(id)]); continue; }
    seen.set(id, rel);
    const git = gitAdded(rel) || { uploader: '', added: st.mtimeMs };
    const chapters = r.chapters.map(c => ({ title: c.title, words: words(c.body) }));
    const complete = !!r.expected && r.chapters.length >= r.expected;
    index.push({
      id, title: r.title || path.basename(file).replace(/\.[^.]+$/, ''), creator: r.creator || 'Unknown author', uploader: git.uploader,
      sourceUrl: r.sourceUrl, published: r.published, rating: r.rating || 'N', warnings: r.warnings.length ? r.warnings : ['choose'],
      category: r.category, fandoms: r.fandoms, relationships: r.relationships, characters: r.characters, tags: r.tags,
      summary: r.summary, notes: r.notes, endNotes: r.endNotes, lang: r.lang || 'English', series: r.series,
      expected: complete ? chapters.length : r.expected, complete, chapters, words: chapters.reduce((s, c) => s + c.words, 0), added: git.added,
    });
    await fs.writeFile(path.join(OUT, 'data', 'works', id + '.json'), JSON.stringify({ chapters: r.chapters }));
    report.ok++;
  } catch (e) { report.skipped.push([rel, 'could not be read: ' + e.message]); }
}
index.sort((a, b) => b.added - a.added);
await fs.writeFile(path.join(OUT, 'data', 'index.json'), JSON.stringify(index));
await fs.writeFile(path.join(OUT, 'data', 'config.json'), JSON.stringify(config));

console.log(`Built ${report.ok} work(s).`);
for (const [f, why] of report.skipped) console.log(`Skipped ${f}: ${why}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [`### Fic Shelter build`, `Published **${report.ok}** work(s).`];
  if (report.skipped.length) lines.push('', '| Skipped file | Reason |', '|---|---|', ...report.skipped.map(([f, w]) => `| ${f} | ${w} |`));
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
