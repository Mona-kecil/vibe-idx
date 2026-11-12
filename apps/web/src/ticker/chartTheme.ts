import type { IPanePrimitive, IPrimitivePaneRenderer, Time } from 'lightweight-charts';

// Canvas cannot read CSS variables, so these mirror the .site tokens in site.css.
export const chartTheme = {
  surface: '#fdfcf9',
  grid: '#efeee8',
  line: '#dcdcd4',
  text: '#62635c',
  ink: '#222320',
  up: '#167049',
  down: '#b43c36',
  flat: '#a3a49b',
  selection: '#566d8a',
  font: "Manrope, 'Helvetica Neue', sans-serif",
} as const;

export function paneLabel(name: string, unit: string): IPanePrimitive<Time> {
  const renderer: IPrimitivePaneRenderer = {
    draw: (target) =>
      target.useMediaCoordinateSpace(({ context }) => {
        context.textBaseline = 'top';
        context.fillStyle = chartTheme.text;
        context.font = `700 10px ${chartTheme.font}`;
        context.fillText(name, 8, 7);
        const gap = context.measureText(`${name}  `).width;
        context.font = `500 10px ${chartTheme.font}`;
        context.fillText(unit, 8 + gap, 7);
      }),
  };
  const views = [{ zOrder: () => 'top' as const, renderer: () => renderer }];
  return { paneViews: () => views };
}
