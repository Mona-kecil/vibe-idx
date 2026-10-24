const iconPaths={
 sidebar:'<path d="M4 4h16v16H4zM9 4v16M14 9l-3 3 3 3"/>',
 broker:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',
 market:'<path d="M4 19h16M6 15V9m6 6V4m6 11V7"/>',
 ownership:'<path d="M12 3v9h9A9 9 0 1 1 12 3zM16 3.8a9 9 0 0 1 4.2 4.2H16z"/>',
 profile:'<path d="M5 21V3h11v18M3 21h18M9 7h3m-3 4h3m-3 4h3m5-8h3v14"/>',
 price:'<path d="M4 4v16h16M7 15l4-5 4 2 5-7"/>',
 report:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7"/>',
 news:'<path d="M5 4h15v16H5zM2 8v12h3M8 8h8m-8 4h3v4H8zm6 0h3m-3 4h3"/>',
 radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7M12 3v9"/>',
 sources:'<path d="M12 3 3 7l9 4 9-4zM3 12l9 4 9-4M3 17l9 4 9-4"/>',
 link:'<path d="m10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 1 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>',
 unlink:'<path d="m3 3 18 18M8 15l-1 1a3 3 0 0 1-4-4l2-2m8-1 1-1a3 3 0 0 1 4 4l-1 1M8 3v2m11 12h2M3 8h2m12 11v2"/>',
 grip:'<circle cx="9" cy="5" r=".8"/><circle cx="15" cy="5" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="19" r=".8"/><circle cx="15" cy="19" r=".8"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 plus:'<path d="M12 5v14M5 12h14"/>'
};
const icon=name=>`<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name]}</svg>`;
const modules={
 brokers:{name:'Broksum',description:'Broker inventory and daily activity',icon:'broker',ticker:true,dates:true},
 market:{name:'Market summary',description:'IHSG and stock summary',icon:'market',ticker:false},
 ownership:{name:'Ownership',description:'5% accounts and 1% composition',icon:'ownership',ticker:true},
 profile:{name:'Company profile',description:'Company details and shareholders',icon:'profile',ticker:true},
 price:{name:'Price & volume',description:'Closing prices and traded shares',icon:'price',ticker:true,dates:true},
 report:{name:'5% report',description:'Ownership accounts and reported changes',icon:'report',ticker:false},
 radar:{name:'Market radar',description:'Production market signals',icon:'radar',ticker:false},
 news:{name:'News',description:'Captured news results',icon:'news',ticker:true},
 sources:{name:'Sources',description:'Coverage and trading-day handoff',icon:'sources',ticker:true}
};
const freshState=ticker=>({ticker,layout:'page',from:'2026-07-29',through:'2026-10-22',cursor:null,compare:false,reportMode:'all',reportTicker:'all',stockQuery:'',stockSort:'ticker',stockDirection:1,ownershipView:'five',marketFilter:'all',brokerUnit:'shares',brokerCodes:['XL','PD','CC'],brokerSearch:'',brokerFlow:'net',brokerDay:null,brokerPickerOpen:false,chartDays:{}});
const makePanel=(id,type,ticker)=>({id,type,span:6,height:530,state:freshState(ticker)});
const workspace={linked:true,collapsed:false,activeId:'p1',focusId:null,nextId:5,panels:[makePanel('p1','brokers','SINI'),makePanel('p2','market','SINI'),makePanel('p3','ownership','SINI'),makePanel('p4','profile','SINI')]};
const panelById=id=>workspace.panels.find(p=>p.id===id);
let dragPanelId=null;
let resizeOperation=null;
function setTicker(panelId,ticker){
 if(!symbols.includes(ticker))return;
 const origin=panelById(panelId);if(!origin)return;
 workspace.activeId=panelId;
 for(const panel of workspace.linked?workspace.panels:[origin]){
  if(panel.state.ticker!==ticker){panel.state.cursor=null;panel.state.brokerDay=null;panel.state.chartDays={}}
  panel.state.ticker=ticker;
  const prices=data.details[ticker].prices;
  panel.state.from=panel.state.from<prices[0].date?prices[0].date:panel.state.from;
  panel.state.through=panel.state.through>prices.at(-1).date?prices.at(-1).date:panel.state.through;
 }
}
function toggleLink(){
 const ticker=(panelById(workspace.activeId)||workspace.panels[0])?.state.ticker||'SINI';
 workspace.linked=!workspace.linked;
 if(workspace.linked&&workspace.panels.length)setTicker((panelById(workspace.activeId)||workspace.panels[0]).id,ticker);
 announce(workspace.linked?'Tickers linked to '+ticker+'. Dates and controls stay independent.':'Tickers unlinked. Each panel keeps its current ticker.');
}
function addPanel(type){
 if(!modules[type])return;
 const ticker=(panelById(workspace.activeId)||workspace.panels[0])?.state.ticker||'SINI';
 const panel=makePanel('p'+workspace.nextId++,type,ticker);
 workspace.panels.push(panel);workspace.activeId=panel.id;workspace.focusId=null;
 render();document.querySelector('[data-panel-id="'+panel.id+'"]').scrollIntoView({block:'nearest',behavior:'smooth'});
 announce(modules[type].name+' added.');
}
function removePanel(id){
 const index=workspace.panels.findIndex(p=>p.id===id);if(index<0)return;
 workspace.panels.splice(index,1);
 if(workspace.activeId===id)workspace.activeId=workspace.panels[Math.min(index,workspace.panels.length-1)]?.id||null;
 if(workspace.focusId===id)workspace.focusId=null;
}
function movePanel(id,beforeId){
 if(id===beforeId)return;
 const index=workspace.panels.findIndex(p=>p.id===id);if(index<0)return;
 const [panel]=workspace.panels.splice(index,1);
 const target=workspace.panels.findIndex(p=>p.id===beforeId);
 workspace.panels.splice(target<0?workspace.panels.length:target,0,panel);
 workspace.activeId=id;
}
function announce(text){document.getElementById('workspace-status').textContent=text}
function panelHeader(panel,index){
 const m=modules[panel.type];
 return `<header class="panel-head"><button class="icon-button panel-grip" draggable="true" data-drag-panel="${panel.id}" aria-label="Drag ${m.name} panel to move it" title="Drag to reorder. More actions also offers Move earlier/later.">${icon('grip')}</button>${icon(m.icon)}<h2>${m.name}</h2>${m.ticker?`<select class="panel-ticker" data-field="panelTicker" aria-label="${m.name} ticker">${symbols.map(t=>`<option ${panel.state.ticker===t?'selected':''}>${t}</option>`).join('')}</select>`:''}<div class="panel-tools"><button class="icon-button" data-workspace-action="focus" data-id="${panel.id}" aria-label="${workspace.focusId===panel.id?'Show all panels':'Focus '+m.name+' panel'}" title="${workspace.focusId===panel.id?'Show all panels':'Focus panel'}">${icon('focus')}</button><details class="panel-menu"><summary class="icon-button" aria-label="${m.name} panel actions" title="Panel actions">${icon('more')}</summary><div class="panel-menu-list"><button data-workspace-action="move-earlier" data-id="${panel.id}" ${index===0?'disabled':''}>Move earlier</button><button data-workspace-action="move-later" data-id="${panel.id}" ${index===workspace.panels.length-1?'disabled':''}>Move later</button><hr><button data-workspace-action="span" data-id="${panel.id}" data-span="4">One-third width</button><button data-workspace-action="span" data-id="${panel.id}" data-span="6">Half width</button><button data-workspace-action="span" data-id="${panel.id}" data-span="12">Full width</button><hr><button data-workspace-action="height" data-id="${panel.id}" data-height="360">Compact height</button><button data-workspace-action="height" data-id="${panel.id}" data-height="680">Tall height</button></div></details><button class="icon-button" data-workspace-action="remove" data-id="${panel.id}" aria-label="Remove ${m.name} panel" title="Remove panel">${icon('close')}</button></div></header>`;
}
function render(){
 const scrolls=new Map([...document.querySelectorAll('.module-panel')].map(el=>[el.dataset.panelId,el.querySelector('.panel-body').scrollTop]));
 const deskWidth=document.getElementById('app').clientWidth||innerWidth;
 const padding=deskWidth<=1000?14:20,rail=workspace.collapsed?64:deskWidth<=1000?190:216;
 const width=deskWidth<=620?deskWidth-24:deskWidth-padding*2-rail-(deskWidth<=1000?14:20);
 const visible=workspace.focusId?workspace.panels.filter(p=>p.id===workspace.focusId):workspace.panels;
 const panels=visible.map(panel=>{
  const panelWidth=innerWidth<=1000||workspace.focusId?width:width*panel.span/12-14;
  const view=createView(panel,Math.max(280,panelWidth-50));
  return `<article class="module-panel ${workspace.activeId===panel.id?'active':''}" data-panel-id="${panel.id}" aria-label="${modules[panel.type].name} panel" style="grid-column:span ${panel.span};height:${panel.height}px">${panelHeader(panel,workspace.panels.indexOf(panel))}<div class="panel-body">${view.html()}</div><button class="panel-resize" data-resize-panel="${panel.id}" aria-label="Resize ${modules[panel.type].name} panel. Arrow keys change width and height." title="Drag to resize. Arrow keys also resize."></button></article>`;
 }).join('');
 document.getElementById('app').innerHTML=`<main class="desk ${workspace.collapsed?'collapsed':''}"><aside class="desk-sidebar" aria-label="Module picker"><div class="rail-top"><span class="rail-brand">Vibe IDX</span><button class="icon-button" data-workspace-action="sidebar" aria-label="${workspace.collapsed?'Expand':'Collapse'} module sidebar" aria-expanded="${!workspace.collapsed}" title="${workspace.collapsed?'Expand':'Collapse'} sidebar">${icon('sidebar')}</button></div><p class="rail-label">Add a module</p><nav class="module-picker">${Object.entries(modules).map(([type,m])=>`<button class="module-add" data-workspace-action="add" data-type="${type}" aria-label="Add ${m.name} module" title="Add ${m.name}: ${m.description}">${icon(m.icon)}<span class="module-name">${m.name}</span>${workspace.panels.some(p=>p.type===type)?`<span class="module-count">${workspace.panels.filter(p=>p.type===type).length}</span>`:''}</button>`).join('')}</nav><div class="rail-foot"><strong>Your research desk.</strong><br>Add modules as you need them.<br>Each panel can be moved or resized.</div></aside><section class="desk-main"><header class="desk-header"><div><p class="eyebrow">Vibe IDX · Research</p><h1>Your workspace.</h1><p>Keep the sources you need beside each other.</p></div><div class="workspace-tools"><span class="workspace-version">V2.2 · Prototype</span><button class="link-toggle" data-workspace-action="link" aria-pressed="${workspace.linked}" title="${workspace.linked?'Turn off to choose a ticker per panel.':'Turn on to sync tickers using the active panel.'}">${icon(workspace.linked?'link':'unlink')}<span>${workspace.linked?'Tickers linked':'Independent tickers'}</span></button></div></header><div class="desk-status"><span><strong>${workspace.panels.length}</strong> modules</span><span>Prices <strong>${data.health.prices}</strong></span><span>5% <strong>${data.health.five_pct}</strong></span><span class="hint-text">${workspace.linked?'Changing a ticker updates all panels.':'Each panel keeps its own ticker.'} Dates stay independent.</span></div><div class="panel-grid ${workspace.focusId?'focused':''}">${panels||`<div class="workspace-empty">${icon('plus')}<h2>Build your research desk.</h2><p>Add a module from the sidebar, then arrange the workspace around what you want to investigate.</p><button class="small-button" data-workspace-action="add" data-type="brokers">Add Broksum</button></div>`}</div><footer class="desk-footer"><span>Captured sources · SINI, BRPT, TPIA, BREN · no live feed</span><a href="https://vibe-idx.vercel.app/" target="_blank" rel="noopener noreferrer">Current production ↗</a></footer></section></main>`;
 positionBrokerPickers();
 for(const [id,top] of scrolls){const el=document.querySelector('[data-panel-id="'+id+'"] .panel-body');if(el)el.scrollTop=top}
}
function setActive(id){
 if(!panelById(id))return;
 workspace.activeId=id;
 document.querySelectorAll('.module-panel').forEach(el=>el.classList.toggle('active',el.dataset.panelId===id));
}
function onClick(event){
 closeBrokerPickers(event);
 const button=event.target.closest('[data-workspace-action]');
 if(button){
  const action=button.dataset.workspaceAction,id=button.dataset.id,panel=panelById(id);
  if(action==='add'){addPanel(button.dataset.type);return}
  if(action==='sidebar')workspace.collapsed=!workspace.collapsed;
  if(action==='link')toggleLink();
  if(action==='remove')removePanel(id);
  if(action==='focus'){workspace.activeId=id;workspace.focusId=workspace.focusId===id?null:id}
  if(action==='span')panel.span=Number(button.dataset.span);
  if(action==='height')panel.height=Number(button.dataset.height);
  if(action==='move-earlier'){const i=workspace.panels.indexOf(panel);if(i>0)movePanel(id,workspace.panels[i-1].id)}
  if(action==='move-later'){const i=workspace.panels.indexOf(panel);if(i<workspace.panels.length-1)movePanel(id,workspace.panels[i+2]?.id)}
  render();return;
 }
 const action=event.target.closest('[data-action]');if(!action)return;
 if(action.dataset.action==='close-source'){document.getElementById('source-dialog').close();return}
 const panel=panelById(action.closest('[data-panel-id]')?.dataset.panelId);if(!panel)return;
 setActive(panel.id);
 if(action.dataset.action==='broker-picker'){
  const open=!panel.state.brokerPickerOpen;
  workspace.panels.forEach(p=>p.state.brokerPickerOpen=false);panel.state.brokerPickerOpen=open;render();
  if(open)document.querySelector('[data-panel-id="'+panel.id+'"] [data-field="brokerSearch"]').focus();
  return;
 }
 if(action.dataset.action==='ticker'){setTicker(panel.id,action.dataset.ticker);render();return}
 if(action.dataset.action==='page'){addPanel({stocks:'market',report:'report',radar:'radar'}[action.dataset.page]);return}
 if(action.dataset.action==='tab'){addPanel({brokers:'brokers',ownership:'ownership',company:'profile',technical:'price'}[action.dataset.tab]);return}
 createView(panel,400).action(event);
}
function onChange(event){
 if(['brokerSearch','stockQuery'].includes(event.target.dataset.field))return;
 const target=event.target,panel=panelById(target.closest('[data-panel-id]')?.dataset.panelId);if(!panel)return;
 setActive(panel.id);
 if(target.dataset.field==='brokerChoice'){
  const scroll=target.closest('.broker-options')?.scrollTop||0,code=target.value;
  panel.state.brokerCodes=target.checked?[...new Set([...panel.state.brokerCodes,code])]:panel.state.brokerCodes.filter(item=>item!==code);
  render();const list=document.querySelector('[data-panel-id="'+panel.id+'"] .broker-options');if(list)list.scrollTop=scroll;
  document.querySelector('[data-panel-id="'+panel.id+'"] [data-field="brokerChoice"][value="'+code+'"]').focus();return;
 }
 if(['from','through'].includes(target.dataset.field)){panel.state.brokerDay=null;panel.state.chartDays={}}
 if(target.dataset.field==='panelTicker'){setTicker(panel.id,target.value);render();return}
 createView(panel,400).change(event);
}
function onInput(event){
 const field=event.target.dataset.field;
 if(!['stockQuery','brokerSearch'].includes(field))return;
 const panel=panelById(event.target.closest('[data-panel-id]')?.dataset.panelId);if(!panel)return;
 const position=event.target.selectionStart;panel.state[field]=event.target.value;setActive(panel.id);render();
 const target=document.querySelector('[data-panel-id="'+panel.id+'"] [data-field="'+field+'"]');
 target.focus();target.setSelectionRange(position,position);
}
function onKeydown(event){
 const handle=event.target.closest('[data-resize-panel]');
 if(handle&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
  event.preventDefault();const panel=panelById(handle.dataset.resizePanel);
  if(event.key==='ArrowLeft')panel.span=Math.max(4,panel.span-1);
  if(event.key==='ArrowRight')panel.span=Math.min(12,panel.span+1);
  if(event.key==='ArrowUp')panel.height=Math.max(280,panel.height-40);
  if(event.key==='ArrowDown')panel.height=Math.min(1100,panel.height+40);
  render();document.querySelector('[data-resize-panel="'+panel.id+'"]').focus();return;
 }
 if(document.getElementById('source-dialog').open||['INPUT','SELECT','TEXTAREA','BUTTON','SUMMARY'].includes(document.activeElement.tagName)||event.metaKey||event.ctrlKey||event.altKey)return;
 if(['1','2','3','4'].includes(event.key)&&workspace.activeId){setTicker(workspace.activeId,symbols[Number(event.key)-1]);render()}
}
function beginResize(event){
 const handle=event.target.closest('[data-resize-panel]');if(!handle)return;
 event.preventDefault();if(event.isTrusted)handle.setPointerCapture(event.pointerId);
 const panel=panelById(handle.dataset.resizePanel),el=handle.closest('.module-panel');
 setActive(panel.id);
 resizeOperation={id:panel.id,x:event.clientX,y:event.clientY,span:panel.span,height:panel.height,gridWidth:document.querySelector('.panel-grid').clientWidth,el};
 document.body.classList.add('is-resizing');
}
function duringResize(event){
 if(!resizeOperation)return;
 const r=resizeOperation,panel=panelById(r.id);
 panel.height=Math.max(280,Math.min(1100,Math.round(r.height+event.clientY-r.y)));
 if(innerWidth>1000&&!workspace.focusId)panel.span=Math.max(4,Math.min(12,Math.round(r.span+(event.clientX-r.x)/(r.gridWidth/12))));
 r.el.style.height=panel.height+'px';r.el.style.gridColumn='span '+panel.span;
}
function endResize(){
 if(!resizeOperation)return;
 const id=resizeOperation.id;resizeOperation=null;document.body.classList.remove('is-resizing');render();
 announce('Panel resized.');document.querySelector('[data-resize-panel="'+id+'"]').focus();
}
function bind(){
 document.addEventListener('click',onClick);document.addEventListener('change',onChange);document.addEventListener('input',onInput);document.addEventListener('keydown',onKeydown);
 document.addEventListener('focusin',event=>{const el=event.target.closest('[data-panel-id]');if(el)setActive(el.dataset.panelId)});
 document.addEventListener('pointerdown',event=>{const el=event.target.closest('[data-panel-id]');if(el)setActive(el.dataset.panelId);beginResize(event)});
 document.addEventListener('pointermove',duringResize);document.addEventListener('pointerup',endResize);document.addEventListener('pointercancel',endResize);
 document.addEventListener('dragstart',event=>{const handle=event.target.closest('[data-drag-panel]');if(!handle)return;dragPanelId=handle.dataset.dragPanel;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragPanelId);handle.closest('.module-panel').classList.add('dragging')});
 document.addEventListener('dragover',event=>{if(!dragPanelId)return;const el=event.target.closest('[data-panel-id]');if(!el||el.dataset.panelId===dragPanelId)return;event.preventDefault();event.dataTransfer.dropEffect='move';document.querySelectorAll('.drop-target').forEach(n=>n.classList.remove('drop-target'));el.classList.add('drop-target')});
 document.addEventListener('drop',event=>{if(!dragPanelId)return;event.preventDefault();const el=event.target.closest('[data-panel-id]');if(el){movePanel(dragPanelId,el.dataset.panelId);render();announce('Panel moved.')}dragPanelId=null});
 document.addEventListener('dragend',()=>{dragPanelId=null;document.querySelectorAll('.dragging,.drop-target').forEach(el=>el.classList.remove('dragging','drop-target'))});
}
async function start(){
 const bytes=Uint8Array.from(atob('__BROKERS_GZIP__'),c=>c.charCodeAt(0));
 data.brokers=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 bind();render();document.dispatchEvent(new Event('prototype-ready'));
}
start();
