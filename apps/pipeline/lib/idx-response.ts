export type Download = (url: string) => Promise<Uint8Array>;
export const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
export const ymd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d).replaceAll('-', '');
