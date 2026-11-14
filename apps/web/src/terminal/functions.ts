export const functions = {
  WL: 'Watchlist',
  GP: 'Chart',
  KEY: 'Key figures',
  BRK: 'Broker summary',
  BFL: 'Broker flow',
  BD: 'Broker distribution',
  BA: 'Broker activity',
  FF: 'Foreign flow',
  OB: 'Closing order book',
  RT: 'Running trade',
  DD: 'Done detail',
  TB: 'Trade book',
  HDS: 'Holders',
  DISC: 'Disclosures',
  FEED: 'Timeline',
  SIG: 'Signals',
  HEAT: 'Heatmap',
  MOV: 'Movers',
  NEWS: 'News',
  CAL: 'Economic calendar',
  CA: 'Corp actions',
  RISK: 'Risk flags',
};
export type FunctionId = keyof typeof functions;
export const isFunction = (value: string): value is FunctionId => Object.hasOwn(functions, value);
/** Functions that read broker data or running trade, which only a signed-in user can see. */
export const signedInOnly: ReadonlySet<FunctionId> = new Set<FunctionId>([
  'BRK',
  'BFL',
  'BD',
  'BA',
  'FF',
  'OB',
  'RT',
  'DD',
  'TB',
]);
