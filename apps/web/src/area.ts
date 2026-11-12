export type Tone = 'up' | 'down' | 'flat';
export type Extreme = { x: number; y: number; value: number };
export type Pad = { top: number; bottom: number };
export type Area = {
  line: string;
  fill: string;
  tone: Tone;
  change: number;
  changePct: number;
  high: Extreme;
  low: Extreme;
};

export const FLAT_CHANGE_PCT = 0.1;

const defaultPad: Pad = { top: 2, bottom: 2 };
const coordinate = (n: number) => Math.round(n * 100) / 100;

function toneOf(changePct: number): Tone {
  if (Math.abs(changePct) < FLAT_CHANGE_PCT) return 'flat';
  return changePct > 0 ? 'up' : 'down';
}

export function areaChart(
  values: number[],
  width: number,
  height: number,
  pad: Pad = defaultPad,
): Area | null {
  const first = values[0],
    last = values.at(-1);
  if (first === undefined || last === undefined) return null;
  const series = values.length === 1 ? [first, first] : values;
  let highAt = 0,
    lowAt = 0;
  series.forEach((value, i) => {
    if (value > series[highAt]!) highAt = i;
    if (value < series[lowAt]!) lowAt = i;
  });
  const top = series[highAt]!,
    bottom = series[lowAt]!,
    inner = Math.max(0, height - pad.top - pad.bottom),
    y = (value: number) =>
      coordinate(
        top === bottom ? pad.top + inner / 2 : pad.top + ((top - value) / (top - bottom)) * inner,
      ),
    x = (i: number) => coordinate((i / (series.length - 1)) * width),
    point = (i: number): Extreme => ({ x: x(i), y: y(series[i]!), value: series[i]! });
  const line = series.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`).join(' ');
  const change = last - first,
    changePct = first === 0 ? 0 : (change * 100) / first;
  return {
    line,
    fill: `${line} L${x(series.length - 1)},${height} L0,${height} Z`,
    tone: toneOf(changePct),
    change,
    changePct,
    high: point(highAt),
    low: point(lowAt),
  };
}
