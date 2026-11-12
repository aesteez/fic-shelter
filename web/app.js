(() => {
const RATINGS = {G:{s:'G',l:'General Audiences'}, T:{s:'T',l:'Teen And Up Audiences'}, M:{s:'M',l:'Mature'}, E:{s:'E',l:'Explicit'}, N:{s:'–',l:'Not Rated'}};
const WARN = {choose:'Creator Chose Not To Use Archive Warnings', none:'No Archive Warnings Apply', violence:'Graphic Depictions Of Violence', death:'Major Character Death', noncon:'Rape/Non-Con'};
const SERIOUS = ['violence','death','noncon'];
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
function md(src){
  return esc(src||'').replace(/\r/g,'').split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean)
    .map(b => /^(\*\s*){3,}$|^-{3,}$|^~{3,}$/.test(b) ? '<hr>' : '<p>'+inline(b).replace(/\n/g,'<br>')+'</p>').join('');
}
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
const uplLine = w => `<p class="upl">Archived copy${w.uploader?` · shared by <span translate="no">${esc(w.uploader)}</span>`:''}${w.sourceUrl?` · <a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">original on AO3</a>`:''}</p>`;
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
const HASH = {works:'works', fandoms:'fandoms', shelf:'shelf', help:'upload'};
function setHash(h){ if (location.hash.slice(1)===h) return; S.ignoreHash=h; location.hash=h; }
window.addEventListener('hashchange',()=>{ const h=location.hash.slice(1); if (h===S.ignoreHash){ S.ignoreHash=null; return; } route(h); });
function route(h){
  if (h.startsWith('work-')) go('work',{id:h.slice(5),ch:0,whole:false},h);
  else if (h==='fandoms') go('fandoms'); else if (h==='shelf') go('shelf'); else if (h==='upload') go('help'); else go('works');
}
function go(name, extra={}, hash){
  S.view={name,...extra};
  setHash(hash ?? (name==='work' ? 'work-'+extra.id : (HASH[name] ?? '')));
  for (const n of ['works','fandoms','shelf','help']){ const b=$('#nav-'+n); if (b) b.setAttribute('aria-current', String(n===name)); }
  render(); window.scrollTo({top:0});
}
function render(){ ({works:renderWorks, fandoms:renderFandoms, work:renderWork, shelf:renderShelf, help:renderHelp}[S.view.name]||renderWorks)(); }
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
    <div class="sizer"><span class="muted" style="font-size:.85rem">Text size</span><button class="btn sm" id="sz-dn" aria-label="Smaller text">A−</button><button class="btn sm" id="sz-up" aria-label="Larger text">A+</button></div>
    <div class="chapters" id="chapters" aria-live="polite"><p class="muted" style="text-align:center">Loading…</p></div>
    <div class="preface" id="endnotes"></div>
    <ul class="work-nav">${multi&&!S.view.whole?`<li><button class="btn sm" data-chstep="-1">← Previous Chapter</button></li>`:''}<li><button class="btn sm" id="wn-top">↑ Top</button></li>${multi&&!S.view.whole?`<li><button class="btn sm" data-chstep="1">Next Chapter →</button></li>`:''}</ul>
    <section class="feedback" id="feedback">
      ${ao3Id(w.sourceUrl)?`<p class="kudos-line">Want to see it as it was on AO3? Try the ${extLink(waybackUrl(ao3Id(w.sourceUrl)),'Wayback Machine copy')} or browse ${extLink(waybackAll(ao3Id(w.sourceUrl)),'all saved copies')}. Not every fic was saved, and adult-rated works sometimes only show AO3’s warning page.</p>`:''}
      ${w.sourceUrl?`<p class="kudos-line">Loved it? When AO3 is back, leave kudos and a comment for <span translate="no">${esc(w.creator)}</span> on <a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">the original work</a>.</p>`:''}
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
  loadChapters(w); mountGiscus(w);
}
function scrollToChapters(){ const c=$('#chapters'); if (c) window.scrollTo({top:c.getBoundingClientRect().top+scrollY-70}); }
function chapterHTML(w,i,d){
  const c=w.chapters[i], multi=w.chapters.length>1, t=c.title;
  return `<section class="chapter" id="ch-${i}">
    ${multi||t?`<h3 class="chap-title">${multi?`Chapter ${i+1}`:''}${multi&&t?': ':''}${esc(t||'')}</h3>`:''}
    ${d&&d.notes?`<div class="cnotes"><h4>Notes:</h4>${md(d.notes)}</div>`:''}
    <div class="userstuff">${d?md(d.body):'<p class="muted">Loading chapter…</p>'}</div>
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
    <div class="rules"><strong>Keep saved fics safe while AO3 is down</strong><ul>
      <li>Upload copies you downloaded from AO3 as <strong>HTML</strong> or <strong>EPUB</strong>, without changing them.</li>
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
      <p class="formnote">Files that can’t be read (PDF, MOBI, AZW3, or a broken file) are skipped. Use the EPUB or HTML version instead.</p></section>
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
