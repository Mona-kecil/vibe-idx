from pathlib import Path
import re,json,base64,gzip
root=Path(__file__).parent
source=Path('/tmp/vibe-idx-redesign')
s=(source/'template.html').read_text()
css=s.split('<style>',1)[1].split('</style>',1)[0].replace('__PRODUCTION_CSS__',(source/'index-CxMK6Qck.css').read_text().replace('100vh','0px'))
helper=s[s.index('const f='):s.index('function heading()')]
selectors=helper[helper.index('const detail='):helper.index('const table=')]
shared=helper[:helper.index('const detail=')]+helper[helper.index('const table='):helper.index('function sampleLinks()')]
sample=helper[helper.index('function sampleLinks()'):]
shared=shared.replace('<div class="source-foot"><span>${label}</span><button data-action="source" data-source="${key}">View source</button></div>','<div class="source-foot"><button data-action="source" data-source="${key}" data-tip="${esc(label)}">Source</button></div>')
functions={}
positions=list(re.finditer(r'^(?:async )?function ([A-Za-z]+)\(',s,re.M))
for i,m in enumerate(positions):
 end=positions[i+1].start() if i+1<len(positions) else s.index('\nstart();',m.start())
 functions[m[1]]=s[m.start():end]
functions['holderSummary']=functions['holderSummary'].replace('${esc(r.investor)}','${shareholderName(r.investor,state.ticker,data.health.five_pct)}')
functions['report']=functions['report'].replace('${esc(r.investor)}','${shareholderName(r.investor,r.ticker,data.five.asOf)}')
names=['priceCard','unconnectedBrokerCard','brokerColor','holderSummary','ownershipCoverage','historyCard','coverage','report','stocks','radar','showSource','action','change']
body='\n'.join(functions[n] for n in names)
body=body.replace("||field==='brokerSelectedOnly'",'')
body='\n'.join(line for line in body.split('\n') if "if(a==='broker-sort')" not in line)
body=body.replace("const w=innerWidth<720?Math.max(260,innerWidth-110):760",'const w=Math.max(280,Math.min(1100,width))')
body=body.replace("${rows[0].date} to ${rows.at(-1).date}","${rows[0].date} to ${rows.at(-1).date}")
body=body.replace('<tr><td>${link(r.ticker)}<div class="inline-meta">${esc(r.name)}</div>','<tr class="${r.ticker===state.ticker?\'selected-stock\':\'\'}"><td>${link(r.ticker)}<div class="inline-meta">${esc(r.name)}</div>')
body=body.replace('Retained: palette, typography, large heading, freshness strip, Radar, Stocks and white tables.','Retained: production palette, typography, tables and the captured V2.1 sources.')
body=body.replace('Added: a direct 5% report, four example links, ticker research tabs, volume bars, range inspection, broker inventory and source coverage.','Added: a module picker, movable/resizable panels, duplicate module instances and a ticker link toggle.')
body=body.replace('Variant A keeps the ticker as its own page.','Panels own dates, filters and controls. Linking changes tickers only.').replace('Variant B retains the scan beside ticker detail on wide screens.','Linking on adopts the active panel ticker; linking off preserves current selections.').replace('The default recommendation is A for its smaller change to production.','V2.1 remains the saved checkpoint. This V2.2 is a scratch workspace prototype.')
extra=(root/'views.js').read_text()+'\n'+(root/'qol-views.js').read_text()+'\n'+(root/'trading-views.js').read_text()
factory='function createView(panel,width){\nconst state=panel.state;\n'+selectors+sample+body+extra+'\nreturn {html,action,change,qolSource,hoverChart};\n}\n'
data=json.loads((source/'data.json').read_text())
for filename,key in [('broker-directory.json','brokerDirectory'),('underwriters-source.json','underwriters'),('registry-source.json','registry'),('investor-types-source.json','investorTypes'),('affiliation-source.json','affiliations')]:
 data[key]=json.loads((root/filename).read_text()) if (root/filename).exists() else {}
if isinstance(data['investorTypes'].get('snapshots'),list):
 raw=data['investorTypes']['snapshots'];grouped={}
 for snapshot in raw:
  ticker=snapshot.get('ticker')
  if ticker:grouped.setdefault(ticker,{'snapshots':[]})['snapshots'].append(snapshot)
 data['investorTypes']=grouped
for ticker,record in data['registry'].items():
 record['categoryBasis']={'SINI':'named_holder_register','BREN':'investor_type_by_domicile'}.get(ticker,'not_reported')
brokers=json.loads((source/'broker-data.json').read_text())
data['brokers']=brokers
encoded=base64.b64encode(gzip.compress(json.dumps(data,separators=(',',':')).encode(),mtime=0)).decode()
js="'use strict';\nconst data={};\nconst symbols=['SINI','BRPT','TPIA','BREN'];\n"+shared+factory+(root/'tooltips.js').read_text()+'\n'+(root/'chart-controls.js').read_text()+'\n'+(root/'workspace.js').read_text().replace('__BROKERS_GZIP__',encoded)
js=js.replace("data.brokers=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();", "Object.assign(data,await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json());")
js=js.replace('bind();render();','bind();bindTooltips();bindChartControls();render();')
js=js.replace('function render(){','function render(){\n hideTooltip();')
js=js.replace('data-code="${code}"','data-code="${code}" data-tip="${esc(brokerName(code))}"').replace('data-code="${r.code}"','data-code="${r.code}" data-tip="${esc(brokerName(r.code))}"')
js=js.replace('>${code} ${sign(state.brokerUnit', '>${brokerTag(code)} ${sign(state.brokerUnit')
js=js.replace('${esc(r.holderName)}','${accountBroker(r.holderName)}')
js=js.replace("const panel=panelById(action.closest('[data-panel-id]')?.dataset.panelId);if(!panel)return;", "const panel=panelById(action.closest('[data-panel-id]')?.dataset.panelId);if(!panel)return;\n if(action.dataset.action==='qol-source'){createView(panel,400).qolSource(action.dataset.kind,action.dataset);return}")
js=js.replace('<p class="profile-ticker">${state.ticker} · COMPANY</p>','')
js=js.replace('Every session checked against the price calendar and reported broker counts.', 'Every session checked against the price calendar and reported broker counts. XL, PD and CC were arbitrary demo choices. There was no stock-specific or data-driven reason for choosing them; they are not a ranking or accumulation signal.')
js=js.replace('V2.2 · Prototype','V2.4 · Prototype')
js=js.replace('<p class="eyebrow">Vibe IDX · Research</p>','').replace('<p>Keep the sources you need beside each other.</p>','')
js=js.replace('<span class="hint-text">${workspace.linked?\'Changing a ticker updates all panels.\':\'Each panel keeps its own ticker.\'} Dates stay independent.</span>','')
js=js.replace('<div class="rail-foot"><strong>Your research desk.</strong><br>Add modules as you need them.<br>Each panel can be moved or resized.</div>','')
js=js.replace('<br>Captured market summary','')
js=js.replace('<p>Daily closes and traded shares. Move the cursor to inspect a session.</p>','')
js=js.replace('<p>${state.ticker} · all boards · all investors · daily gross buy/sell data</p>','')
js=js.replace("'<span class=\"badge available\">Complete captured period</span>'", "''")
js=js.replace('Choose brokers & inspect totals','Brokers').replace('Single-session broker activity','Daily activity')
js=js.replace('<p>${state.ticker} · ${date(c.through)} · move the shared date cursor to inspect another day</p>','<p>${date(c.through)}</p>')
js=js.replace('<p>${date(state.from)} to ${date(c.through)} · ${c.inspected.length} sessions · quantities in shares, not lots</p>','')
js=js.replace('<p class="footnote">All returned brokers are retained. Weighted average transaction prices use total value divided by total shares for each side. They are not remaining-position cost estimates.</p>','')
js=js.replace('Snapshot ${data.health.five_pct}. This is a disclosed list, not the full shareholder base.','${data.health.five_pct}')
js=js.replace('The production table, scoped to the four examples. Select a ticker to research it.','')
js=js.replace('${rows.length} stocks. Column headings sort the table.','${rows.length} stocks')
js=js.replace('A cumulative change since the selected baseline. This is not an opening holding, an investor identity or the cost of a remaining position.','Net change from the selected baseline; opening holdings are unknown.')

js=js.replace("['SID and reported free float','Not connected','These need monthly registry reports. The 1% remainder is displayed as a dated arithmetic measure, not a verified current free float.']","['SID and reported free float','Available','Historical monthly registry snapshots for May and June 2026. These are not current October values.']")
js=js.replace("['Financials, insiders and corporate actions'","['KSEI investor types',data.investorTypes?.[state.ticker]?.snapshots?.length?'Available':'Not sourced','KSEI scripless investor classifications, kept separate from the registered local/foreign tables.'],['Financials, insiders and corporate actions'")
html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vibe IDX · V2.4 research workspace</title><style>'+css+'\n'+(root/'workspace.css').read_text()+'\n'+(root/'qol.css').read_text()+'\n'+(root/'trading.css').read_text()+'</style></head><body><div id="app"></div><div id="workspace-status" class="visually-hidden" role="status" aria-live="polite"></div><dialog id="source-dialog" class="source-dialog" aria-labelledby="source-title"><div class="dialog-head"><h3 id="source-title"></h3><button data-action="close-source" aria-label="Close source">×</button></div><div id="source-content"></div></dialog><div id="ui-tooltip" role="tooltip" hidden></div><script>'+js+'</script></body></html>'
if len(html)>512000:raise SystemExit('Inline artifact exceeds render size limit.')
(root/'site/index.html').write_text(html)
print(json.dumps({'characters':len(html),'path':str(root/'site/index.html')}))
