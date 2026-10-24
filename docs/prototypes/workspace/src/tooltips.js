function brokerName(code){const row=data.brokerDirectory?.brokers?.[code];return row?row.name+(row.historicalOnly?' · historical code; licence revoked '+row.licenseRevokedOn:''):'Broker name not sourced'}
const brokerTag=code=>`<span class="broker-code" tabindex="0" data-tip="${esc(brokerName(code))}">${esc(code)}</span>`;
const normalizeCompany=name=>name.toUpperCase().replace(/[^A-Z0-9]/g,' ').split(/\s+/).filter(token=>token&&!['PT','TBK'].includes(token)).join(' ');
function accountBroker(name){
 const code=data.brokerDirectory?.aliases?.[normalizeCompany(name)];
 return code?`<span class="account-broker">${brokerTag(code)}<span>${esc(name)}</span></span>`:esc(name);
}
let tooltipTarget=null,tooltipTimer=null,tooltipWarmUntil=0;
function hideTooltip(){
 clearTimeout(tooltipTimer);tooltipTimer=null;
 const tip=document.getElementById('ui-tooltip');if(!tip)return;
 if(!tip.hidden)tooltipWarmUntil=performance.now()+600;
 if(tooltipTarget?.getAttribute('aria-describedby')==='ui-tooltip')tooltipTarget.removeAttribute('aria-describedby');
 tooltipTarget=null;tip.hidden=true;delete tip.dataset.open;
}
function openTooltip(target,instant){
 if(!target.isConnected)return;
 const tip=document.getElementById('ui-tooltip');tooltipTarget=target;
 tip.textContent=target.dataset.tip;tip.dataset.instant=String(instant);tip.hidden=false;
 target.setAttribute('aria-describedby','ui-tooltip');
 const box=target.getBoundingClientRect(),size=tip.getBoundingClientRect(),above=box.top>size.height+12;
 const left=Math.max(8,Math.min(innerWidth-size.width-8,box.left+box.width/2-size.width/2));
 tip.style.left=left+'px';tip.style.top=(above?box.top-size.height-8:box.bottom+8)+'px';
 tip.style.transformOrigin=above?'center bottom':'center top';
 if(instant)tip.dataset.open='';else requestAnimationFrame(()=>{if(tooltipTarget===target)tip.dataset.open=''});
}
function bindTooltips(){
 document.addEventListener('pointerover',event=>{
  if(event.pointerType==='touch'||!matchMedia('(hover: hover) and (pointer: fine)').matches)return;
  const target=event.target.closest('[data-tip]');if(!target||target===tooltipTarget||target.contains(event.relatedTarget))return;
  const instant=performance.now()<tooltipWarmUntil||!document.getElementById('ui-tooltip').hidden;
  hideTooltip();tooltipTarget=target;
  if(instant)openTooltip(target,true);else tooltipTimer=setTimeout(()=>{if(tooltipTarget===target)openTooltip(target,false)},450);
 });
 document.addEventListener('pointerout',event=>{const target=event.target.closest('[data-tip]');if(target&&!target.contains(event.relatedTarget)&&target===tooltipTarget)hideTooltip()});
 document.addEventListener('focusin',event=>{const target=event.target.closest('[data-tip]');if(target){hideTooltip();openTooltip(target,true)}});
 document.addEventListener('focusout',event=>{if(event.target.closest('[data-tip]')===tooltipTarget)hideTooltip()});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTooltip()});
 document.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')hideTooltip()});
 document.addEventListener('scroll',hideTooltip,true);window.addEventListener('resize',hideTooltip);
}
