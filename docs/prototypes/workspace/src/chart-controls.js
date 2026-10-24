function positionBrokerPickers(){
 for(const popup of document.querySelectorAll('.broker-popover')){
  const trigger=popup.parentElement.querySelector('.broker-select-trigger'),box=trigger.getBoundingClientRect(),width=Math.min(370,innerWidth-24),height=Math.min(360,Math.max(210,innerHeight-32));
  popup.style.width=width+'px';popup.style.maxHeight=height+'px';popup.style.left=Math.max(12,Math.min(innerWidth-width-12,box.left))+'px';
  const below=innerHeight-box.bottom-12;
  popup.style.top=(below>=Math.min(300,height)?box.bottom+6:Math.max(12,box.top-Math.min(height,popup.scrollHeight)-6))+'px';
 }
}
function closeBrokerPickers(event){
 if(event.target.closest('.broker-select'))return;
 for(const panel of workspace.panels)panel.state.brokerPickerOpen=false;
 document.querySelectorAll('.broker-popover').forEach(el=>el.remove());
 document.querySelectorAll('.broker-select-trigger').forEach(el=>el.setAttribute('aria-expanded','false'));
}
function bindChartControls(){
 document.addEventListener('pointermove',event=>{
  const hit=event.target.closest('[data-plot-date]');if(!hit)return;
  const panel=panelById(hit.closest('[data-panel-id]').dataset.panelId);if(!panel)return;
  if(panel.state.chartDays[hit.dataset.plotKind]===hit.dataset.plotDate&&hit.closest('svg').querySelector('[data-crosshair]').style.display!=='none')return;
  setActive(panel.id);createView(panel,400).hoverChart(hit.dataset.plotKind,hit.dataset.plotDate);
 });
 document.addEventListener('pointerout',event=>{
  const svg=event.target.closest('[data-time-chart]');if(!svg||svg.contains(event.relatedTarget))return;
  svg.querySelector('[data-crosshair]').style.display='none';svg.querySelector('[data-active-points]').innerHTML='';
 });
 document.addEventListener('focusin',event=>{
  const svg=event.target.closest('[data-time-chart]');if(!svg||event.target!==svg)return;
  const panel=panelById(svg.closest('[data-panel-id]').dataset.panelId),dates=svg.dataset.dates.split(',');
  createView(panel,400).hoverChart(svg.dataset.timeChart,panel.state.chartDays[svg.dataset.timeChart]||dates.at(-1),true);
 });
 document.addEventListener('focusout',event=>{const svg=event.target.closest('[data-time-chart]');if(svg&&!svg.contains(event.relatedTarget)){hideTooltip();svg.removeAttribute('aria-describedby')}});
 document.addEventListener('keydown',event=>{
  const svg=event.target.closest('[data-time-chart]');
  if(svg&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
   event.preventDefault();const panel=panelById(svg.closest('[data-panel-id]').dataset.panelId),dates=svg.dataset.dates.split(','),current=panel.state.chartDays[svg.dataset.timeChart]||dates.at(-1),index=dates.indexOf(current),next=event.key==='Home'?0:event.key==='End'?dates.length-1:Math.max(0,Math.min(dates.length-1,index+(event.key==='ArrowLeft'?-1:1)));
   createView(panel,400).hoverChart(svg.dataset.timeChart,dates[next],true);
  }
  if(event.key==='Escape'){
   const panel=workspace.panels.find(p=>p.state.brokerPickerOpen);
   if(panel){panel.state.brokerPickerOpen=false;render();document.querySelector('[data-panel-id="'+panel.id+'"] .broker-select-trigger').focus()}
  }
 });
 document.addEventListener('scroll',positionBrokerPickers,true);window.addEventListener('resize',positionBrokerPickers);
}
