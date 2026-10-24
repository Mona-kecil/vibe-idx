function rangeToolbar(){
 return `<div class="range-toolbar"><div class="date-fields"><label>From <input aria-label="Range start" data-field="from" type="date" value="${state.from}" min="${detail().prices[0].date}" max="${state.through}"></label><label>Through <input aria-label="Range end" data-field="through" type="date" value="${state.through}" min="${state.from}" max="${detail().prices.at(-1).date}"></label></div></div>`;
}
function brokerContext(){
 const pack=data.brokers[state.ticker];if(!pack)return null;
 const byDate=new Map(pack.days.map(([day,rows])=>[day,rows])),expected=selectedRows().map(row=>row.date),missingDays=expected.filter(day=>!byDate.has(day));
 const codes=[...new Set(expected.flatMap(day=>(byDate.get(day)||[]).map(row=>row[0])))].sort();
 const totals=new Map(codes.map(code=>[code,{code,buy:0,sell:0,buyValue:0,sellValue:0}]));
 for(const day of expected)for(const [code,buy,sell,buyValue,sellValue] of byDate.get(day)||[]){const row=totals.get(code);row.buy+=buy;row.sell+=sell;row.buyValue+=buyValue;row.sellValue+=sellValue}
 const day=expected.includes(state.brokerDay)?state.brokerDay:expected.at(-1);
 return {pack,byDate,expected,missingDays,codes,totals,day};
}
function brokerPicker(context){
 const query=state.brokerSearch.toUpperCase(),codes=context.codes.filter(code=>(code+' '+brokerName(code)).toUpperCase().includes(query));
 return `<div class="broker-select"><button class="broker-select-trigger" data-action="broker-picker" aria-expanded="${state.brokerPickerOpen}" aria-controls="broker-options-${panel.id}"><span>${state.brokerCodes.length?state.brokerCodes.slice(0,3).join(', ')+(state.brokerCodes.length>3?' +'+(state.brokerCodes.length-3):''):'Select brokers'}</span><span aria-hidden="true">⌄</span></button>${state.brokerPickerOpen?`<div class="broker-popover" id="broker-options-${panel.id}" role="group" aria-label="Select brokers"><input class="broker-search" data-field="brokerSearch" aria-label="Search broker codes and names" placeholder="Code or broker name" value="${esc(state.brokerSearch)}"><div class="broker-options">${codes.map(code=>`<label class="broker-option"><input type="checkbox" data-field="brokerChoice" value="${code}" data-code="${code}" ${state.brokerCodes.includes(code)?'checked':''}><span class="broker-code" data-tip="${esc(brokerName(code))}">${code}</span><span>${esc(brokerName(code))}</span></label>`).join('')||'<p class="monthly-empty">No matching broker.</p>'}</div><div class="broker-option-footer"><button class="text-link" data-action="broker-clear">Clear</button></div></div>`:''}</div>`;
}
function brokerRows(day,context){return (context.byDate.get(day)||[]).map(([code,buy,sell,buyValue,sellValue])=>({code,buy,sell,buyValue,sellValue}))}
function sideTables(rows){
 const value=state.brokerUnit==='value',net=state.brokerFlow!=='gross',buyKey=value?'buyValue':'buy',sellKey=value?'sellValue':'sell';
 const side=(direction)=>{
  const positive=direction==='buy',key=positive?buyKey:sellKey;
  const amount=row=>net?(positive?row[buyKey]-row[sellKey]:row[sellKey]-row[buyKey]):row[key];
  const sorted=rows.filter(row=>amount(row)>0).sort((a,b)=>amount(b)-amount(a)||a.code.localeCompare(b.code));
  return `<section class="broker-side ${direction}"><h4>${net?'Net ':''}${positive?'Buy':'Sell'}</h4><div class="side-table"><table><thead><tr><th>Broker</th><th class="numeric">${value?'Value · IDR':'Shares'}</th></tr></thead><tbody>${sorted.map(row=>{const chosen=state.brokerCodes.includes(row.code);return `<tr><td><button class="broker-check" data-action="broker-toggle" data-code="${row.code}" data-tip="${esc(brokerName(row.code))}" aria-pressed="${chosen}">${chosen?'☑':'☐'} ${row.code}</button></td><td class="numeric" data-amount="${amount(row)}">${value?compact(amount(row)):f(amount(row))}</td></tr>`}).join('')||'<tr><td colspan="2" class="empty">No activity.</td></tr>'}</tbody></table></div></section>`;
 };
 return `<div class="broker-sides">${side('buy')}${side('sell')}</div>`;
}
function dailyActivity(context,day){return `<div class="registry-chart-head"><h3>Daily activity</h3><span class="meta">${date(day)}</span></div>${sideTables(brokerRows(day,context))}`}
function brokerCard(){
 const context=brokerContext();if(!context)return unconnectedBrokerCard(true);
 if(!context.expected.length)return missing('No trading sessions in this range.','Choose dates with captured data.');
 if(context.missingDays.length)return `<section class="card">${missing('Broker history is incomplete for this range.','Captured '+date(context.pack.from)+' to '+date(context.pack.through)+'. Missing sessions are not zero.')}<button class="small-button" data-action="broker-coverage">Use captured period</button></section>`;
 return `<div class="stack"><section class="card"><div class="registry-chart-head"><h3>Net inventory</h3><select data-field="brokerUnit" aria-label="Broker measure"><option value="shares" ${state.brokerUnit==='shares'?'selected':''}>Shares</option><option value="value" ${state.brokerUnit==='value'?'selected':''}>Value · IDR</option></select></div><div class="broker-selection-toolbar">${brokerPicker(context)}</div>${state.brokerCodes.length?timeChart(chartSpec('broker'),'broker',245):'<p class="monthly-empty">Select brokers to plot.</p>'}<p class="hint">Net change from ${date(context.expected[0])}; opening holdings are unknown.</p>${source('Daily gross summaries, all boards and investor types.','brokers')}</section><section class="card"><div class="registry-chart-head"><h3>Range summary</h3><select data-field="brokerFlow" aria-label="Broker flow"><option value="net" ${state.brokerFlow!=='gross'?'selected':''}>Net</option><option value="gross" ${state.brokerFlow==='gross'?'selected':''}>Gross</option></select></div>${sideTables([...context.totals.values()])}</section><section class="card" data-daily-brokers>${dailyActivity(context,context.day)}</section></div>`;
}
function holdingsSpec(){
 const groups=new Map();
 const add=(name,point)=>{const key=normalizeCompany(name);if(!groups.has(key))groups.set(key,{key,label:name,points:new Map()});const prior=groups.get(key).points.get(point.date);if(prior&&prior.value===point.value&&point.delta===null){point.delta=prior.delta;point.deltaBasis=prior.deltaBasis}groups.get(key).points.set(point.date,point)};
 for(const row of data.one.filter(row=>row.ticker===state.ticker))add(row.investorName,{date:row.asOf,value:row.total,delta:null,source:'1% disclosure'});
 for(const row of detail().changes)add(row.investor,{date:row.date,value:row.shares_after,delta:row.net_shares,deltaBasis:'Reported change',source:'5% change report',explicitUnknown:row.shares_after===null});
 for(const group of data.five.groups.filter(group=>group.holding.ticker===state.ticker))add(group.holding.investorName,{date:group.holding.asOf,value:group.holding.combinedShares,delta:null,source:'5% disclosure'});
 const colors=['#3d755a','#47859a','#ab6a53','#89733e','#786397','#697e4d','#91677e','#658896','#a07f50'];
 const series=[...groups.values()].map((group,index)=>{
  const points=[...group.points.values()].sort((a,b)=>a.date.localeCompare(b.date));
  for(let i=1;i<points.length;i++)if(points[i].delta===null&&Number.isFinite(points[i].value)&&Number.isFinite(points[i-1].value)){points[i].delta=points[i].value-points[i-1].value;points[i].deltaBasis='Since prior observation'}
  return {key:group.key,label:group.label,color:colors[index%colors.length],points};
 });
 const dates=[...new Set(series.flatMap(s=>s.points.map(p=>p.date)))].sort();
 return {dates,series,unit:'shares',label:'Reported holdings',dashed:false,minZero:true};
}
function chartSpec(kind){
 if(kind==='ownership')return holdingsSpec();
 if(kind==='broker'){
  const context=brokerContext(),unit=state.brokerUnit==='value'?'IDR':'shares';
  const series=state.brokerCodes.map(code=>{let total=0;return {key:code,label:code,color:brokerColor(code),points:context.expected.map(day=>{const row=(context.byDate.get(day)||[]).find(r=>r[0]===code),delta=row?(unit==='shares'?row[1]-row[2]:row[3]-row[4]):0;total+=delta;return {date:day,value:total,delta,deltaBasis:'Day',source:'Daily gross broker summary'}})}});
  return {dates:context.expected,series,unit,label:'Cumulative net inventory',minZero:true};
 }
 if(kind.startsWith('registry:')){
  const key=kind.split(':')[1],rows=(data.registry[state.ticker]?.snapshots||[]).filter(row=>Number.isFinite(row[key])).slice().sort((a,b)=>a.asOf.localeCompare(b.asOf)),percentage=key==='reportedFreeFloatPct';
  return {dates:rows.map(row=>row.asOf),unit:percentage?'%':'',deltaUnit:percentage?'pp':'',label:percentage?'Reported free float':'SID',minZero:true,fixedMax:percentage?100:null,small:true,series:[{key,label:percentage?'Reported free float':'SID',color:'#2d6650',points:rows.map((row,i)=>({date:row.asOf,value:row[key],delta:i?row[key]-rows[i-1][key]:null,deltaBasis:'Since prior report'}))}]};
 }
 if(kind==='volume'){
  const rows=selectedRows();
  return {dates:rows.map(row=>row.date),unit:'shares',label:'Daily volume',small:false,minZero:true,bars:true,series:[{key:'Volume',label:'Volume',color:'#719983',points:rows.map(row=>{const index=detail().prices.indexOf(row),prior=detail().prices[index-1];return {date:row.date,value:row.volume,delta:prior?row.volume-prior.volume:null,deltaBasis:'Since prior session'}})}]};
 }
 const rows=selectedRows(),initial=rows[0],market=new Map(data.market.history.map(row=>[row.date,row]));
 const pricePoints=rows.map(row=>{const index=detail().prices.indexOf(row),prior=detail().prices[index-1];return {date:row.date,value:state.compare?(row.close/initial.close-1)*100:row.close,delta:prior?(row.close/prior.close-1)*100:null,deltaText:prior?(row.close/prior.close-1)*100:null,close:row.close,volume:row.volume,source:'Daily close'}});
 const series=[{key:state.ticker,label:state.ticker,color:'#123c35',points:pricePoints}];
 if(state.compare&&initial&&market.has(initial.date))series.push({key:'IHSG',label:'IHSG',color:'#8b9a8f',points:rows.filter(row=>market.has(row.date)).map(row=>({date:row.date,value:(market.get(row.date).close/market.get(initial.date).close-1)*100,delta:null}))});
 return {dates:rows.map(row=>row.date),series,unit:state.compare?'%':'IDR',label:'Daily close',price:true};
}
function metricText(value,unit,signed=false){if(!Number.isFinite(value))return 'Not reported';const sign=signed&&value>0?'+':'';return sign+(unit==='IDR'?'Rp ':'')+f(value,['%','pp'].includes(unit)?2:0)+(unit==='shares'?' shares':unit==='%'?'%':unit==='pp'?' pp':'')}
function chartReadout(spec,kind,day){
 const rows=spec.series.map(series=>({series,point:series.points.find(point=>point.date===day)})).filter(row=>row.point);
 if(spec.small)return '';
 return `<div class="chart-readout-date">${date(day)}</div><div class="chart-readout-table"><table><thead><tr><th>${kind==='ownership'?'Investor':kind==='broker'?'Broker':'Series'}</th><th class="numeric">${kind==='broker'?'Net inventory':kind==='ownership'?'Shares':kind==='volume'?'Shares':state.compare?'Return':'Close'}</th><th class="numeric">${kind==='broker'?'Day Δ':kind==='ownership'?'Δ shares':'Day Δ'}</th></tr></thead><tbody>${rows.map(({series,point})=>`<tr><td style="color:${series.color}">${kind==='broker'?brokerTag(series.label):kind==='ownership'&&Number.isFinite(point.value)?shareholderName(series.label,state.ticker,day):esc(series.label)}</td><td class="numeric">${metricText(point.value,spec.unit,kind==='broker')}</td><td class="numeric ${tone(point.delta)}" data-tip="${esc(point.deltaBasis||'Daily price change')}">${point.deltaText!==undefined?metricText(point.deltaText,'%',true):metricText(point.delta,spec.deltaUnit??spec.unit,true)}</td></tr>`).join('')}</tbody></table></div>`;
}
function timeChart(spec,kind,height=235){
 if(!spec.dates.length)return '<p class="monthly-empty">No dated observations.</p>';
 const w=spec.small?230:Math.max(300,Math.min(1100,width)),h=height,left=spec.small?30:52,right=spec.small?15:54,top=20,bottom=29,pw=w-left-right,ph=h-top-bottom;
 const t=day=>new Date(day+'T12:00:00Z').getTime(),first=t(spec.dates[0]),last=t(spec.dates.at(-1)),x=day=>spec.dates.length===1?left+pw/2:left+(t(day)-first)/(last-first)*pw;
 const values=spec.series.flatMap(series=>series.points.map(point=>point.value)).filter(Number.isFinite),lo=spec.minZero?Math.min(0,...values):Math.min(...values),hi=spec.fixedMax??Math.max(...values),padding=(hi-lo||1)*.1,min=spec.fixedMax||spec.minZero&&lo===0?0:lo-padding,max=spec.fixedMax?spec.fixedMax:hi+padding,y=value=>top+(max-value)/(max-min||1)*ph;
 const day=kind==='broker'&&spec.dates.includes(state.brokerDay)?state.brokerDay:spec.dates.at(-1);
 const paths=spec.series.map(series=>{if(spec.bars)return series.points.map(point=>`<rect x="${x(point.date)-Math.max(1,pw/spec.dates.length*.28)}" y="${y(point.value)}" width="${Math.max(1.4,pw/spec.dates.length*.56)}" height="${Math.max(0,y(0)-y(point.value))}" fill="${series.color}"/>`).join('');let segments=[],segment=[];for(const point of series.points){if(Number.isFinite(point.value))segment.push(point);else {if(segment.length)segments.push(segment);segment=[]}}if(segment.length)segments.push(segment);return segments.map(points=>`${points.length>1?`<polyline points="${points.map(point=>x(point.date)+','+y(point.value)).join(' ')}" fill="none" stroke="${series.color}" stroke-width="2" ${spec.dashed?'stroke-dasharray="4 4"':''}/>`:''}${points.map(point=>`<circle cx="${x(point.date)}" cy="${y(point.value)}" r="${kind==='ownership'||spec.small?3:1.4}" fill="${series.color}"/>`).join('')}`).join('')}).join('');
 const ticks=spec.small?[0,1]:[0,.5,1];
 const dates=[...new Set([spec.dates[0],...(spec.small?[]:[spec.dates[Math.floor(spec.dates.length/2)]]),spec.dates.at(-1)])];
 const grid=ticks.map(frac=>{const value=min+(max-min)*frac;return `<line x1="${left}" x2="${w-right}" y1="${y(value)}" y2="${y(value)}" stroke="#dce5db" stroke-dasharray="2 4"/><text x="${left-6}" y="${y(value)+3}" text-anchor="end">${compact(value)}${spec.unit==='%'?'%':''}</text>`}).join('');
 const hits=spec.dates.map((date,index)=>{const xx=x(date),before=index?(x(spec.dates[index-1])+xx)/2:left,after=index<spec.dates.length-1?(xx+x(spec.dates[index+1]))/2:w-right;return `<rect class="date-hit" data-plot-date="${date}" data-plot-kind="${kind}" data-plot-x="${xx}" x="${before}" y="${top}" width="${Math.max(1,after-before)}" height="${ph}" fill="transparent"/>`}).join('');
 return `<div class="time-chart-wrap"><svg class="time-chart ${spec.small?'small-time-chart':''}" viewBox="0 0 ${w} ${h}" style="height:${h}px" tabindex="0" role="img" aria-label="${esc(state.ticker+' '+spec.label+' by date. Arrow keys inspect reported dates.')}" data-time-chart="${kind}" data-dates="${spec.dates.join(',')}" data-y-min="${min}" data-y-max="${max}" data-chart-top="${top}" data-chart-height="${ph}">${grid}${min<0&&max>0?`<line x1="${left}" x2="${w-right}" y1="${y(0)}" y2="${y(0)}" stroke="#9aafa2"/>`:''}${paths}<line class="chart-crosshair" data-crosshair x1="0" x2="0" y1="${top}" y2="${h-bottom}" style="display:none" stroke="#7fa69a" stroke-dasharray="3 3"/><g data-active-points></g>${dates.map(date=>`<text x="${x(date)}" y="${h-5}" text-anchor="${spec.dates.length===1?'middle':date===spec.dates[0]?'start':date===spec.dates.at(-1)?'end':'middle'}">${spec.small?date.slice(5,7)+'/'+date.slice(0,4):date.slice(5)}</text>`).join('')}${hits}</svg>${!spec.small?`<div class="chart-readout" data-chart-readout="${kind}">${chartReadout(spec,kind,day)}</div>`:''}</div>`;
}
function hoverChart(kind,day,keyboard=false){
 const root=document.querySelector('[data-panel-id="'+panel.id+'"]'),svg=[...root.querySelectorAll('[data-time-chart]')].find(el=>el.dataset.timeChart===kind),spec=chartSpec(kind);
 if(!svg||!spec.dates.includes(day))return;
 const target=[...svg.querySelectorAll('[data-plot-date]')].find(el=>el.dataset.plotDate===day),xx=Number(target.dataset.plotX),line=svg.querySelector('[data-crosshair]');line.style.display='';line.setAttribute('x1',xx);line.setAttribute('x2',xx);
 const min=Number(svg.dataset.yMin),max=Number(svg.dataset.yMax),top=Number(svg.dataset.chartTop),ph=Number(svg.dataset.chartHeight);
 const points=spec.series.map(series=>({series,point:series.points.find(point=>point.date===day)})).filter(row=>row.point);
 svg.querySelector('[data-active-points]').innerHTML=points.filter(row=>Number.isFinite(row.point.value)).map(({series,point})=>`<circle cx="${xx}" cy="${top+(max-point.value)/(max-min||1)*ph}" r="4" fill="${series.color}"/>`).join('');
 state.chartDays[kind]=day;
 const readout=[...root.querySelectorAll('[data-chart-readout]')].find(el=>el.dataset.chartReadout===kind);if(readout)readout.innerHTML=chartReadout(spec,kind,day);
 if(kind==='broker'&&state.brokerDay!==day){state.brokerDay=day;root.querySelector('[data-daily-brokers]').innerHTML=dailyActivity(brokerContext(),day)}
 hideTooltip();
 if(spec.small||keyboard){
  target.dataset.tip=date(day)+'\n'+points.map(({series,point})=>series.label+': '+metricText(point.value,spec.unit)+(point.delta!==null?'\nΔ '+metricText(point.delta,spec.deltaUnit??spec.unit,true):'\nΔ not reported')).join('\n');
  openTooltip(target,true);if(keyboard)svg.setAttribute('aria-describedby','ui-tooltip');
 }
}
function chart(){return timeChart(chartSpec('price'),'price',230)+timeChart(chartSpec('volume'),'volume',110)}
function ownershipHistory(){
 const spec=holdingsSpec();
 return `<section class="card"><div class="registry-chart-head"><h3>Reported holdings</h3><button class="qol-source-link" data-action="source" data-source="changes">Source</button></div>${timeChart(spec,'ownership',245)}<div class="history-chart-legend">${spec.series.map(series=>{const last=series.points.filter(point=>Number.isFinite(point.value)).at(-1);return `<span><i style="background:${series.color}"></i>${last?shareholderName(series.label,state.ticker,last.date):esc(series.label)}</span>`}).join('')}</div></section>`;
}
