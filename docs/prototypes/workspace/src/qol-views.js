function shareholderName(name,ticker=state.ticker,through=data.five.asOf){
 const rows=(data.affiliations?.[ticker]||[]).filter(row=>row.asOf<=through);
 const asOf=rows.reduce((latest,row)=>row.asOf>latest?row.asOf:latest,'');
 const key=normalizeCompany(name),row=rows.find(row=>row.asOf===asOf&&[row.investor,...(row.aliases||[])].some(alias=>normalizeCompany(alias)===key));
 if(!row)return esc(name);
 const flags=[['controller','Controller','Pengendali'],['controllerAffiliate','Controller affiliate','Afiliasi Pengendali']];
 return esc(name)+flags.filter(([field])=>row[field]===true).map(([field,label,sourceField])=>`<button class="relationship-badge ${field}" data-relationship="${field}" data-action="qol-source" data-kind="affiliations" data-ticker="${ticker}" data-as-of="${row.asOf}" data-investor="${esc(row.investor)}" data-tip="${esc(label+' · reported '+date(row.asOf)+'\nMonthly disclosure · '+sourceField+' · page '+row.page+'\nOpen source')}" aria-label="${esc(label+', reported '+date(row.asOf)+', view source for '+name)}">${label}</button>`).join('');
}
function qolSource(kind,context={}){
 const ticker=context.ticker||state.ticker;
 const record=kind==='affiliations'?(data.affiliations?.[ticker]||[]).filter(row=>row.asOf===context.asOf&&row.investor===context.investor):kind==='registry'?{monthly:data.registry?.[state.ticker],investorTypes:data.investorTypes?.[state.ticker]}:kind==='underwriters'?data.underwriters?.[state.ticker]:data.brokerDirectory;
 const title=kind==='affiliations'?'Control relationships':kind==='registry'?'Monthly registry':kind==='underwriters'?'IPO underwriters':'Broker directory';
 document.getElementById('source-title').textContent=ticker+' · '+title;
 const urls=new Set();
 function collect(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(/url/i.test(key)&&typeof item==='string'&&/^https?:\/\//.test(item))urls.add(item);else if(typeof item==='object')collect(item)}}
 collect(record);
 document.getElementById('source-content').innerHTML=`${[...urls].map(url=>`<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>`).join('')}<pre>${esc(JSON.stringify(record||{status:'Not sourced'},null,2))}</pre>`;
 document.getElementById('source-dialog').showModal();
}
function registryMetric(snapshots,key,label,unit){
 const rows=snapshots.filter(row=>Number.isFinite(row[key])).sort((a,b)=>a.asOf.localeCompare(b.asOf));
 if(!rows.length)return `<div class="registry-metric"><h3>${label}</h3><strong>—</strong></div>`;
 const latest=rows.at(-1);
 return `<div class="registry-metric"><h3>${label}</h3><strong>${f(latest[key],unit==='%'?2:0)}${unit}</strong>${timeChart(chartSpec('registry:'+key),'registry:'+key,125)}</div>`;
}
function compositionChart(snapshot){
 const categories=snapshot.categories||[];
 if(!categories.length)return '<p class="monthly-empty">Shareholder categories not reported.</p>';
 const w=Math.max(300,Math.min(1000,width)),left=Math.min(145,w*.36),right=45,top=10,bottom=28,rowH=32,h=top+categories.length*rowH+bottom,pw=w-left-right;
 const percentage=(row,key)=>Number.isFinite(row[key+'Pct'])?row[key+'Pct']:Number.isFinite(row[key+'Shares'])&&snapshot.totalShares?row[key+'Shares']/snapshot.totalShares*100:null;
 const bars=categories.map((row,index)=>{
  const local=percentage(row,'local'),foreign=percentage(row,'foreign'),yy=top+index*rowH,total=local!==null&&foreign!==null?local+foreign:(local??foreign);
  const tip=row.label+'\nLocal: '+f(row.localShares)+' shares · '+f(local,2)+'%\nForeign: '+f(row.foreignShares)+' shares · '+f(foreign,2)+'%';
  return `<g tabindex="0" data-tip="${esc(tip)}"><text x="${left-9}" y="${yy+13}" text-anchor="end">${esc(row.label.length>23?row.label.slice(0,22)+'…':row.label)}</text>${local!==null?`<rect x="${left}" y="${yy+1}" width="${local/100*pw}" height="18" rx="2" fill="#3d755a"/>`:''}${foreign!==null?`<rect x="${left+(local||0)/100*pw}" y="${yy+1}" width="${foreign/100*pw}" height="18" rx="2" fill="#47859a"/>`:''}<text x="${left+((local||0)+(foreign||0))/100*pw+5}" y="${yy+13}">${total===null?'—':f(total,2)+'%'}</text></g>`;
 }).join('');
 return `<div class="chart-key"><span><i style="background:#3d755a"></i>Local</span><span><i style="background:#47859a"></i>Foreign</span></div><svg class="composition-chart" viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img" aria-label="${state.ticker} shareholder categories as a percentage of all shares on ${snapshot.asOf}">${[0,25,50,75,100].map(n=>`<line x1="${left+n/100*pw}" x2="${left+n/100*pw}" y1="0" y2="${h-bottom}" stroke="#e2e9e1" stroke-dasharray="2 4"/><text x="${left+n/100*pw}" y="${h-5}" text-anchor="middle">${n}%</text>`).join('')}${bars}</svg>`;
}
function monthlyRegistry(){
 const record=data.registry?.[state.ticker],snapshots=(record?.snapshots||[]).slice().sort((a,b)=>a.asOf.localeCompare(b.asOf));
 if(!snapshots.length)return `<div class="monthly-empty">Monthly registry report not sourced.</div>`;
 const latest=snapshots.at(-1),types=data.investorTypes?.[state.ticker]?.snapshots?.find(row=>row.asOf===latest.asOf);
 return `<div class="compact-source"><span>${date(latest.asOf)}</span><button class="qol-source-link" data-action="qol-source" data-kind="registry">Source</button></div><div class="registry-metrics">${registryMetric(snapshots,'sidCount','SID','')}${registryMetric(snapshots,'reportedFreeFloatPct','Reported free float','%')}</div><div class="registry-chart-head"><h3>Investor types</h3><span class="meta">KSEI scripless shares</span></div>${investorTypeChart(types)}${latest.categoryTotals?`<div class="registry-chart-head"><h3>Registered local / foreign</h3><span class="meta">${compact(latest.totalShares)} shares</span></div>${domicileChart(latest)}`:''}${record.categoryBasis==='investor_type_by_domicile'?`<details class="history-details"><summary>Register categories</summary>${compositionChart(latest)}</details>`:''}`;
}
function ownership(){
 const groups=data.five.groups.filter(g=>g.holding.ticker===state.ticker),one=data.one.filter(r=>r.ticker===state.ticker);
 const accounts=table(['Investor','Broker / custodian','Shares','Stake'],groups.flatMap(group=>group.holding.accounts.map((account,index)=>`<tr>${index===0?`<td rowspan="${group.holding.accounts.length}"><strong>${shareholderName(group.holding.investorName,state.ticker,group.holding.asOf)}</strong></td>`:''}<td>${accountBroker(account.holderName)}</td><td class="numeric">${f(account.shares)}</td>${index===0?`<td class="numeric" rowspan="${group.holding.accounts.length}">${f(group.holding.percent,2)}%</td>`:''}</tr>`)));
 const oneTable=table(['Investor','Category','Shares','Stake','Scripless','Scrip'],one.map(row=>`<tr><td>${shareholderName(row.investorName,state.ticker,row.asOf)}</td><td>${esc(row.classification||'—')}</td><td class="numeric">${f(row.total)}</td><td class="numeric">${f(row.percent,2)}%</td><td class="numeric">${f(row.scripless)}</td><td class="numeric">${f(row.scrip)}</td></tr>`));
 return `<div class="stack"><section class="card"><div class="filter-buttons">${[['five','5% accounts'],['registry','Monthly registry'],['one','1% holdings']].map(([id,title])=>`<button class="small-button ${state.ownershipView===id?'selected':''}" data-action="ownership-view" data-view="${id}">${title}</button>`).join('')}</div>${state.ownershipView==='registry'?monthlyRegistry():state.ownershipView==='one'?`<div class="compact-source"><span>27 Feb 2026</span><button class="qol-source-link" data-action="source" data-source="ownership">Source</button></div>${oneTable}`:`<div class="compact-source"><span>${date(data.five.asOf)}</span><button class="qol-source-link" data-action="source" data-source="ownership">Source</button></div><div class="ownership-accounts">${accounts}</div>`}</section>${ownershipHistory()}</div>`;
}
function underwriters(){
 const record=data.underwriters?.[state.ticker],listing=record?.idxOriginalListingUnderwriterEvidence,rows=record?.underwriters?.length?record.underwriters:listing?.underwriters||[],title=listing&&!record?.underwriters?.length?'1996 IDX listing underwriter':'IPO underwriters';
 return `<section class="underwriters"><div class="registry-chart-head"><h3>${title}</h3><button class="qol-source-link" data-action="qol-source" data-kind="underwriters">Source</button></div>${rows.length?rows.map(row=>`<div class="underwriter-row"><span class="account-broker">${row.code?brokerTag(row.code).replace('data-tip="','data-tip="August 2026 directory association; IPO-time code unverified. '):''}<span>${esc(row.name)}</span></span>${row.role?`<small>${row.role==='lead_underwriter'?'Lead':'Syndicate'}${row.historicalCode?' · historical':''}</small>`:''}</div>`).join(''):'<p class="monthly-empty">Not sourced.</p>'}</section>`;
}
function domicileChart(snapshot){
 const totals=snapshot.categoryTotals;if(!totals)return '';
 return `<div class="chart-key"><span><i style="background:#3d755a"></i>Local ${f(totals.localPct,2)}%</span><span><i style="background:#47859a"></i>Foreign ${f(totals.foreignPct,2)}%</span></div><svg class="domicile-chart" viewBox="0 0 400 28" style="height:28px;width:100%" role="img" aria-label="Local and foreign registered ownership on ${snapshot.asOf}"><rect x="0" y="1" width="${totals.localPct*4}" height="22" rx="3" fill="#3d755a" tabindex="0" data-tip="${esc('Local\n'+f(totals.localShares)+' shares · '+f(totals.localPct,2)+'%')}"/><rect x="${totals.localPct*4}" y="1" width="${totals.foreignPct*4}" height="22" rx="3" fill="#47859a" tabindex="0" data-tip="${esc('Foreign\n'+f(totals.foreignShares)+' shares · '+f(totals.foreignPct,2)+'%')}"/></svg>`;
}
function investorTypeChart(snapshot){
 const rows=(snapshot?.categories||[]).filter(row=>Number.isFinite(row.shares)&&row.shares>0).sort((a,b)=>b.shares-a.shares);
 if(!rows.length)return '<p class="monthly-empty">Investor types not sourced.</p>';
 const w=Math.max(300,Math.min(1000,width)),left=Math.min(140,w*.34),right=55,top=9,bottom=27,rowH=29,h=rows.length*rowH+top+bottom,pw=w-left-right,max=Math.max(...rows.map(row=>row.shares));
 return `<svg class="composition-chart investor-types-chart" viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img" aria-label="${state.ticker} KSEI scripless shares by investor type, ${snapshot.asOf}">${[0,.5,1].map(frac=>`<line x1="${left+frac*pw}" x2="${left+frac*pw}" y1="0" y2="${h-bottom}" stroke="#e0e8de" stroke-dasharray="2 4"/><text x="${left+frac*pw}" y="${h-5}" text-anchor="middle">${compact(frac*max)}</text>`).join('')}${rows.map((row,index)=>{const yy=top+index*rowH,label=row.label.length>23?row.label.slice(0,22)+'…':row.label;return `<g tabindex="0" data-tip="${esc(row.label+'\n'+f(row.shares)+' KSEI scripless shares\n'+date(snapshot.asOf))}"><text x="${left-8}" y="${yy+12}" text-anchor="end">${esc(label)}</text><rect x="${left}" y="${yy}" width="${row.shares/max*pw}" height="17" rx="2" fill="#4b7e62"/><text x="${left+row.shares/max*pw+5}" y="${yy+12}">${compact(row.shares)}</text></g>`}).join('')}</svg>`;
}
