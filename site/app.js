(() => {
 'use strict';
 const {chapters,episodes}=window.COMIC_DATA;
 const $=id=>document.getElementById(id), byId=new Map(episodes.map((e,i)=>[e.id,{...e,index:i}]));
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon=n=>`<svg aria-hidden="true"><use href="#i-${n}"/></svg>`;
 const norm=s=>String(s).toLowerCase().replace(/[\s.·/\-–—]/g,'');
 const KEY='civil-law-comics:v1';
 let raw={};try{raw=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{}
 const validIds=a=>new Set(Array.isArray(a)?a.filter(x=>byId.has(x)):[]);
 const qualityLabels={low:'저용량',standard:'표준',high:'고화질'};
 let quality=Object.hasOwn(qualityLabels,raw.quality)?raw.quality:'standard',prefetch=null;
 const sourceFor=e=>e.sources?.[quality]||{src:e.image,width:1024};
 const saved=validIds(raw.saved),read=validIds(raw.read);
 const positions=raw.positions&&typeof raw.positions==='object'?raw.positions:{};
 let last=byId.has(raw.last)?raw.last:null,activeLecture=0,onlySaved=false,current=null,tocLecture=6,libraryScroll=0,zoomed=false,toastTimer,scrollTimer,navToken=0,ignoreGesture=false,gesture=null;
 let imageReady=false,restoring=false,imageRetryTimer=null;
 const retryDelay=attempt=>attempt===1?350:1000;
 const retryUrl=(src,attempt)=>`${src}${src.includes('?')?'&':'?'}retry=${Date.now()}-${attempt}`;
 function cancelImageRetry(){clearTimeout(imageRetryTimer);imageRetryTimer=null;}
 // Covers, cards and resume thumbnails also need to survive transient CDN errors.
 const thumbnailRetries=new WeakMap();
 document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement)thumbnailRetries.delete(event.target);},true);
 function retryThumbnail(im){
  if(!(im instanceof HTMLImageElement)||im.id==='comicImage')return;
  const failed=im.getAttribute('src');if(!failed)return;
  let state=thumbnailRetries.get(im);
  if(!state||state.request!==failed){state={source:failed,request:failed,attempts:0};thumbnailRetries.set(im,state);}
  if(state.attempts>=2)return;
  const attempt=++state.attempts;
  setTimeout(()=>{
   if(!im.isConnected||thumbnailRetries.get(im)!==state||im.getAttribute('src')!==failed)return;
   state.request=retryUrl(state.source,attempt);im.src=state.request;
  },retryDelay(attempt));
 }
 document.addEventListener('error',event=>retryThumbnail(event.target),true);
 // A cover may fail before this script finishes loading.
 for(const im of document.images)if(im.complete&&!im.naturalWidth)retryThumbnail(im);
 function persist(){try{localStorage.setItem(KEY,JSON.stringify({saved:[...saved],read:[...read],positions,last,quality}));}catch{}}
 function toast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2300);}
 function chip(l,selected,count){return `<button type="button" class="chapter-tab${selected?' active':''}" data-lecture="${l}" aria-pressed="${selected}">${l?`제${l}강`:'전체'}<span>${count}</span></button>`;}
 function updateTabs(){
  $('chapterTabs').innerHTML=chip(0,activeLecture===0,episodes.length)+chapters.map(c=>chip(c.number,activeLecture===c.number,c.count)).join('');
  $('savedCount').textContent=saved.size;$('readStats').textContent=`${read.size} / ${episodes.length}편 읽음`;
  $('allTab').classList.toggle('active',!onlySaved);$('savedTab').classList.toggle('active',onlySaved);
 }
 function matches(e,q){if(!q)return true;return q.split(/\s+/).every(t=>norm([e.title,e.unit,e.cases,e.summary,`제${e.lecture}강 ${String(e.number).padStart(3,'0')}편`].join(' ')).includes(norm(t)));}
 function renderLibrary(){
  updateTabs();const q=$('searchInput').value.trim(),unread=$('unreadOnly').checked;
  const list=episodes.filter(e=>(!activeLecture||e.lecture===activeLecture)&&(!onlySaved||saved.has(e.id))&&(!unread||!read.has(e.id))&&matches(e,q));
  const chapter=chapters.find(c=>c.number===activeLecture);
  $('collectionTitle').textContent=onlySaved?'다시 읽고 싶은 판례':chapter?chapter.title:'강의별로 둘러보기';
  $('resultLabel').innerHTML=`${onlySaved?'책갈피':activeLecture?`제${activeLecture}강`:'전체 강의'} <strong>${list.length}편</strong>${q?' · 검색 결과':''}`;
  $('emptyState').hidden=!!list.length;
  $('episodeGrid').innerHTML=list.map(e=>`<article class="episode-card"><a class="card-link" href="#read/${e.id}" aria-label="제${e.lecture}강 ${e.number}편 ${esc(e.title)} 읽기"><div class="card-image"><img src="${e.thumbnail}" alt="${esc(e.title)} 만화 미리보기" width="400" height="440" loading="lazy" decoding="async"><div class="card-shade"></div>${read.has(e.id)?`<span class="card-status">${icon('check')} 읽은 편</span>`:last===e.id?'<span class="card-status">읽던 편</span>':''}</div><p class="card-number">제${e.lecture}강 <span>·</span> ${String(e.number).padStart(3,'0')}편</p><h3>${esc(e.title)}</h3><p class="card-unit">${esc(e.unit)}</p></a><button class="card-bookmark${saved.has(e.id)?' saved':''}" type="button" data-save="${e.id}" aria-label="${esc(e.title)} 책갈피 ${saved.has(e.id)?'해제':'추가'}" aria-pressed="${saved.has(e.id)}">${icon('heart')}</button></article>`).join('');
  $('resumeSection').hidden=!last;
  if(last){const e=byId.get(last);$('resumeThumb').src=e.thumbnail;$('resumeMeta').textContent=`제${e.lecture}강 · ${String(e.number).padStart(3,'0')}편`;$('resumeTitle').textContent=e.title;$('resumeProgress').textContent=read.has(e.id)?'마지막으로 읽은 만화':'마지막 읽던 위치에서 계속';}
 }
 function toggleSaved(id){saved.has(id)?saved.delete(id):saved.add(id);persist();if(current)updateReaderState();else renderLibrary();toast(saved.has(id)?'책갈피에 담았습니다':'책갈피를 해제했습니다');}
 function updateReaderState(){if(!current)return;const e=current,isRead=read.has(e.id);$('bookmark').setAttribute('aria-pressed',String(saved.has(e.id)));$('bookmark').setAttribute('aria-label',saved.has(e.id)?'책갈피 해제':'책갈피 추가');$('markRead').setAttribute('aria-pressed',String(isRead));$('markRead').querySelector('span').textContent=isRead?'읽은 편':'읽음으로 표시';}
 function savePosition(){if(!current||restoring||!imageReady)return;const stage=$('comicStage'),top=stage.offsetTop;positions[current.id]=Math.max(0,Math.min(1,(window.scrollY-top)/Math.max(stage.offsetHeight,1)));persist();}
 function openEpisode(id,{resume=false,retry=false}={}){
  const e=byId.get(id);if(!e)return;
  if(!current)libraryScroll=window.scrollY;else savePosition();
  const token=++navToken;current=e;last=e.id;imageReady=false;restoring=true;
  $('library').hidden=true;$('reader').hidden=false;document.body.classList.add('is-reading');
  zoomed=false;$('comicStage').classList.remove('zoomed');$('zoom').querySelector('span').textContent='확대';
  $('readerMeta').textContent=`민법 제${e.lecture}강 · ${String(e.number).padStart(3,'0')}편`;
  $('readerTitle').textContent=e.title;$('readerUnit').textContent=e.unit;
  $('readerCases').textContent=`판례 · ${e.cases}`;$('readerPages').textContent=e.pages?`강의안 ${e.pages}쪽`:'';
  document.title=`${e.title} · 제${e.lecture}강 ${e.number}편 | 민법 판례 만화 서재`;
  $('positionNumber').textContent=String(e.number).padStart(3,'0');$('positionTotal').textContent=`제${e.lecture}강 / ${chapters.find(c=>c.number===e.lecture).count}편`;
  const prev=episodes[e.index-1],next=episodes[e.index+1];
  $('previous').disabled=!prev;$('next').disabled=!next;
  $('previousMeta').textContent=prev?(prev.lecture!==e.lecture?`제${prev.lecture}강으로`:'이전 편'):'서재의 첫 편';
  $('nextMeta').textContent=next?(next.lecture!==e.lecture?`제${next.lecture}강으로`:'다음 편'):'서재의 마지막 편';
  $('previousLabel').textContent=prev?`${String(prev.number).padStart(3,'0')} · ${prev.title}`:'';
  $('nextLabel').textContent=next?`${String(next.number).padStart(3,'0')} · ${next.title}`:'';
  loadComic(e,{token,resume,retry});window.scrollTo({top:0,behavior:'instant'});updateReaderState();persist();
  if($('tocDialog').open)$('tocDialog').close();
 }
 function loadComic(e,{token,resume=false,retry=false,scrollTop=null}={}){
  cancelImageRetry();let attempts=0;
  const source=sourceFor(e),im=$('comicImage');
  imageReady=false;restoring=true;
  $('qualitySelect').value=quality;
  $('qualitySize').textContent=`${source.width}px${source.bytes?` · ${Math.round(source.bytes/1024)} KB`:''}`;
  $('imageLoading').textContent=`${qualityLabels[quality]} 만화를 불러오는 중…`;
  $('imageLoading').hidden=false;$('imageError').hidden=true;im.style.visibility='hidden';
  im.alt=`민법 제${e.lecture}강 ${e.number}편: ${e.title}. 판례 ${e.cases}. 여섯 컷 만화.`;
  im.onload=()=>{
   if(token!==navToken)return;
   cancelImageRetry();imageReady=true;$('imageLoading').hidden=true;$('imageError').hidden=true;im.style.visibility='visible';
   requestAnimationFrame(()=>{
    if(token!==navToken)return;
    const p=resume?Number(positions[e.id]):0;
    const top=scrollTop!==null?scrollTop:Number.isFinite(p)&&p>0?$('comicStage').offsetTop+$('comicStage').offsetHeight*p:0;
    window.scrollTo({top,behavior:'instant'});restoring=false;updateProgress();
   });
   if(prefetch){prefetch.src='';prefetch=null;}
   const next=episodes[e.index+1];
   if(next&&quality!=='high'&&!navigator.connection?.saveData){prefetch=new Image();prefetch.src=sourceFor(next).src;}
  };
  im.onerror=()=>{
   if(token!==navToken)return;
   if(attempts<2){
    const attempt=++attempts;
    $('imageLoading').textContent=`${qualityLabels[quality]} 이미지 연결을 다시 시도하는 중… (${attempt}/2)`;
    imageRetryTimer=setTimeout(()=>{
     imageRetryTimer=null;
     if(token!==navToken||current?.id!==e.id)return;
     im.src=retryUrl(source.src,attempt);
    },retryDelay(attempt));
    return;
   }
   $('imageLoading').hidden=true;$('imageError').hidden=false;restoring=false;
  };
  im.src=retry?`${source.src}?retry=${Date.now()}`:source.src;
 }
 $('qualitySelect').value=quality;
 $('qualitySelect').addEventListener('change',()=>{
  const selected=$('qualitySelect').value;if(!Object.hasOwn(qualityLabels,selected)||quality===selected)return;
  savePosition();quality=selected;persist();
  if(prefetch){prefetch.src='';prefetch=null;}
  if(current)loadComic(current,{token:++navToken,scrollTop:window.scrollY});
 });
 function navigate(delta){if(!current)return;const e=episodes[current.index+delta];if(e){savePosition();location.hash=`read/${e.id}`;}else toast(delta>0?'마지막 편입니다':'첫 번째 편입니다');}
 function showLibrary(){savePosition();cancelImageRetry();current=null;navToken++;$('reader').hidden=true;$('library').hidden=false;document.body.classList.remove('is-reading');document.title='민법 판례 만화 서재';renderLibrary();requestAnimationFrame(()=>window.scrollTo({top:libraryScroll,behavior:'instant'}));}
 let resumeRequested=false;
 function route(){const m=location.hash.match(/^#read\/(L\d{2}_\d{3})$/);if(m&&byId.has(m[1])){openEpisode(m[1],{resume:resumeRequested});resumeRequested=false;}else showLibrary();}
 function updateProgress(){if(!current||!imageReady)return;const rect=$('comicStage').getBoundingClientRect(),available=window.innerHeight-155;const p=Math.max(0,Math.min(1,(available-rect.top)/rect.height));$('readingProgressBar').style.width=`${p*100}%`;if(p>=.98&&!read.has(current.id)){read.add(current.id);updateReaderState();persist();}}
 function renderToc(){const q=$('tocSearch').value.trim();$('tocChapters').innerHTML=chapters.map(c=>chip(c.number,c.number===tocLecture,c.count)).join('');const list=episodes.filter(e=>e.lecture===tocLecture&&matches(e,q));$('tocList').innerHTML=list.map(e=>`<button type="button" class="toc-entry${current?.id===e.id?' current':''}" data-episode="${e.id}" ${current?.id===e.id?'aria-current="page"':''}><span class="toc-num">${String(e.number).padStart(3,'0')}</span><span><b>${esc(e.title)}</b><small>${esc(e.cases)}</small></span>${read.has(e.id)?icon('check'):icon('right')}</button>`).join('')||'<p class="muted">이 강의에서 검색 결과가 없습니다.</p>';}
 function openToc(){tocLecture=current?.lecture||activeLecture||6;$('tocSearch').value='';renderToc();$('tocDialog').showModal();setTimeout(()=>$('tocList').querySelector('.current')?.scrollIntoView({block:'center'}),30);}
 $('chapterTabs').addEventListener('click',e=>{const b=e.target.closest('[data-lecture]');if(b){activeLecture=+b.dataset.lecture;renderLibrary();}});
 $('episodeGrid').addEventListener('click',e=>{const b=e.target.closest('[data-save]');if(b)toggleSaved(b.dataset.save);});
 $('searchInput').addEventListener('input',renderLibrary);$('unreadOnly').addEventListener('change',renderLibrary);
 $('allTab').onclick=()=>{onlySaved=false;renderLibrary();};$('savedTab').onclick=()=>{onlySaved=true;renderLibrary();$('collectionTitle').scrollIntoView({block:'start',behavior:'smooth'});};
 $('resetFilters').onclick=()=>{activeLecture=0;onlySaved=false;$('searchInput').value='';$('unreadOnly').checked=false;renderLibrary();};
 $('resume').onclick=()=>{resumeRequested=true;if(location.hash===`#read/${last}`)route();else location.hash=`read/${last}`;};
 $('backLibrary').onclick=()=>{location.hash='';};$('previous').onclick=()=>navigate(-1);$('next').onclick=()=>navigate(1);
 $('bookmark').onclick=()=>current&&toggleSaved(current.id);$('openToc').onclick=openToc;$('position').onclick=openToc;$('closeToc').onclick=()=>$('tocDialog').close();
 $('tocDialog').addEventListener('click',e=>{if(e.target===$('tocDialog')){const r=$('tocDialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('tocDialog').close();}});
 $('tocChapters').onclick=e=>{const b=e.target.closest('[data-lecture]');if(b){tocLecture=+b.dataset.lecture;renderToc();$('tocList').scrollTop=0;}};
 $('tocSearch').oninput=renderToc;
 $('tocList').onclick=e=>{const b=e.target.closest('[data-episode]');if(b){const id=b.dataset.episode;$('tocDialog').close();if(current?.id!==id)location.hash=`read/${id}`;}};
 $('markRead').onclick=()=>{if(!current)return;read.has(current.id)?read.delete(current.id):read.add(current.id);updateReaderState();persist();};
 $('zoom').onclick=()=>{zoomed=!zoomed;$('comicStage').classList.toggle('zoomed',zoomed);$('zoom').querySelector('span').textContent=zoomed?'화면 맞춤':'확대';if(zoomed)toast('이미지를 좌우로 움직여 읽으세요');};
 $('retryImage').onclick=()=>current&&loadComic(current,{token:++navToken,retry:true,scrollTop:window.scrollY});
 const stage=$('comicStage');
 stage.addEventListener('touchstart',e=>{ignoreGesture=e.touches.length!==1||zoomed||(window.visualViewport?.scale||1)>1.05;gesture=ignoreGesture?null:{x:e.touches[0].clientX,y:e.touches[0].clientY,time:Date.now()};},{passive:true});
 stage.addEventListener('touchmove',e=>{if(e.touches.length!==1){ignoreGesture=true;gesture=null;}},{passive:true});
 stage.addEventListener('touchend',e=>{if(!gesture||ignoreGesture||!current||e.touches.length)return;const t=e.changedTouches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y,dt=Date.now()-gesture.time;gesture=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.8&&dt<1000)navigate(dx<0?1:-1);},{passive:true});
 stage.addEventListener('touchcancel',()=>{gesture=null;ignoreGesture=true;},{passive:true});
 document.addEventListener('keydown',e=>{if(!current||$('tocDialog').open||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key==='ArrowRight'&&!zoomed){e.preventDefault();navigate(1);}else if(e.key==='ArrowLeft'&&!zoomed){e.preventDefault();navigate(-1);}else if(e.key==='Escape'){if(zoomed)$('zoom').click();else location.hash='';}});
 window.addEventListener('scroll',()=>{if(!current)return;updateProgress();clearTimeout(scrollTimer);scrollTimer=setTimeout(savePosition,180);},{passive:true});
 window.addEventListener('pagehide',savePosition);document.addEventListener('visibilitychange',()=>{if(document.hidden)savePosition();});window.addEventListener('hashchange',route);
 window.addEventListener('resize',updateProgress);route();
})();
