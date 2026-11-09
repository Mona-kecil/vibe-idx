import { ColorType, CrosshairMode, createChart, type Time } from 'lightweight-charts';
export function terminalChart(host: HTMLElement) {
  return createChart(host, {
    autoSize: true,
    layout: {
      attributionLogo: false,
      background: { type: ColorType.Solid, color: '#101312' },
      textColor: '#8d9790',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      panes: { separatorColor: '#222826', separatorHoverColor: '#d6b25e', enableResize: true },
    },
    grid: { vertLines: { color: '#151a18' }, horzLines: { color: '#151a18' } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#5b6560', labelBackgroundColor: '#232a27' },
      horzLine: { color: '#5b6560', labelBackgroundColor: '#232a27' },
    },
    rightPriceScale: { borderColor: '#222826' },
    timeScale: { borderColor: '#222826', rightOffset: 4 },
  });
}

export function chartDate(time: Time | undefined) {
  return typeof time === 'string'
    ? time
    : typeof time === 'object'
      ? `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
      : null;
}
