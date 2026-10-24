function profile(){
 const p=data.profiles.find(r=>r.ticker===state.ticker);
 return `<p class="profile-ticker">${state.ticker} · COMPANY</p><h3 class="module-profile-name">${esc(detail().name)}</h3>${[['Listing board',p.board],['Sector',p.sector],['Industry',p.industry],['Listing date',p.listingDate.slice(0,10)],['Share registrar',p.registrar||'Not supplied']].map(([key,value])=>`<div class="row-detail"><span>${key}</span><strong>${esc(value)}</strong></div>`).join('')}<p class="profile-summary">${esc(p.business)}</p><div class="company-links"><a href="${esc(p.website.startsWith('http')?p.website:'https://'+p.website.trim())}" target="_blank" rel="noopener noreferrer">Issuer website ↗</a><a href="https://stockbit.com/symbol/${state.ticker}" target="_blank" rel="noopener noreferrer">Stockbit ↗</a></div>${underwriters()}${holderSummary()}${source('Saved IDX company profile. Capture date is not supplied.','company')}`;
}
function market(){
 const latest=data.market.history.at(-1);
 return `<div class="market-index"><div><strong>IHSG ${f(latest.close,3)}</strong><small>${data.market.date} · <span class="${tone(latest.change_pct)}">${percent(latest.change_pct)}</span></small></div><div class="breadth">${data.market.up} up · ${data.market.down} down<br>Captured market summary</div></div>${stocks()}`;
}
function news(){
 const items=data.news[state.ticker];
 return `<div class="card-head"><div><h3>${state.ticker} news results</h3><p>Fetched ${data.capturedAt}. Headlines are news results, not verified company disclosures.</p></div></div><ul class="summary-list news-list">${items.items.map(item=>`<li><a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><span class="meta">${esc(item.source)} · ${esc(item.pubDate)}</span></li>`).join('')}</ul>${source('Google News RSS query for '+state.ticker+' saham.','news')}`;
}
function html(){
 const renderers={brokers:()=>rangeToolbar()+brokerCard(),market,ownership,profile,price:()=>rangeToolbar()+priceCard()+historyCard(),report,radar,news,sources:coverage};
 return renderers[panel.type]();
}
