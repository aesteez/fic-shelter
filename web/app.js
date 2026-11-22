(() => {
const RATINGS = {G:{s:'G',l:'General Audiences'}, T:{s:'T',l:'Teen And Up Audiences'}, M:{s:'M',l:'Mature'}, E:{s:'E',l:'Explicit'}, N:{s:'–',l:'Not Rated'}};
const WARN = {choose:'Creator Chose Not To Use Archive Warnings', none:'No Archive Warnings Apply', violence:'Graphic Depictions Of Violence', death:'Major Character Death', noncon:'Rape/Non-Con', underage:'Underage'};
const SERIOUS = ['violence','death','noncon','underage'];
const CATS = {ff:'F/F', fm:'F/M', gen:'Gen', mm:'M/M', multi:'Multi', other:'Other'};
const CSYM = {ff:'FF', fm:'FM', gen:'G', mm:'MM', multi:'+', other:'O'};
const PAGE = 20;
const SORTS = {added:'Date Added', published:'Date Originally Posted', words:'Word Count', chapters:'Chapters', title:'Title', author:'Creator'};

const S = { works:[], byId:new Map(), config:{}, ready:false, view:{name:'works'}, gateOk:new Set(), chCache:new Map(), ignoreHash:null };
const freshFilters = () => ({q:'', sort:'added', ratings:[], warns:[], cats:[], include:[], exclude:[], status:'all', wmin:'', wmax:'', lang:'', creator:'', page:1});
const F = freshFilters();
const $ = (s,r=document) => r.querySelector(s);
const view = $('#view');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inline = t => t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g,'$1<em>$2</em>');
function mdBlocks(src){
  return esc(src||'').replace(/\r/g,'').split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean)
    .map(b => /^(\*\s*){3,}$|^-{3,}$|^~{3,}$/.test(b) ? '<hr>' : '<p>'+inline(b).replace(/\n/g,'<br>')+'</p>');
}
const md = src => mdBlocks(src).join('');
const list = s => [...new Set(String(s||'').split(',').map(x=>x.trim()).filter(Boolean))].slice(0,50);
const norm = s => String(s).trim().toLowerCase();
const nf = new Intl.NumberFormat('en');
const df = new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'});
const fmtDate = t => t ? df.format(new Date(t)) : '';
const plural = (n,one,many) => `${nf.format(n)} ${n===1?one:many}`;
const store = {
  get(k,d){ try{ const v=JSON.parse(localStorage.getItem('fs-'+k)); return v ?? d; }catch{ return d; } },
  set(k,v){ try{ localStorage.setItem('fs-'+k, JSON.stringify(v)); }catch{} }
};
let toastT;
function toast(m){ const el=$('#toast'); el.textContent=m; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true,3600); }
function setStatus(t,bad){ $('#status-text').textContent=t||''; $('#status').hidden=!t; $('#status').classList.toggle('bad',!!bad); }
function readerSize(){ return parseFloat(store.get('size',1.1))||1.1; }
function setReaderSize(v){ v=Math.min(1.6,Math.max(.9,v)); document.documentElement.style.setProperty('--reader-size',v+'rem'); store.set('size',v); }
setReaderSize(readerSize());

/* ---------- derived ---------- */
const findWork = id => S.byId.get(id) || null;
const workTags = w => [...(w.fandoms||[]),...(w.relationships||[]),...(w.characters||[]),...(w.tags||[])];
const chapLabel = w => `${(w.chapters||[]).length}/${w.expected||'?'}`;
const rk = w => (w.rating in RATINGS) ? w.rating : 'N';
const ao3Id = u => (String(u||'').match(/works\/(\d+)/)||[])[1] || '';
const waybackUrl = id => `https://web.archive.org/web/https://archiveofourown.org/works/${id}`;
const waybackAll = id => `https://web.archive.org/web/*/archiveofourown.org/works/${id}*`;
const extLink = (href,label,cls='') => `<a${cls?` class="${cls}"`:''} href="${esc(href)}" target="_blank" rel="noopener"${cls?' style="text-decoration:none"':''}>${label}</a>`;
const later = () => store.get('later',{}), marks = () => store.get('bookmarks',{}), history = () => store.get('history',{});

/* ---------- blurbs ---------- */
function reqSquare(w){
  const ws=w.warnings||[], cs=w.category||[];
  const serious=ws.filter(x=>SERIOUS.includes(x));
  const [wc,wsym,wt] = serious.length ? ['w-warn','!',serious.map(x=>WARN[x]).join(', ')] : ws.includes('none') ? ['w-none','',WARN.none] : ['w-choose','?',WARN.choose];
  const [cc,csym,ct] = !cs.length ? ['c-none','','No category'] : cs.length>1 ? ['c-multi','+',cs.map(x=>CATS[x]).join(', ')] : ['c-'+cs[0], CSYM[cs[0]]||'', CATS[cs[0]]||''];
  const r=RATINGS[rk(w)];
  return `<ul class="req" aria-label="Required tags">
    <li class="rq r-${rk(w)}" title="Rating: ${esc(r.l)}">${r.s}</li>
    <li class="rq ${wc}" title="Warnings: ${esc(wt)}">${wsym}</li>
    <li class="rq ${cc}" title="Category: ${esc(ct)}">${csym}</li>
    <li class="rq ${w.complete?'done':'wip'}" title="${w.complete?'Complete Work':'Work in Progress'}">${w.complete?'✓':'…'}</li></ul>`;
}
function tagLinks(w){
  const items=[];
  (w.warnings||[]).forEach(x=>items.push(`<li><button class="tagl warn" data-warn="${x}">${esc(WARN[x]||x)}</button></li>`));
  (w.relationships||[]).forEach(t=>items.push(`<li><button class="tagl rel" data-tag="${esc(t)}">${esc(t)}</button></li>`));
  (w.characters||[]).forEach(t=>items.push(`<li><button class="tagl" data-tag="${esc(t)}">${esc(t)}</button></li>`));
  (w.tags||[]).forEach(t=>items.push(`<li><button class="tagl" data-tag="${esc(t)}">${esc(t)}</button></li>`));
  return items.length ? `<ul class="tags commas">${items.join('')}</ul>` : '';
}
const fandomLinks = w => (w.fandoms||[]).map(f=>`<button class="tagl" data-tag="${esc(f)}">${esc(f)}</button>`).join(', ');
const byLink = w => `<button class="lk" data-creator="${esc(w.creator)}" translate="no">${esc(w.creator)}</button>`;
const uplLine = w => w.original ? `<p class="upl">Written for Fic Shelter${w.uploader?` · posted by <span translate="no">${esc(w.uploader)}</span>`:''}</p>` : `<p class="upl">Backup copy${w.fromPdf?' (from a PDF, formatting simplified)':''}${w.uploader?` · shared by <span translate="no">${esc(w.uploader)}</span>`:''}${w.sourceUrl?` · <a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">Read on AO3</a>`:''}</p>`;
function statsDL(w){
  const s=[['Language',esc(w.lang||'English')],['Words',nf.format(w.words||0)],['Chapters',chapLabel(w)]];
  if (w.published) s.push(['Originally posted',esc(w.published)]);
  return `<dl class="stats">${s.map(([a,b])=>`<div><dt>${a}:</dt><dd>${b}</dd></div>`).join('')}</dl>`;
}
function blurb(w, extra=''){
  return `<li class="blurb" role="article">
    <div class="b-head">${reqSquare(w)}
      <div class="hd"><h4><button class="lk title" data-open="${esc(w.id)}">${esc(w.title)}</button> <span class="muted">by</span> ${byLink(w)}</h4>
      <h5>${fandomLinks(w)||'<span class="muted">Original Work</span>'}</h5>${uplLine(w)}</div>
      <p class="date">${fmtDate(w.added)}</p>
    </div>
    ${tagLinks(w)}
    ${w.summary?`<blockquote class="summary">${md(w.summary)}</blockquote>`:''}
    ${w.series&&w.series.name?`<p class="series">Part ${esc(w.series.part||1)} of the series <button class="tagl" data-series="${esc(w.series.name)}">${esc(w.series.name)}</button></p>`:''}
    ${statsDL(w)}
    ${extra}
  </li>`;
}

/* ---------- routing ---------- */
const HASH = {works:'works', fandoms:'fandoms', shelf:'shelf', help:'upload', write:'write'};
function setHash(h){ if (location.hash.slice(1)===h) return; S.ignoreHash=h; location.hash=h; }
window.addEventListener('hashchange',()=>{ const h=location.hash.slice(1); if (h===S.ignoreHash){ S.ignoreHash=null; return; } route(h); });
function route(h){
  if (h.startsWith('work-')) go('work',{id:h.slice(5),ch:0,whole:false},h);
  else if (h==='fandoms') go('fandoms'); else if (h==='shelf') go('shelf'); else if (h==='upload') go('help'); else if (h==='write') go('write'); else go('works');
}
function go(name, extra={}, hash){
  S.view={name,...extra};
  setHash(hash ?? (name==='work' ? 'work-'+extra.id : (HASH[name] ?? '')));
  for (const n of ['works','fandoms','shelf','help','write']){ const b=$('#nav-'+n); if (b) b.setAttribute('aria-current', String(n===name)); }
  render(); window.scrollTo({top:0});
}
function render(){ ({works:renderWorks, fandoms:renderFandoms, work:renderWork, shelf:renderShelf, help:renderHelp, write:renderWrite}[S.view.name]||renderWorks)(); }
function filterBy(patch){ Object.assign(F, freshFilters(), patch); go('works'); }

/* ---------- works listing ---------- */
function renderWorks(){
  view.innerHTML = `<div class="works-page">
    <section style="min-width:0" aria-labelledby="res-h">
      <h2 class="heading" id="res-h">Works</h2>
      <ol class="blurbs" id="results"></ol>
      <nav class="pager" id="pager" aria-label="Pages"></nav>
    </section>
    <aside class="filters"><form id="filt" novalidate><details id="filt-d" open><summary>Sort and Filter</summary>
      <div class="fgroups">
        <div class="fg"><h4><label for="f-sort">Sort by</label></h4><select id="f-sort">${Object.entries(SORTS).map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="fg"><h4><label for="f-q">Search within results</label></h4><input type="search" id="f-q" value="${esc(F.q)}" placeholder="Title, author, summary…"></div>
        <div class="fg"><h4>Including</h4><div class="chips" id="f-inc-chips"></div><input type="text" id="f-inc" placeholder="Other tags to include" aria-label="Other tags to include"></div>
        <fieldset class="fg"><legend>Ratings</legend>${Object.entries(RATINGS).map(([k,r])=>`<label class="ck"><input type="checkbox" name="rating" value="${k}" ${F.ratings.includes(k)?'checked':''}> ${r.l} <span class="n" data-n="rating-${k}"></span></label>`).join('')}</fieldset>
        <fieldset class="fg"><legend>Warnings</legend>${Object.entries(WARN).map(([k,l])=>`<label class="ck"><input type="checkbox" name="warn" value="${k}" ${F.warns.includes(k)?'checked':''}> ${l} <span class="n" data-n="warn-${k}"></span></label>`).join('')}</fieldset>
        <fieldset class="fg"><legend>Categories</legend>${Object.entries(CATS).map(([k,l])=>`<label class="ck"><input type="checkbox" name="cat" value="${k}" ${F.cats.includes(k)?'checked':''}> ${l} <span class="n" data-n="cat-${k}"></span></label>`).join('')}</fieldset>
        <div id="f-dyn" class="fgroups" style="margin:0"></div>
        <div class="fg"><h4><label for="f-exc">Excluding</label></h4><input type="text" id="f-exc" value="${esc(F.exclude.join(', '))}" placeholder="Tags to exclude, comma-separated"></div>
        <fieldset class="fg"><legend>Completion Status</legend>
          ${[['all','All works'],['complete','Complete works only'],['wip','Works in progress only']].map(([k,l])=>`<label class="ck"><input type="radio" name="status" value="${k}" ${F.status===k?'checked':''}> ${l}</label>`).join('')}</fieldset>
        <div class="fg"><h4>Word Count</h4><div class="inline2"><input type="number" min="0" id="f-wmin" placeholder="From" value="${esc(F.wmin)}" aria-label="Words from"><span>–</span><input type="number" min="0" id="f-wmax" placeholder="To" value="${esc(F.wmax)}" aria-label="Words to"></div></div>
        <div class="fg"><h4><label for="f-lang">Language</label></h4><select id="f-lang"></select></div>
        <div class="row"><button type="submit" class="btn primary">Sort and Filter</button><button type="button" class="btn" id="f-clear">Clear Filters</button></div>
      </div></details></form></aside>
  </div>`;
  $('#f-sort').value=F.sort;
  if (matchMedia('(max-width:860px)').matches) $('#filt-d').open=false;
  const form=$('#filt');
  const readText=()=>{ list($('#f-inc').value).forEach(t=>{ if(!F.include.some(x=>norm(x)===norm(t))) F.include.push(t); }); $('#f-inc').value=''; F.exclude=list($('#f-exc').value); F.wmin=$('#f-wmin').value; F.wmax=$('#f-wmax').value; };
  form.addEventListener('change', e=>{
    const t=e.target, toggle=(arr,v,on)=>{ const i=arr.indexOf(v); if(on&&i<0) arr.push(v); if(!on&&i>=0) arr.splice(i,1); };
    if (t.name==='rating') toggle(F.ratings,t.value,t.checked);
    else if (t.name==='warn') toggle(F.warns,t.value,t.checked);
    else if (t.name==='cat') toggle(F.cats,t.value,t.checked);
    else if (t.name==='inc'){ if (t.checked){ if(!F.include.includes(t.value)) F.include.push(t.value); } else F.include=F.include.filter(x=>x!==t.value); }
    else if (t.name==='status') F.status=t.value;
    else if (t.id==='f-sort') F.sort=t.value;
    else if (t.id==='f-lang') F.lang=t.value;
    else if (t.id==='f-q') return;
    else readText();
    F.page=1; renderResults();
  });
  form.addEventListener('submit', e=>{ e.preventDefault(); readText(); F.page=1; renderResults(); });
  $('#f-q').addEventListener('input', e=>{ F.q=e.target.value; F.page=1; renderResults(); });
  $('#f-clear').onclick=()=>{ Object.assign(F, freshFilters()); renderWorks(); };
  renderResults();
}
function applyFilters(works){
  const q=norm(F.q), inc=F.include.map(norm), exc=F.exclude.map(norm);
  return works.filter(w=>{
    if (F.ratings.length && !F.ratings.includes(rk(w))) return false;
    if (F.warns.length && !F.warns.some(x=>(w.warnings||[]).includes(x))) return false;
    if (F.cats.length && !F.cats.some(x=>(w.category||[]).includes(x))) return false;
    if (F.status==='complete' && !w.complete) return false;
    if (F.status==='wip' && w.complete) return false;
    const tg=workTags(w).map(norm);
    if (w.series&&w.series.name) tg.push('series:'+norm(w.series.name));
    if (inc.some(t=>!tg.includes(t))) return false;
    if (exc.some(t=>tg.includes(t))) return false;
    if (F.wmin!=='' && (w.words||0) < +F.wmin) return false;
    if (F.wmax!=='' && (w.words||0) > +F.wmax) return false;
    if (F.lang && (w.lang||'English')!==F.lang) return false;
    if (F.creator && norm(w.creator)!==norm(F.creator)) return false;
    if (q && ![w.title,w.creator,w.summary,...workTags(w)].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
const SORTFN = {
  added:(a,b)=>(b.added||0)-(a.added||0), published:(a,b)=>String(b.published||'').localeCompare(String(a.published||'')),
  words:(a,b)=>(b.words||0)-(a.words||0), chapters:(a,b)=>(b.chapters||[]).length-(a.chapters||[]).length,
  title:(a,b)=>String(a.title).localeCompare(String(b.title)), author:(a,b)=>String(a.creator).localeCompare(String(b.creator))
};
function topCounts(works, fn, n=10){ const c=new Map(); works.forEach(w=>fn(w).forEach(t=>c.set(t,(c.get(t)||0)+1))); return [...c].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,n); }
function renderResults(){
  const box=$('#results'); if (!box) return;
  const works=S.works, out=applyFilters(works).sort(SORTFN[F.sort]||SORTFN.added);
  const pages=Math.max(1,Math.ceil(out.length/PAGE)); if (F.page>pages) F.page=pages;
  const from=(F.page-1)*PAGE, slice=out.slice(from,from+PAGE);
  const where = (F.include.length ? ` in ${F.include.map(t=>t.replace(/^series:/i,'Series: ')).join(' + ')}` : '') + (F.creator ? ` by ${F.creator}` : '');
  $('#res-h').textContent = out.length ? `${nf.format(from+1)} – ${nf.format(from+slice.length)} of ${plural(out.length,'Work','Works')}${where}` : `0 Works${where}`;
  const cnt=(sel,n)=>{ const el=document.querySelector(`[data-n="${sel}"]`); if (el) el.textContent = n?`(${n})`:''; };
  Object.keys(RATINGS).forEach(k=>cnt('rating-'+k, out.filter(w=>rk(w)===k).length));
  Object.keys(WARN).forEach(k=>cnt('warn-'+k, out.filter(w=>(w.warnings||[]).includes(k)).length));
  Object.keys(CATS).forEach(k=>cnt('cat-'+k, out.filter(w=>(w.category||[]).includes(k)).length));
  $('#f-inc-chips').innerHTML = [...F.include.map(t=>`<span class="chip">${esc(t)}<button type="button" data-rminc="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`), F.creator?`<span class="chip">by ${esc(F.creator)}<button type="button" data-rmcreator="1" aria-label="Remove author filter">×</button></span>`:''].join('');
  const groups=[['Fandoms',w=>w.fandoms||[]],['Characters',w=>w.characters||[]],['Relationships',w=>w.relationships||[]],['Additional Tags',w=>w.tags||[]]];
  $('#f-dyn').innerHTML = groups.map(([label,fn])=>{ const top=topCounts(out,fn).filter(([t])=>!F.include.includes(t)); return top.length?`<fieldset class="fg"><legend>${label}</legend>${top.map(([t,n])=>`<label class="ck"><input type="checkbox" name="inc" value="${esc(t)}"> ${esc(t)} <span class="n">(${n})</span></label>`).join('')}</fieldset>`:''; }).join('');
  const langs=[...new Set(works.map(w=>w.lang||'English'))].sort();
  const ls=$('#f-lang'); ls.innerHTML=`<option value="">Any</option>`+langs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join(''); ls.value=F.lang;
  if (!works.length){
    box.innerHTML = `<li class="empty"><span class="muted">${S.ready?'Empty archive':'Loading…'}</span>
      <h3>${S.ready?'No fics have been shared yet':'Loading the archive'}</h3>
      <p>Fics appear here as soon as someone uploads the HTML or EPUB files they saved from AO3.</p>
      ${S.ready?'<button class="btn primary" data-nav="help">How to upload fics</button>':''}</li>`;
  } else if (!out.length) box.innerHTML = `<li class="empty"><h3>No works match these filters</h3><p>Remove a tag or press “Clear Filters”.</p></li>`;
  else box.innerHTML = slice.map(w=>blurb(w)).join('');
  const pg=$('#pager');
  if (pages<=1){ pg.innerHTML=''; return; }
  let b=`<button data-page="${F.page-1}" ${F.page===1?'disabled':''}>← Previous</button>`;
  for (let i=1;i<=pages;i++){ if (pages>9 && i>2 && i<pages-1 && Math.abs(i-F.page)>1){ if (!b.endsWith('…</span>')) b+='<span class="muted" style="align-self:center">…</span>'; continue; } b+=`<button data-page="${i}" aria-current="${i===F.page}">${i}</button>`; }
  b+=`<button data-page="${F.page+1}" ${F.page===pages?'disabled':''}>Next →</button>`;
  pg.innerHTML=b;
}

/* ---------- fandoms ---------- */
function renderFandoms(){
  const c=new Map(); S.works.forEach(w=>(w.fandoms||[]).forEach(f=>c.set(f,(c.get(f)||0)+1)));
  const groups={};
  [...c].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([f,n])=>{ let L=f.normalize('NFD').replace(/[̀-ͯ]/g,'').charAt(0).toUpperCase(); if(!/[A-Z]/.test(L)) L='#'; (groups[L]=groups[L]||[]).push([f,n]); });
  const keys=Object.keys(groups).sort();
  view.innerHTML = `<h2 class="heading">Fandoms</h2>
  ${keys.length?`<nav class="letters" aria-label="Alphabetical index">${keys.map(k=>`<a href="#fandoms" data-jump="L-${k==='#'?'num':k}">${k}</a>`).join('')}</nav>
  <div class="fandom-groups">${keys.map(k=>`<section id="L-${k==='#'?'num':k}"><h3>${k}</h3><ul>${groups[k].map(([f,n])=>`<li><button class="tagl" data-tag="${esc(f)}">${esc(f)}</button> <span class="muted">(${n})</span></li>`).join('')}</ul></section>`).join('')}</div>`
  : `<div class="empty"><h3>${S.ready?'No fandoms yet':'Loading fandoms…'}</h3><p>Fandoms appear here alphabetically once fics are uploaded.</p></div>`}`;
}

/* ---------- work ---------- */
function renderWork(){
  const {id}=S.view; const w=findWork(id);
  if (!w){ view.innerHTML=`<div class="empty"><h3>${S.ready?'This work isn’t available':'Loading work…'}</h3>${S.ready?'<p>It may have been removed at its author’s request.</p>':''}<button class="btn" data-nav="works">Browse works</button></div>`; return; }
  const warnGate=(w.warnings||[]).some(x=>SERIOUS.includes(x)||x==='choose');
  if ((['M','E','N'].includes(rk(w))||warnGate) && !S.gateOk.has(id) && !store.get('adult-ok',false)){
    view.innerHTML = `<div class="gate"><h2>${warnGate?'Before you start: this work has content warnings':'This work could have adult content'}</h2>
      <p>“${esc(w.title)}” is rated <strong>${esc(RATINGS[rk(w)].l)}</strong>${(w.warnings||[]).length?` and has these warnings: <strong>${w.warnings.map(x=>esc(WARN[x]||x)).join(', ')}</strong>`:''}.</p>
      <p class="muted">If you continue, you confirm you’re an adult and want to see this content.</p>
      <label class="row" style="gap:6px"><input type="checkbox" id="gate-always"> Don’t ask me again on this device</label>
      <div class="row"><button class="btn primary" id="gate-yes">Yes, Continue</button><button class="btn" data-nav="works">No, Go Back</button></div></div>`;
    $('#gate-yes').onclick=()=>{ S.gateOk.add(id); if ($('#gate-always').checked) store.set('adult-ok',true); renderWork(); };
    return;
  }
  const h=history(); h[id]=Date.now(); const keys=Object.keys(h).sort((a,b)=>h[b]-h[a]); keys.slice(200).forEach(k=>delete h[k]); store.set('history',h);
  const chs=w.chapters||[]; if (S.view.ch>=chs.length) S.view.ch=0;
  const multi=chs.length>1;
  const dd=(label,html)=>html?`<dt>${label}:</dt><dd>${html}</dd>`:'';
  const tl=(arr,cls='')=>(arr||[]).length?`<ul class="tags commas">${arr.map(t=>`<li><button class="tagl ${cls}" data-tag="${esc(t)}">${esc(t)}</button></li>`).join('')}</ul>`:'';
  view.innerHTML = `<article class="work" id="work-root">
    <ul class="work-nav" aria-label="Work navigation">
      ${multi?`<li><button class="btn sm" id="wn-mode">${S.view.whole?'Chapter by Chapter':'Entire Work'}</button></li>
      <li><button class="btn sm" data-chstep="-1">← Previous Chapter</button></li>
      <li><select id="wn-idx" aria-label="Chapter index">${chs.map((c,i)=>`<option value="${i}">${i+1}. ${esc(c.title||'Chapter '+(i+1))}</option>`).join('')}</select></li>
      <li><button class="btn sm" data-chstep="1">Next Chapter →</button></li>`:''}
      ${S.config.giscus&&S.config.giscus.repoId?'<li><button class="btn sm" id="wn-com">Comments</button></li>':''}
      <li><button class="btn sm" id="wn-bm"></button></li>
      <li><button class="btn sm" id="wn-later"></button></li>
      ${ao3Id(w.sourceUrl)?`<li>${extLink(waybackUrl(ao3Id(w.sourceUrl)),'Wayback Machine copy','btn sm')}</li>`:''}
    </ul>
    ${w.sourceUrl?`<div class="ao3-cta">${extLink(w.sourceUrl,'Read on AO3 ♥','btn primary')}<p>This is a backup copy. Reading on AO3 counts as a hit for <span translate="no">${esc(w.creator)}</span>, and there you can leave kudos and comments.</p></div>`:''}
    <dl class="meta" aria-label="Work details">
      ${dd('Rating',`<button class="tagl" data-rating="${rk(w)}">${esc(RATINGS[rk(w)].l)}</button>`)}
      ${dd('Archive Warning',(w.warnings||[]).map(x=>`<button class="tagl warn" data-warn="${x}">${esc(WARN[x]||x)}</button>`).join(', '))}
      ${dd('Category',(w.category||[]).map(x=>`<button class="tagl" data-cat="${x}">${esc(CATS[x]||x)}</button>`).join(', '))}
      ${dd('Fandom',fandomLinks(w))}
      ${dd('Relationships',tl(w.relationships,'rel'))}
      ${dd('Characters',tl(w.characters))}
      ${dd('Additional Tags',tl(w.tags))}
      ${dd('Language',esc(w.lang||'English'))}
      ${w.series&&w.series.name?dd('Series',`Part ${esc(w.series.part||1)} of <button class="tagl" data-series="${esc(w.series.name)}">${esc(w.series.name)}</button>`):''}
      <dt>Stats:</dt><dd>${statsDL(w)}</dd>
    </dl>
    <div class="preface">
      <div class="titles"><h2 class="title">${esc(w.title)}</h2><p class="byline">by ${byLink(w)}</p>${uplLine(w)}</div>
      ${w.summary?`<div class="notesbox"><h3>Summary:</h3><blockquote>${md(w.summary)}</blockquote></div>`:''}
      ${w.notes?`<div class="notesbox"><h3>Notes:</h3><blockquote>${md(w.notes)}</blockquote></div>`:''}
    </div>
    <div class="sizer"><label class="muted" for="rd-mode" style="font-size:.85rem">Reading</label><select id="rd-mode" style="width:auto"><option value="orig">Original only</option><option value="bi">Original + translation</option></select><span class="muted" style="font-size:.85rem;margin-left:8px">Text size</span><button class="btn sm" id="sz-dn" aria-label="Smaller text">A−</button><button class="btn sm" id="sz-up" aria-label="Larger text">A+</button></div>
    <details class="translate-help"><summary>Translate this fic (Spanish ⇄ English)</summary>
      <p>Your browser translates it on your device. Nothing is saved or published.</p>
      <ol>
        <li>Choose <strong>Original + translation</strong> above to keep each paragraph in its original language, with the translation underneath. Or keep <strong>Original only</strong> to translate the text in place.</li>
        <li>Then translate the page. <strong>Chrome or Edge on a computer:</strong> right-click → Translate. <strong>Chrome on Android:</strong> ⋮ menu → Translate. <strong>Safari on iPhone or iPad:</strong> the <strong>aA</strong> button → Translate.</li>
      </ol>
      <p>Character names, nicknames and honorifics like <em>hyung</em> or <em>-san</em> stay exactly as the author wrote them, so the translation keeps the original flavour.</p>
    </details>
    <div class="chapters" id="chapters" aria-live="polite"><p class="muted" style="text-align:center">Loading…</p></div>
    <div class="preface" id="endnotes"></div>
    <ul class="work-nav">${multi&&!S.view.whole?`<li><button class="btn sm" data-chstep="-1">← Previous Chapter</button></li>`:''}<li><button class="btn sm" id="wn-top">↑ Top</button></li>${multi&&!S.view.whole?`<li><button class="btn sm" data-chstep="1">Next Chapter →</button></li>`:''}</ul>
    <section class="feedback" id="feedback">
      ${ao3Id(w.sourceUrl)?`<p class="kudos-line">Want to see it as it was on AO3? Try the ${extLink(waybackUrl(ao3Id(w.sourceUrl)),'Wayback Machine copy')} or browse ${extLink(waybackAll(ao3Id(w.sourceUrl)),'all saved copies')}. Not every fic was saved, and adult-rated works sometimes only show AO3’s warning page.</p>`:''}
      ${w.sourceUrl?`<p class="kudos-line">Loved it? Leave kudos and a comment for <span translate="no">${esc(w.creator)}</span> on <a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">the original work</a>.</p>`:''}
      ${S.config.giscus&&S.config.giscus.repoId?'<h3 id="com-h">Comments</h3><div class="giscus-wrap"><div class="giscus"></div></div>':''}
    </section>
  </article>`;
  if (multi){ $('#wn-idx').value=S.view.ch; $('#wn-idx').onchange=e=>{ S.view.ch=+e.target.value; S.view.whole=false; renderWork(); scrollToChapters(); }; $('#wn-mode').onclick=()=>{ S.view.whole=!S.view.whole; renderWork(); }; }
  const com=$('#wn-com'); if (com) com.onclick=()=>$('#feedback').scrollIntoView({behavior:'smooth'});
  $('#wn-top').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
  const paintPrefs=()=>{ $('#wn-bm').textContent = marks()[id] ? 'Remove Bookmark' : 'Bookmark'; $('#wn-later').textContent = later()[id] ? 'Mark as Read' : 'Mark for Later'; };
  $('#wn-bm').onclick=()=>{ const m=marks(); if (m[id]) delete m[id]; else m[id]=Date.now(); store.set('bookmarks',m); paintPrefs(); toast(m[id]?'Bookmarked on this device.':'Bookmark removed.'); };
  $('#wn-later').onclick=()=>{ const l=later(); if (l[id]) delete l[id]; else l[id]=Date.now(); store.set('later',l); paintPrefs(); toast(l[id]?'Marked for later.':'Marked as read.'); };
  paintPrefs();
  $('#sz-dn').onclick=()=>setReaderSize(readerSize()-.06);
  $('#sz-up').onclick=()=>setReaderSize(readerSize()+.06);
  $('#rd-mode').value=store.get('read-mode','orig');
  $('#rd-mode').onchange=e=>{ store.set('read-mode',e.target.value); loadChapters(w); };
  const fb=$('#feedback'); if (!fb.textContent.trim() && !fb.querySelector('.giscus')) fb.hidden=true;
  loadChapters(w); mountGiscus(w);
}
function scrollToChapters(){ const c=$('#chapters'); if (c) window.scrollTo({top:c.getBoundingClientRect().top+scrollY-70}); }
const LANGCODE = {english:'en', 'español':'es', espanol:'es', spanish:'es', 'português':'pt', portugues:'pt', 'français':'fr', francais:'fr', deutsch:'de', italiano:'it', '한국어':'ko', korean:'ko', '日本語':'ja', japanese:'ja', 'русский':'ru', polski:'pl', 'bahasa indonesia':'id', 'tiếng việt':'vi'};
const langCode = w => LANGCODE[norm(w.lang||'English')] || '';
const HONORIFICS = ['hyung','hyungie','noona','nuna','oppa','unnie','eonni','sunbae','sunbaenim','hoobae','maknae','jagiya','jagi','aegi','eomma','umma','appa','senpai','sensei','kouhai','onii-chan','onee-chan','nii-san','nee-san'];
// Names, nicknames and honorifics that the browser should leave untranslated.
function glossary(w){
  const terms=new Set(), cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
  const add=t=>{ t=String(t||'').replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim(); if (t.length>=2) terms.add(t); };
  const addName=n=>{ add(n); n.replace(/\([^)]*\)/g,' ').trim().split(/\s+/).forEach(p=>{ if (p.length>=3 && /^\p{Lu}/u.test(p)) add(p); }); };
  (w.characters||[]).forEach(addName);
  (w.relationships||[]).forEach(r=>r.replace(/\([^)]*\)/g,' ').split(/[\/&]/).forEach(addName));
  HONORIFICS.forEach(h=>{ add(h); add(cap(h)); });
  return [...terms].sort((a,b)=>b.length-a.length);
}
function protect(html, terms){
  const alts=terms.map(t=>esc(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const re=new RegExp('(?<![\\p{L}\\p{N}])(?:(?:'+(alts.join('|')||'(?!)')+')(?:-(?:san|kun|chan|sama|nim|ssi|ah|ya))?|\\p{L}+-(?:san|kun|chan|sama|nim|ssi))(?![\\p{L}\\p{N}])','gu');
  return html.replace(/(<[^>]+>)|([^<]+)/g,(m,tag,text)=>tag?tag:text.replace(re,'<span translate="no" class="term">$&</span>'));
}
function bodyHTML(w, text){
  const terms=glossary(w), lc=langCode(w), la=lc?` lang="${lc}"`:'', blocks=mdBlocks(text);
  if (store.get('read-mode','orig')!=='bi') return protect(blocks.join(''),terms);
  return blocks.map(b=> b==='<hr>' ? b : `<div class="bi"><div class="bi-orig" translate="no"${la}>${b}</div><div class="bi-tr"${la}>${protect(b,terms)}</div></div>`).join('');
}
function chapterHTML(w,i,d){
  const c=w.chapters[i], multi=w.chapters.length>1, t=c.title;
  return `<section class="chapter" id="ch-${i}">
    ${multi||t?`<h3 class="chap-title">${multi?`Chapter ${i+1}`:''}${multi&&t?': ':''}${esc(t||'')}</h3>`:''}
    ${d&&d.notes?`<div class="cnotes"><h4>Notes:</h4>${md(d.notes)}</div>`:''}
    <div class="userstuff"${langCode(w)?` lang="${langCode(w)}"`:''}>${d?bodyHTML(w,d.body):'<p class="muted">Loading chapter…</p>'}</div>
    ${d&&d.endNotes?`<div class="cnotes"><h4>Chapter End Notes:</h4>${md(d.endNotes)}</div>`:''}
  </section>`;
}
async function loadChapters(w){
  if (!S.chCache.has(w.id)){
    try{ const r=await fetch(`data/works/${encodeURIComponent(w.id)}.json`); if (!r.ok) throw 0; S.chCache.set(w.id,(await r.json()).chapters||[]); }
    catch{ if ($('#chapters')) $('#chapters').innerHTML='<p class="muted" style="text-align:center">Couldn’t load the text. Check your connection and reload.</p>'; return; }
  }
  if (!$('#chapters') || S.view.id!==w.id) return;
  const data=S.chCache.get(w.id), idxs = S.view.whole ? w.chapters.map((_,i)=>i) : [S.view.ch];
  $('#chapters').innerHTML = idxs.map(i=>chapterHTML(w,i,data[i])).join('');
  $('#endnotes').innerHTML = idxs.includes(w.chapters.length-1) && w.endNotes ? `<div class="notesbox"><h3>End Notes:</h3><blockquote>${md(w.endNotes)}</blockquote></div>` : '';
}
function mountGiscus(w){
  const g=S.config.giscus; const box=document.querySelector('.giscus'); if (!g||!g.repoId||!box) return;
  const s=document.createElement('script');
  const attrs={src:'https://giscus.app/client.js','data-repo':g.repo,'data-repo-id':g.repoId,'data-category':g.category||'Comments','data-category-id':g.categoryId,
    'data-mapping':'specific','data-term':'work-'+w.id,'data-strict':'1','data-reactions-enabled':'1','data-emit-metadata':'0','data-input-position':'top',
    'data-theme':'preferred_color_scheme','data-lang':'en','data-loading':'lazy',crossorigin:'anonymous',async:''};
  for (const [k,v] of Object.entries(attrs)) s.setAttribute(k,v);
  box.appendChild(s);
}

/* ---------- my shelf (this device) ---------- */
function renderShelf(){
  const sec=(id,title,entries,empty,action)=>{ const ws=entries.map(([wid,at])=>({w:findWork(wid),at})).filter(x=>x.w);
    return `<section class="dash-sec" id="${id}"><h3 class="landmark">${title} <span class="muted" style="font-weight:400">(${ws.length})</span></h3>${ws.length?`<ol class="blurbs">${ws.map(({w,at})=>blurb(w,`<div class="owner"><span class="formnote" style="margin-right:auto">${action.label} ${fmtDate(at)}</span><button class="btn sm" data-${action.key}="${esc(w.id)}">${action.btn}</button></div>`)).join('')}</ol>`:`<p class="muted">${empty}</p>`}</section>`; };
  const byTime=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]);
  view.innerHTML=`<h2 class="heading">My Shelf</h2>
    <p class="muted" style="margin-bottom:16px">Saved only in this browser, on this device. No account needed.</p>
    ${sec('s-later','Marked for Later',byTime(later()),'Press “Mark for Later” on a work to save it here.',{label:'Saved',key:'unlater',btn:'Mark as Read'})}
    ${sec('s-bm','Bookmarks',byTime(marks()),'Press “Bookmark” on a work to keep it here.',{label:'Bookmarked',key:'unbm',btn:'Remove Bookmark'})}
    ${sec('s-hist','History',byTime(history()).slice(0,30),'Works you open will show up here.',{label:'Last read',key:'unhist',btn:'Remove from History'})}`;
}

/* ---------- upload help ---------- */
function renderHelp(){
  const repo=S.config.repoUrl||'', up=repo?repo+'/upload/main/fics':'', issues=repo?repo+'/issues/new':'';
  view.innerHTML=`<div class="help">
    <h2 class="heading" style="margin:0">Upload Fics</h2>
    <div class="rules"><strong>A backup shelf for fics you’ve saved</strong><ul>
      <li>AO3 is back, so please read, leave kudos and comment there. Fic Shelter keeps backups in case it goes down again.</li>
      <li>Upload copies you downloaded from AO3 as <strong>HTML</strong>, <strong>EPUB</strong> or <strong>PDF</strong>, without changing them.</li>
      <li>The original author, tags, summary and link are read from the file and always shown.</li>
      <li>Fics with the “Underage” warning are not published here.</li>
      <li>If an author asks for their work to be taken down, it will be removed.</li></ul></div>
    <section class="panel"><h3 style="font-size:1.05rem">How to upload</h3>
      <ol class="steps">
        <li>You need a free GitHub account, and the archive’s organiser has to add you as a collaborator.</li>
        <li>If your fics are in Google Drive, download them to your device first.</li>
        <li>Open ${up?`<a href="${esc(up)}" target="_blank" rel="noopener">the upload page</a>`:'the upload page of this site’s repository (<code>fics</code> folder)'} and drag the files in. You can drop many at once.</li>
        <li>At the bottom, press <strong>Commit changes</strong>.</li>
        <li>Wait 1–2 minutes and reload this site. Your fics will be there, credited to their authors.</li>
      </ol>
      <p class="formnote">HTML and EPUB give the best result. PDFs work too (including AO3 pages saved as PDF from Safari or Chrome), but italics and bold are lost and a paragraph may occasionally be split or joined. MOBI, AZW3 and broken files are skipped.</p></section>
    <section class="panel"><h3 style="font-size:1.05rem">Want to post your own fic?</h3>
      <p>Use the <button class="lk" data-nav="write">Write</button> page: fill in the tags and chapters, then publish it to GitHub in two clicks.</p></section>
    <section class="panel"><h3 style="font-size:1.05rem">Nobody has a fic saved? Try the Wayback Machine</h3>
      <p>The Internet Archive saved copies of many AO3 works. Paste a fic’s AO3 link or work number to look for it.</p>
      <div class="inline2"><input type="text" id="wb-in" placeholder="https://archiveofourown.org/works/123456" aria-label="AO3 link or work number"></div>
      <p id="wb-out" class="formnote">The links will appear here.</p>
      <p class="formnote">Popular works are often there; small or recent ones often aren’t. If you find a full copy, you can save it with your browser (Ctrl + S, “Webpage, HTML only”) and upload that file here.</p></section>
    <section class="panel"><h3 style="font-size:1.05rem">Are you the author of a fic here?</h3>
      <p>${issues?`<a href="${esc(issues)}" target="_blank" rel="noopener">Open an issue</a> with the link to your work`:'Contact the organiser with the link to your work'} and it will be removed.</p></section>
  </div>`;
  const inp=$('#wb-in'), out=$('#wb-out');
  inp.addEventListener('input', ()=>{
    const v=inp.value.trim(), id=ao3Id(v) || (/^\d+$/.test(v)?v:'');
    out.innerHTML = id ? `${extLink(waybackUrl(id),'Open the latest saved copy','btn sm')} ${extLink(waybackAll(id),'See all saved copies')}` : (v?'That doesn’t look like an AO3 work link. It should contain /works/ and a number.':'The links will appear here.');
  });
}

/* ---------- write a fic ---------- */
const blankChapter = () => ({title:'', notes:'', body:'', endNotes:''});
const blankDraft = () => ({title:'', author:'', rating:'', warns:[], cats:[], fandoms:'', rels:'', chars:'', tags:'', lang:'English', series:'', part:'', total:'', summary:'', notes:'', endNotes:'', chapters:[blankChapter()]});
const countWords = s => (String(s||'').trim().match(/\S+/g)||[]).length;
const slugify = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'my-fic';
let draftT;
function readDraft(){
  const v=id=>{ const el=$('#'+id); return el?el.value:''; }, checked=n=>[...document.querySelectorAll(`input[name="${n}"]:checked`)].map(x=>x.value);
  return { title:v('w-title'), author:v('w-author'), rating:v('w-rating'), warns:checked('w-warn'), cats:checked('w-cat'), fandoms:v('w-fandoms'), rels:v('w-rels'), chars:v('w-chars'), tags:v('w-tags'),
    lang:v('w-lang'), series:v('w-series'), part:v('w-part'), total:v('w-total'), summary:v('w-summary'), notes:v('w-notes'), endNotes:v('w-endnotes'),
    chapters:[...document.querySelectorAll('.wch')].map(ch=>({title:ch.querySelector('.ch-title').value, notes:ch.querySelector('.ch-notes').value, body:ch.querySelector('.ch-body').value, endNotes:ch.querySelector('.ch-end').value})) };
}
function saveDraft(){ const d=readDraft(); store.set('draft',d); const n=d.chapters.reduce((s,c)=>s+countWords(c.body),0); const wc=$('#w-count'); if (wc) wc.textContent=`${plural(n,'word','words')} · draft saved on this device`; document.querySelectorAll('.wch').forEach((ch,i)=>{ const c=ch.querySelector('.ch-wc'); if (c) c.textContent=plural(countWords(d.chapters[i].body),'word','words'); }); }
function toFile(d){
  const L=['---'], one=(k,v)=>{ v=String(v||'').replace(/\s*\n\s*/g,' ').trim(); if (v) L.push(`${k}: ${v}`); };
  const block=(k,v)=>{ v=String(v||'').replace(/\r/g,'').trim(); if (!v) return; L.push(`${k}: |`); v.split('\n').forEach(l=>L.push('  '+l)); };
  one('title',d.title); one('author',d.author); one('rating',(RATINGS[d.rating]||RATINGS.N).l);
  one('warnings',d.warns.map(x=>WARN[x]).join(', ')); one('categories',d.cats.map(x=>CATS[x]).join(', '));
  one('fandoms',d.fandoms); one('relationships',d.rels); one('characters',d.chars); one('tags',d.tags); one('language',d.lang||'English');
  if (d.series.trim()) one('series',`${d.series.trim()} | ${parseInt(d.part,10)||1}`);
  one('chapters_total',parseInt(d.total,10)||'?');
  block('summary',d.summary); block('notes',d.notes); block('end_notes',d.endNotes);
  L.push('---','');
  const para=s=>String(s||'').replace(/\r/g,'').trim().replace(/\n\s*\n/g,'\n');
  d.chapters.filter(c=>c.body.trim()).forEach((c,i)=>{
    L.push(`# Chapter ${i+1}${c.title.trim()?': '+c.title.replace(/\s*\n\s*/g,' ').trim():''}`,'');
    if (c.notes.trim()) L.push('Notes: '+para(c.notes),'');
    L.push(c.body.replace(/\r/g,'').trim().replace(/^# /gm,'\\# '),'');
    if (c.endNotes.trim()) L.push('End notes: '+para(c.endNotes),'');
  });
  return L.join('\n');
}
function draftProblems(d){
  const p=[];
  if (!d.title.trim()) p.push('a title'); if (!d.author.trim()) p.push('your pseud'); if (!d.rating) p.push('a rating');
  if (!d.warns.length) p.push('at least one archive warning'); if (!d.fandoms.trim()) p.push('a fandom (write “Original Work” if it’s not fanfic)');
  if (!d.chapters.some(c=>c.body.trim())) p.push('the text of at least one chapter');
  return p;
}
function renderWrite(){
  const d=Object.assign(blankDraft(), store.get('draft',{}));
  if (!d.chapters||!d.chapters.length) d.chapters=[blankChapter()];
  const f=(id,label,hint,control,req)=>`<div class="frow"><label class="lab" for="${id}">${label}${req?' <span class="req-star" aria-hidden="true">*</span>':''}${hint?`<small>${hint}</small>`:''}</label><div>${control}</div></div>`;
  const txt=(id,val,ph='')=>`<input type="text" id="${id}" value="${esc(val)}" placeholder="${esc(ph)}">`;
  const area=(id,val,rows=3,ph='')=>`<textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
  view.innerHTML=`<div class="help write">
    <h2 class="heading" style="margin:0">Write a Fic</h2>
    <div class="rules"><strong>Post your own work on Fic Shelter</strong><ul>
      <li>Your draft is saved in this browser as you type, so you can come back later on this device.</li>
      <li>When it’s ready, press <strong>Publish on GitHub</strong>. The fic is copied, GitHub opens, you paste it and press <strong>Commit changes</strong>. You need to be a collaborator on the site’s repository.</li>
      <li>Leave a blank line between paragraphs. Use *italics*, **bold** and a line with *** for a scene break.</li>
      <li>Rate and warn honestly. Sexual content involving minors isn’t allowed and won’t be published.</li></ul></div>
    <form id="wf" class="post-form" novalidate>
      <fieldset class="panel"><legend>Tags</legend>
        ${f('w-rating','Rating','',`<select id="w-rating"><option value="">Choose a rating</option>${Object.entries(RATINGS).map(([k,r])=>`<option value="${k}" ${d.rating===k?'selected':''}>${r.l}</option>`).join('')}</select>`,true)}
        <div class="frow"><span class="lab">Archive Warnings <span class="req-star" aria-hidden="true">*</span><small>Check all that apply</small></span><div class="ckgrid">${Object.entries(WARN).map(([k,l])=>`<label><input type="checkbox" name="w-warn" value="${k}" ${d.warns.includes(k)?'checked':''}> ${l}</label>`).join('')}</div></div>
        ${f('w-fandoms','Fandoms','Comma-separated',txt('w-fandoms',d.fandoms,'e.g. ATEEZ (Band)'),true)}
        <div class="frow"><span class="lab">Categories</span><div class="ckgrid">${Object.entries(CATS).map(([k,l])=>`<label><input type="checkbox" name="w-cat" value="${k}" ${d.cats.includes(k)?'checked':''}> ${l}</label>`).join('')}</div></div>
        ${f('w-rels','Relationships','Comma-separated. “/” for romantic, “&” for platonic',txt('w-rels',d.rels,'Character A/Character B'))}
        ${f('w-chars','Characters','Comma-separated. Their names stay untranslated when readers translate your fic',txt('w-chars',d.chars))}
        ${f('w-tags','Additional Tags','Comma-separated',txt('w-tags',d.tags,'Fluff, Alternate Universe, Slow Burn'))}
      </fieldset>
      <fieldset class="panel"><legend>Preface</legend>
        ${f('w-title','Work Title','',txt('w-title',d.title),true)}
        ${f('w-author','Pseud','The name you write under',txt('w-author',d.author),true)}
        ${f('w-summary','Summary','',area('w-summary',d.summary,4))}
        ${f('w-notes','Beginning Notes','Optional',area('w-notes',d.notes))}
        ${f('w-endnotes','End Notes','Optional',area('w-endnotes',d.endNotes))}
      </fieldset>
      <fieldset class="panel"><legend>Associations</legend>
        ${f('w-series','Series','Optional',`<div class="inline2"><input type="text" id="w-series" value="${esc(d.series)}" placeholder="Series name"><label for="w-part" class="muted">Part</label><input type="number" id="w-part" min="1" style="max-width:80px" value="${esc(d.part)}"></div>`)}
        ${f('w-lang','Language','The language you’re writing in',txt('w-lang',d.lang))}
        ${f('w-total','Planned chapters','Leave blank if you don’t know yet',`<input type="number" id="w-total" min="1" style="max-width:120px" value="${esc(d.total)}" placeholder="?">`)}
      </fieldset>
      <div id="w-chapters" class="write-chapters">${d.chapters.map((c,i)=>chapterEditor(c,i,d.chapters.length)).join('')}</div>
      <div class="row"><button type="button" class="btn" id="w-addch">+ Add chapter</button></div>
    </form>
    <div class="panel write-actions">
      <p class="formnote" id="w-count"></p>
      <div class="row"><button type="button" class="btn primary" id="w-pub">Publish on GitHub</button><button type="button" class="btn" id="w-dl">Download file</button><button type="button" class="btn" id="w-prev">Preview</button><span style="margin-left:auto" id="w-clear-wrap"><button type="button" class="btn danger" id="w-clear">Start over</button></span></div>
      <div id="w-msg" class="formnote" role="status"></div>
    </div>
    <div id="w-preview"></div>
  </div>`;
  saveDraft();
  $('#wf').addEventListener('input',()=>{ clearTimeout(draftT); draftT=setTimeout(saveDraft,400); });
  $('#wf').addEventListener('change',saveDraft);
  $('#w-addch').onclick=()=>{ const cur=readDraft(); cur.chapters.push(blankChapter()); store.set('draft',cur); renderWrite(); const all=document.querySelectorAll('.wch'); all[all.length-1].scrollIntoView({behavior:'smooth'}); };
  $('#w-chapters').addEventListener('click',e=>{ const b=e.target.closest('[data-rmch]'); if (!b) return; const cur=readDraft(); cur.chapters.splice(+b.dataset.rmch,1); store.set('draft',cur); renderWrite(); });
  $('#w-clear').onclick=()=>{ const w=$('#w-clear-wrap'); w.innerHTML='<span class="confirm">Delete this draft? <button type="button" class="btn sm danger" id="w-clear-yes">Delete</button> <button type="button" class="btn sm" id="w-clear-no">Keep</button></span>';
    $('#w-clear-yes').onclick=()=>{ store.set('draft',blankDraft()); renderWrite(); toast('Draft deleted.'); }; $('#w-clear-no').onclick=()=>renderWrite(); };
  const ready=()=>{ saveDraft(); const dd=readDraft(), p=draftProblems(dd); if (p.length){ $('#w-msg').innerHTML=`<span class="errline">Before publishing, add ${esc(p.join(', '))}.</span>`; return null; } return dd; };
  $('#w-prev').onclick=()=>{ const dd=readDraft(); const w={id:'preview',title:dd.title||'Untitled',creator:dd.author||'you',lang:dd.lang,characters:list(dd.chars),relationships:list(dd.rels),chapters:dd.chapters.filter(c=>c.body.trim()).map(c=>({title:c.title}))};
    const box=$('#w-preview'); box.innerHTML=`<div class="panel"><div class="preface"><div class="titles"><h2 class="title">${esc(w.title)}</h2><p class="byline">by ${esc(w.creator)}</p></div>${dd.summary?`<div class="notesbox"><h3>Summary:</h3><blockquote>${md(dd.summary)}</blockquote></div>`:''}</div>
      <div class="chapters">${dd.chapters.filter(c=>c.body.trim()).map((c,i)=>chapterHTML(w,i,c)).join('')||'<p class="muted">Nothing to preview yet.</p>'}</div></div>`; box.scrollIntoView({behavior:'smooth'}); };
  $('#w-dl').onclick=()=>{ const dd=ready(); if (!dd) return; const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([toFile(dd)],{type:'text/markdown'})); a.download=slugify(dd.title)+'.md'; document.body.appendChild(a); a.click(); a.remove(); $('#w-msg').textContent='File downloaded. You can upload it to the fics/written folder on GitHub.'; };
  $('#w-pub').onclick=()=>{
    const dd=ready(); if (!dd) return;
    const repo=S.config.repoUrl; if (!repo){ $('#w-msg').textContent='The site doesn’t know its GitHub repository yet. Use “Download file” and upload it to the fics/written folder instead.'; return; }
    const name=slugify(dd.title)+'.md', text=toFile(dd), url=`${repo}/new/main/fics/written?filename=${encodeURIComponent(name)}`;
    const win=window.open(url,'_blank','noopener');
    const done=ok=>{ $('#w-msg').innerHTML = ok
      ? `<strong>Copied!</strong> In the GitHub tab, click the big editor, paste with <strong>Ctrl + V</strong> (or long-press → Paste on a phone) and press <strong>Commit changes</strong>. Your fic appears here 1–2 minutes later.${win?'':` If GitHub didn’t open, <a href="${esc(url)}" target="_blank" rel="noopener">open it here</a>.`}`
      : `Your browser didn’t let the site copy the text. Select everything in the box below, copy it, then paste it on <a href="${esc(url)}" target="_blank" rel="noopener">GitHub</a>.<textarea readonly rows="8" style="margin-top:8px" id="w-out">${esc(text)}</textarea>`;
      const o=$('#w-out'); if (o){ o.focus(); o.select(); } };
    navigator.clipboard ? navigator.clipboard.writeText(text).then(()=>done(true),()=>done(false)) : done(false);
  };
}
function chapterEditor(c,i,n){
  return `<fieldset class="panel wch"><legend>Chapter ${i+1}</legend>
    <div class="frow"><label class="lab" for="ch-title-${i}">Chapter Title<small>Optional</small></label><div><input type="text" class="ch-title" id="ch-title-${i}" value="${esc(c.title)}"></div></div>
    <div class="frow"><label class="lab" for="ch-notes-${i}">Chapter Notes<small>Optional, shown before the chapter</small></label><div><textarea class="ch-notes" id="ch-notes-${i}" rows="2">${esc(c.notes)}</textarea></div></div>
    <div class="frow"><label class="lab" for="ch-body-${i}">Chapter Text <span class="req-star" aria-hidden="true">*</span><small class="ch-wc"></small></label><div><textarea class="ch-body" id="ch-body-${i}" rows="16" placeholder="Write or paste your chapter here…">${esc(c.body)}</textarea></div></div>
    <div class="frow"><label class="lab" for="ch-end-${i}">Chapter End Notes<small>Optional</small></label><div><textarea class="ch-end" id="ch-end-${i}" rows="2">${esc(c.endNotes)}</textarea></div></div>
    ${n>1?`<div class="row" style="justify-content:flex-end"><button type="button" class="btn sm danger" data-rmch="${i}">Remove this chapter</button></div>`:''}
  </fieldset>`;
}

/* ---------- global events ---------- */
$('#top-search').addEventListener('submit', e=>{ e.preventDefault(); filterBy({q:$('#top-q').value.trim()}); });
document.addEventListener('click', e=>{
  const a=e.target.closest('[data-jump]'); if (a){ e.preventDefault(); const t=document.getElementById(a.dataset.jump); if (t) window.scrollTo({top:t.getBoundingClientRect().top+scrollY-60}); return; }
  const t=e.target.closest('button'); if (!t) return;
  const d=t.dataset;
  if (d.nav){ e.preventDefault(); if (d.nav==='works') Object.assign(F, freshFilters()); go(d.nav); }
  else if (d.open) go('work',{id:d.open,ch:0,whole:false});
  else if (d.creator) filterBy({creator:d.creator});
  else if (d.tag) filterBy({include:[d.tag]});
  else if (d.series) filterBy({include:['series:'+d.series], sort:'title'});
  else if (d.warn) filterBy({warns:[d.warn]});
  else if (d.rating) filterBy({ratings:[d.rating]});
  else if (d.cat) filterBy({cats:[d.cat]});
  else if (d.page){ F.page=+d.page; renderResults(); window.scrollTo({top:0}); }
  else if (d.rminc){ F.include=F.include.filter(x=>x!==d.rminc); F.page=1; renderResults(); }
  else if (d.rmcreator){ F.creator=''; F.page=1; renderResults(); }
  else if (d.chstep){ const w=findWork(S.view.id); const n=S.view.ch+(+d.chstep); if (w && n>=0 && n<w.chapters.length){ S.view.ch=n; S.view.whole=false; renderWork(); scrollToChapters(); } }
  else if (d.unlater){ const l=later(); delete l[d.unlater]; store.set('later',l); renderShelf(); }
  else if (d.unbm){ const m=marks(); delete m[d.unbm]; store.set('bookmarks',m); renderShelf(); }
  else if (d.unhist){ const h=history(); delete h[d.unhist]; store.set('history',h); renderShelf(); }
});

/* ---------- boot ---------- */
route(location.hash.slice(1));
(async()=>{
  try{
    const [idx,cfg]=await Promise.all([fetch('data/index.json',{cache:'no-cache'}).then(r=>r.json()), fetch('data/config.json',{cache:'no-cache'}).then(r=>r.json()).catch(()=>({}))]);
    const gh=location.hostname.match(/^([^.]+)\.github\.io$/), repoName=location.pathname.split('/').filter(Boolean)[0];
    if (gh && repoName) cfg.repoUrl=`https://github.com/${gh[1]}/${repoName}`;
    S.works=idx; S.byId=new Map(idx.map(w=>[w.id,w])); S.config=cfg; S.ready=true; setStatus('');
    if (cfg.repoUrl){ const h=$('#takedown-hint'); if (h) h.innerHTML=`<a href="${esc(cfg.repoUrl)}/issues/new" target="_blank" rel="noopener">open an issue here</a>`; }
    render();
  }catch{ setStatus('Couldn’t load the archive. Check your connection and reload the page.', true); }
})();
})();