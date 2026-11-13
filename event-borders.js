(() => {
  'use strict';
  if (window.__GCW_EVENT_BORDERS__) return;
  window.__GCW_EVENT_BORDERS__ = true;

  // Google Calendar의 일정 HTML은 공개 API가 아니므로 의미 있는 데이터 속성만 사용합니다.
  const CHIP_SELECTOR = '[data-eventchip], [data-eid], [data-eventid], [data-event-id]';
  const ID_SELECTOR = '[data-eid], [data-eventid], [data-event-id]';
  const STORAGE_KEY = 'gcwEventBorders';
  const SHAPE_STORAGE = 'gcwEventShapes';
  const DOT_STORAGE = 'gcwEventDots';
  const EFFECTS = [
    { id: 'none', label: '기본 (테두리 해제)', desc: '구글 캘린더 원래 디자인' },
    { id: 'solid', label: '선명한 실선', desc: '노란색 강조 테두리' },
    { id: 'dashed', label: '시원한 점선', desc: '하늘색 점선 테두리' },
    { id: 'double', label: '이중 테두리', desc: '겹쳐진 보라색 선' },
    { id: 'neon', label: '네온 글로우', desc: '에메랄드 빛 번짐' },
    { id: 'pulse', label: '맥동', desc: '천천히 밝아지는 하이라이트' },
    { id: 'rainbow', label: '무지개 애니메이션', desc: '변화하는 여러 색상' },
    { id: 'gold', label: '골드 강조', desc: '반짝이는 금빛 테두리' }
  ];
  const VALID = new Set(EFFECTS.filter(x => x.id !== 'none').map(x => x.id));
  const SHAPES = [
    { id:'none', label:'원래 모양', desc:'구글 기본 디자인' },
    { id:'pill', label:'캡슐', desc:'완전히 둥근 끝' },
    { id:'round', label:'둥근 사각형', desc:'부드러운 모서리' },
    { id:'square', label:'각진 사각형', desc:'직각에 가까운 모서리' },
    { id:'diagonal', label:'대각 라운드', desc:'양쪽 모서리 비대칭' },
    { id:'left', label:'왼쪽 라운드', desc:'시작 부분만 강조' },
    { id:'right', label:'오른쪽 라운드', desc:'끝 부분만 강조' }
  ];
  const VALID_SHAPES = new Set(SHAPES.filter(x => x.id !== 'none').map(x=>x.id));
  const DOT_SHAPES = [
    {id:'inherit', label:'전체 기본 설정 사용', desc:'확장프로그램 설정에 지정한 모양'},
    {id:'circle', label:'● 원형', desc:'구글 기본 점'},
    {id:'square', label:'■ 사각형', desc:'모서리가 각진 점'},
    {id:'diamond', label:'◆ 마름모', desc:'비스듬한 다이아'},
    {id:'triangle', label:'▲ 삼각형', desc:'방향감 있는 표시'},
    {id:'star', label:'★ 별', desc:'중요 일정 표시'},
    {id:'heart', label:'♥ 하트', desc:'마음에 드는 일정'},
    {id:'ring', label:'◯ 고리', desc:'가운데 빈 원'},
    {id:'sparkle', label:'✦ 반짝이', desc:'네 방향 반짝이'}
  ];
  const VALID_DOTS = new Set(DOT_SHAPES.filter(x=>x.id!=='inherit').map(x=>x.id));
  let enabled = true;
  let shapesEnabled = true;
  let shapes = Object.create(null);
  let saved = Object.create(null);
  let dots = Object.create(null);
  let dotsEnabled = true;
  let defaultDot = 'circle';
  let menu = null;
  let scanTimer = 0;
  let currentKey = '';
  let currentChip = null;

  function safeSettings(raw) {
    const out = Object.create(null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw).slice(-500)) {
      if (key.startsWith('evt:') && key.length < 100 && (VALID.has(value) || VALID_SHAPES.has(value) || VALID_DOTS.has(value))) out[key] = value;
    }
    return out;
  }

  // 길거나 민감한 일정 제목이 storage의 키 이름에 남지 않게 식별자만 해시합니다.
  // 두 개의 독립 시드를 사용해 동일 제목 충돌 가능성을 줄입니다.
  function hashKey(input) {
    const str = String(input);
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) {
      const v = str.charCodeAt(i);
      a = Math.imul(a ^ v, 0x01000193);
      b = Math.imul(b ^ v, 0x85ebca6b);
    }
    return `evt:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
  }

  function findChip(from) {
    if (!(from instanceof Element)) return null;
    // 입력창·대화상자 안에서 우클릭한 경우 기본 컨텍스트 메뉴를 유지합니다.
    if (from.closest('.gcw-border-menu, [role="dialog"]')) return null;
    const hit = from.closest(CHIP_SELECTOR);
    if (!hit || !document.querySelector('[role="main"]')?.contains(hit)) return null;
    // data-eid가 자식에 붙어 있으면 실제 이벤트 카드인 data-eventchip까지 올라갑니다.
    const outerChip = hit.closest('[data-eventchip]');
    return outerChip || hit;
  }

  function keyForChip(chip) {
    if (!chip) return null;
    const nodes = [chip, ...chip.querySelectorAll(ID_SELECTOR)];
    for (const node of nodes) {
      for (const attr of ['data-eid', 'data-eventid', 'data-event-id']) {
        const value = node.getAttribute(attr);
        if (value && value.trim().length >= 3) return hashKey('id:' + attr + ':' + value.trim());
      }
    }
    const chipValue = chip.getAttribute('data-eventchip');
    if (chipValue && chipValue.length >= 5 && chipValue !== 'true') {
      return hashKey('chip:' + chipValue);
    }
    const link = chip.querySelector('a[href*="eventedit/"], a[href*="eid="]');
    if (link) {
      const href = link.getAttribute('href');
      if (href) return hashKey('url:' + href);
    }
    // 이벤트 ID가 표시되지 않는 UI 버전의 제한적 폴백.
    // 이벤트 이름/시간/날짜의 조합이 같은 다른 일정에는 같은 효과가 보일 수 있습니다.
    const name = (chip.getAttribute('aria-label') ||
      chip.querySelector('[aria-label]')?.getAttribute('aria-label') ||
      chip.getAttribute('title') || chip.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 350);
    if (!name) return null;
    const dayNode = chip.closest('[data-datekey], [data-date-key]');
    const day = dayNode?.getAttribute('data-datekey') || dayNode?.getAttribute('data-date-key') || '';
    const time = chip.getAttribute('data-start') || chip.getAttribute('data-time') || '';
    return hashKey('visual:' + day + ':' + time + ':' + name);
  }

  function allChips() {
    const found = new Set();
    const main = document.querySelector('[role="main"]');
    if (!main) return found;
    main.querySelectorAll(CHIP_SELECTOR).forEach(el => {
      const chip = el.closest('[data-eventchip]') || el;
      if (!chip.closest('[role="dialog"]')) found.add(chip);
    });
    return found;
  }

  function paintedSurface(chip) {
    // v1.2.4는 이벤트 래퍼에 테두리가 그려져 실제 파란 버튼과 어긋났습니다.
    // 카드 전체에 해당하는 실제 색상 배경 요소를 선택합니다.
    const outer=chip.getBoundingClientRect();
    if(outer.width<12 || outer.height<9) return chip;
    let best=chip, bestScore=-1e9;
    const nodes=[chip,...Array.from(chip.querySelectorAll('button,[role="button"],div,[data-eid],[data-eventid]')).slice(0,70)];
    for (const node of nodes) {
      if(!(node instanceof HTMLElement)) continue;
      const box=node.getBoundingClientRect();
      if(box.width<Math.min(25,outer.width*.5) || box.height<Math.min(10,outer.height*.5)) continue;
      if(box.width>outer.width+5 || box.height>outer.height+5) continue;
      const css=getComputedStyle(node);
      const rgb=css.backgroundColor;
      const colored= rgb && rgb!=='transparent' && !/^rgba?\(\s*0[,\s]+0[,\s]+0(?:[,\s/]+0(?:\.0+)?)?\s*\)$/.test(rgb) && !/rgba\([^)]*,\s*0\s*\)/.test(rgb);
      const fit=(box.width/outer.width + box.height/outer.height);
      const score=(colored?8:0)+fit*3+(parseFloat(css.borderRadius)>1?0.8:0)+(node===chip?0:1);
      if(score>bestScore){ bestScore=score; best=node; }
    }
    return best;
  }
  // v1.2.8: 구글 캘린더의 점은 배경색뿐 아니라 0x0 요소의 굵은 색 테두리로도 그려집니다.
  // 기존 버전은 border-color 방식의 점을 제외하여 실제 화면에서 모양 변경이 누락됐습니다.
  function opaqueColor(color) {
    if (!color || color==='transparent' || color==='none' || color==='currentcolor') return false;
    if (/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color)) return false;
    if (/^rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0(?:\s*[,/]\s*0)?\s*\)$/.test(color)) return false;
    return true;
  }
  function markerAppearance(el, pseudo='') {
    const style=getComputedStyle(el,pseudo||null);
    const borderWidth=Math.max(...['Top','Left','Right','Bottom'].map(x=>parseFloat(style['border'+x+'Width'])||0));
    const borderColor=style.borderTopColor;
    const hasBorder=(borderWidth>=2 && opaqueColor(borderColor)) || (pseudo==='' && el.classList.contains('gcw-event-dot-border'));
    const bg=style.backgroundColor;
    let color=(pseudo==='' && el.style?.getPropertyValue('--gcw-dot-color')) ||
      (hasBorder?borderColor:(opaqueColor(bg)?bg:null));
    if(!color && el instanceof SVGElement){
      const fill=style.fill,stroke=style.stroke;
      color=opaqueColor(fill)?fill:(opaqueColor(stroke)?stroke:null);
    }
    // 이미 바꾼 요소는 CSS에서 테두리를 제거했으므로 최초의 원색을 기억합니다.
    if(!color && el.style?.getPropertyValue('--gcw-dot-color')) color=el.style.getPropertyValue('--gcw-dot-color');
    return {color,hasBorder,borderWidth,style};
  }
  function findDot(chip) {
    if (!(chip instanceof HTMLElement)) return null;
    const r=chip.getBoundingClientRect();
    if(r.width<34||r.height<8||r.height>82)return null;
    let candidates=[];
    // 부모 chip 자체가 12px 점의 의사요소(::before)를 보유하는 구현도 처리합니다.
    const nodes=[chip,...Array.from(chip.querySelectorAll('span,div,i,b,svg,circle,button')).slice(0,90)];
    for(const el of nodes){
      if(!(el instanceof Element)||el.closest('.gcw-border-menu'))continue;
      const box=el.getBoundingClientRect();
      if(el!==chip && box.width>=5 && box.height>=5 && box.width<=27 && box.height<=27 &&
         box.left>=r.left-3 && box.left<=r.left+72 && box.top>=r.top-6 && box.top<=r.bottom+6){
        const a=markerAppearance(el);
        if(a.color){
          const ratio=box.width/box.height;
          const round=parseFloat(a.style.borderRadius)||0;
          const score=(a.hasBorder?18:8)+(ratio>.7&&ratio<1.4?5:0)+
            (round>=Math.min(box.width,box.height)*.3?2:0)-Math.max(0,box.left-r.left)*.09-
            Math.abs((box.top+box.height/2)-(r.top+r.height/2))*.15;
          candidates.push({node:el,type:'native',color:a.color,borderOnly:a.hasBorder,score});
        }
      }
      // display:contents 자식 등은 rect가 0이어도 ::before로 점을 만드는 경우가 있습니다.
      if(el instanceof SVGElement)continue;
      const before=getComputedStyle(el,'::before');
      const w=parseFloat(before.width)||0,h=parseFloat(before.height)||0;
      const pseudoContent=before.content;
      if(w>=5&&w<=24&&h>=5&&h<=24&&pseudoContent&&pseudoContent!=='none'&&pseudoContent!=='normal'){
        const a=markerAppearance(el,'::before');
        if(a.color && box.left>=r.left-4 && box.left<r.left+76 && box.top<r.bottom+5){
          candidates.push({node:el,type:'pseudo',color:a.color,borderOnly:a.hasBorder,score:11-Math.max(0,box.left-r.left)*.06});
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    if(candidates.length)return candidates[0];
    return null;
  }

  function paint() {
    scanTimer=0;
    const wantedSurfaces=new Map(), wantedDots=new Map();
    for(const chip of allChips()){
      const key=keyForChip(chip);
      if(!key)continue;
      const effect=enabled?saved[key]:null;
      const shape=shapesEnabled?shapes[key]:null;
      if(effect||shape){
        const surface=paintedSurface(chip);
        const record=wantedSurfaces.get(surface)||{};
        if(effect) record.effect=effect;
        if(shape) record.shape=shape;
        wantedSurfaces.set(surface,record);
      }
      const dotShape=dotsEnabled?(dots[key]||defaultDot):'circle';
      if(dotShape!=='circle'){
        const marker=findDot(chip);
        if(marker)wantedDots.set(marker.node,{shape:dotShape,type:marker.type,color:marker.color,borderOnly:marker.borderOnly});
      }
    }
    // 변경된 일정만 수정합니다. 예전처럼 매 스캔 시 클래스를 떼면 애니메이션이 초기화됩니다.
    document.querySelectorAll('.gcw-event-surface').forEach(node=>{
      if(wantedSurfaces.has(node))return;
      node.classList.remove('gcw-event-surface');
      node.removeAttribute('data-gcw-event-effect');
      node.removeAttribute('data-gcw-event-shape');
      if(node.dataset.gcwInjectedPosition==='1'){
        node.style.removeProperty('position');node.removeAttribute('data-gcw-injected-position');
      }
    });
    for(const [node,record] of wantedSurfaces){
      if(!node.classList.contains('gcw-event-surface'))node.classList.add('gcw-event-surface');
      const effect=record.effect||null,shape=record.shape||null;
      if(node.getAttribute('data-gcw-event-effect')!==effect){
        if(effect)node.setAttribute('data-gcw-event-effect',effect);
        else node.removeAttribute('data-gcw-event-effect');
      }
      if(node.getAttribute('data-gcw-event-shape')!==shape){
        if(shape)node.setAttribute('data-gcw-event-shape',shape);
        else node.removeAttribute('data-gcw-event-shape');
      }
      // 애니메이션 레이어(::after)가 이벤트 본체에 정렬되도록, static 요소만 변경합니다.
      if(effect && ['neon','pulse','rainbow','gold'].includes(effect)&&getComputedStyle(node).position==='static'){
        node.style.position='relative';node.dataset.gcwInjectedPosition='1';
      }
    }
    document.querySelectorAll('[data-gcw-marker-shape]').forEach(node=>{
      if(wantedDots.has(node))return;
      node.removeAttribute('data-gcw-marker-shape');
      node.classList.remove('gcw-event-dot-pseudo','gcw-event-dot-native','gcw-event-dot-border');
      node.style.removeProperty('--gcw-dot-color');
      node.style.removeProperty('--gcw-dot-size');
    });
    for(const [node,{shape,type,color,borderOnly}] of wantedDots){
      if(color && node.style.getPropertyValue('--gcw-dot-color')!==color) node.style.setProperty('--gcw-dot-color',color);
      if(node.style.getPropertyValue('--gcw-dot-size')!=='12px') node.style.setProperty('--gcw-dot-size','12px');
      if(node.getAttribute('data-gcw-marker-shape')!==shape)node.setAttribute('data-gcw-marker-shape',shape);
      node.classList.toggle('gcw-event-dot-pseudo',type==='pseudo');
      node.classList.toggle('gcw-event-dot-native',type==='native');
      node.classList.toggle('gcw-event-dot-border',type==='native'&&borderOnly);
    }
  }

  function schedulePaint() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(paint, 120);
  }

  function closeMenu() {
    if (menu) menu.remove();
    menu = null;
    currentKey = '';
    currentChip = null;
  }

  function makeMenu(chip, key, x, y) {
    closeMenu();
    currentKey=key;currentChip=chip;
    menu=document.createElement('div');
    menu.className='gcw-border-menu gcw-border-menu-gridmode';
    menu.setAttribute('role','dialog');
    menu.setAttribute('aria-label','일정 디자인 설정');
    menu.tabIndex=-1;
    const dark=document.documentElement.classList.contains('gcw-theme-dark')||
      (!document.documentElement.classList.contains('gcw-theme-light')&&(()=>{
        const n=getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.slice(0,3).map(Number);
        return n&&n.length===3&&(n[0]*.2126+n[1]*.7152+n[2]*.0722)<130;
      })());
    menu.dataset.gcwMenuDark=dark?'1':'0';
    const title=document.createElement('div');title.className='gcw-menu-topline';
    const heading=document.createElement('strong');heading.textContent='일정 디자인';
    const close=document.createElement('button');close.type='button';close.className='gcw-menu-close';
    close.textContent='×';close.setAttribute('aria-label','메뉴 닫기');close.addEventListener('click',closeMenu);
    title.append(heading,close);menu.append(title);
    const grid=document.createElement('div');grid.className='gcw-menu-grid';menu.append(grid);
    function section(name,desc){
      const col=document.createElement('section');col.className='gcw-menu-section';
      const hd=document.createElement('div');hd.className='gcw-menu-section-heading';hd.textContent=name;
      const sub=document.createElement('div');sub.className='gcw-menu-section-desc';sub.textContent=desc;
      col.append(hd,sub);grid.append(col);return col;
    }
    function addChoice(parent,item,kind,selected){
      const button=document.createElement('button');button.type='button';button.className='gcw-border-menu-option';
      button.setAttribute('aria-pressed',String(selected));
      button.setAttribute('title',item.desc);
      button.dataset.gcwSelect=item.id;button.dataset.gcwKind=kind;
      const swatch=document.createElement('span');swatch.className='gcw-border-menu-swatch';
      swatch.dataset.gcwSample=kind==='border'?item.id:'none';
      if(kind==='shape'||kind==='marker')swatch.dataset.gcwShapeSample=item.id;
      if(kind==='marker')swatch.classList.add('gcw-dot-swatch');
      const label=document.createElement('span');label.className='gcw-border-menu-option-label';label.textContent=item.label;
      const check=document.createElement('span');check.className='gcw-border-menu-check';check.textContent=selected?'✓':'';
      button.append(swatch,label,check);parent.append(button);
    }
    if(enabled){
      const col=section('테두리 효과','8가지');
      for(const effect of EFFECTS)addChoice(col,effect,'border',saved[key]===effect.id||(effect.id==='none'&&!saved[key]));
    }
    if(shapesEnabled){
      const col=section('일정 카드 모양','7가지');
      for(const shape of SHAPES)addChoice(col,shape,'shape',shapes[key]===shape.id||(shape.id==='none'&&!shapes[key]));
    }
    if(dotsEnabled){
      const col=section('시간 일정 앞 표시','9가지 · 점 색상 유지');
      for(const shape of DOT_SHAPES)addChoice(col,shape,'marker',dots[key]===shape.id||(shape.id==='inherit'&&!dots[key]));
    }
    const footer=document.createElement('div');footer.className='gcw-menu-footer';
    footer.textContent='선택하면 바로 적용 · Shift + 우클릭: 브라우저 기본 메뉴';menu.append(footer);
    menu.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();});
    menu.addEventListener('pointerdown',e=>e.stopPropagation());
    menu.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
    menu.addEventListener('click',async e=>{
      const button=e.target instanceof Element?e.target.closest('[data-gcw-select]'):null;
      if(!button||!currentKey)return;
      e.preventDefault();e.stopPropagation();
      const id=button.dataset.gcwSelect,kind=button.dataset.gcwKind;
      const map=kind==='shape'?shapes:kind==='marker'?dots:saved;
      const valid=kind==='shape'?VALID_SHAPES:kind==='marker'?VALID_DOTS:VALID;
      const storage=kind==='shape'?SHAPE_STORAGE:kind==='marker'?DOT_STORAGE:STORAGE_KEY;
      if(id==='none'||id==='inherit')delete map[currentKey];
      else if(valid.has(id))map[currentKey]=id;
      else return;
      if(kind==='shape')shapes=safeSettings(Object.fromEntries(Object.entries(shapes).slice(-400)));
      else if(kind==='marker')dots=safeSettings(Object.fromEntries(Object.entries(dots).slice(-400)));
      else saved=safeSettings(Object.fromEntries(Object.entries(saved).slice(-400)));
      const data=Object.assign({},kind==='shape'?shapes:kind==='marker'?dots:saved);
      closeMenu();paint();
      try{await chrome.storage.local.set({[storage]:data});}
      catch(error){console.warn('[GC 일정 꾸미기] 설정 저장 실패:',error);}
    });
    document.body.append(menu);
    const bounds=menu.getBoundingClientRect();
    menu.style.left=`${Math.max(6,Math.min(x,window.innerWidth-bounds.width-8))}px`;
    menu.style.top=`${Math.max(6,Math.min(y,window.innerHeight-bounds.height-8))}px`;
    // 선택된 항목에 포커스하면 메뉴가 스크롤될 수 있어, 메뉴 컨테이너에만 포커스합니다.
    menu.focus({preventScroll:true});
  }

  async function init() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY, SHAPE_STORAGE, DOT_STORAGE, 'eventBordersEnabled', 'eventShapesEnabled', 'eventDotsEnabled', 'eventDotDefault']);
      saved = safeSettings(data[STORAGE_KEY]);
      shapes = safeSettings(data[SHAPE_STORAGE]);
      dots = safeSettings(data[DOT_STORAGE]);
      dotsEnabled=data.eventDotsEnabled!==false;
      document.documentElement.classList.toggle('gcw-event-dots-on',dotsEnabled);
      defaultDot=VALID_DOTS.has(data.eventDotDefault)?data.eventDotDefault:'circle';
      enabled = data.eventBordersEnabled !== false;
      shapesEnabled = data.eventShapesEnabled !== false;
    } catch (error) { console.warn('[GC 일정 테두리] 설정 로드 실패:', error); }
    paint();
    document.addEventListener('contextmenu', e => {
      if ((!enabled && !shapesEnabled && !dotsEnabled) || e.shiftKey) { closeMenu(); return; }
      const chip = findChip(e.target);
      if (!chip) { closeMenu(); return; }
      const key = keyForChip(chip);
      if (!key) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      makeMenu(chip, key, e.clientX, e.clientY);
    }, true);
    document.addEventListener('pointerdown', e => {
      if (menu && !(e.target instanceof Element && e.target.closest('.gcw-border-menu'))) closeMenu();
    }, true);
    document.addEventListener('keydown', e => {
      if (!menu) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        const buttons = [...menu.querySelectorAll('button')];
        const i = buttons.indexOf(document.activeElement);
        const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
        if (next) { e.preventDefault(); next.focus(); }
      }
    }, true);
    // 메뉴 스크롤/페이지 스크롤에서는 닫지 않습니다. ESC 또는 외부 클릭으로만 닫습니다.
    window.addEventListener('resize', closeMenu, { passive: true });
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.type === 'attributes' || Array.from(m.addedNodes).some(node =>
        node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('gcw-border-menu')))) schedulePaint();
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-eid', 'data-eventid', 'data-event-id', 'data-eventchip']
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if(changes[DOT_STORAGE]){dots=safeSettings(changes[DOT_STORAGE].newValue);schedulePaint();}
      if(changes.eventDotsEnabled){dotsEnabled=changes.eventDotsEnabled.newValue!==false;document.documentElement.classList.toggle('gcw-event-dots-on',dotsEnabled);schedulePaint();}
      if(changes.eventDotDefault){defaultDot=VALID_DOTS.has(changes.eventDotDefault.newValue)?changes.eventDotDefault.newValue:'circle';schedulePaint();}
      if (changes[SHAPE_STORAGE]) {
        shapes=safeSettings(changes[SHAPE_STORAGE].newValue); schedulePaint();
      }
      if (changes.eventShapesEnabled) {
        shapesEnabled=changes.eventShapesEnabled.newValue!==false;
        if(!shapesEnabled && !enabled && !dotsEnabled) closeMenu();
        schedulePaint();
      }
      if (changes[STORAGE_KEY]) {
        saved = safeSettings(changes[STORAGE_KEY].newValue);
        schedulePaint();
      }
      if (changes.eventBordersEnabled) {
        enabled = changes.eventBordersEnabled.newValue !== false;
        if (!enabled && !shapesEnabled && !dotsEnabled) closeMenu();
        schedulePaint();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
