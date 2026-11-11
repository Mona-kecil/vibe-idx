const burstMs = 60;
const burstChance = 0.6;
const defaultFadeMs = 600;
const restingEnergy = 0.2;
const resumeMs = 100;
const mapHeight = 360;

type Run = { startedAt: number; fadeMs: number };

let running: (Run & { timer: number; svg: SVGSVGElement }) | null = null;
let stopped: Run & { at: number } = { startedAt: 0, fadeMs: defaultFadeMs, at: -Infinity };

function filter() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="screen-glitch" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
    <feImage x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
    <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="torn" />
    <feColorMatrix in="torn" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
    <feOffset result="red" />
    <feColorMatrix in="torn" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" />
    <feOffset result="cyan" />
    <feBlend in="red" in2="cyan" mode="screen" result="split" />
    <feFlood flood-color="#050505" />
    <feMerge><feMergeNode /><feMergeNode in="split" /></feMerge>
  </filter>`;
  document.body.append(svg);
  return svg;
}

function tears() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = mapHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  for (let y = 0; y < mapHeight; ) {
    const band = 2 + Math.floor(Math.random() ** 2 * 40);
    const shift = Math.random() < 0.6 ? 128 : Math.floor(Math.random() * 256);
    context.fillStyle = `rgb(${shift}, 128, 128)`;
    context.fillRect(0, y, 1, band);
    y += band;
  }
  return canvas.toDataURL();
}

function burst(svg: SVGSVGElement, { startedAt, fadeMs }: Run) {
  const root = document.documentElement;
  const fading = Math.max(1 - (performance.now() - startedAt) / fadeMs, 0);
  const energy = restingEnergy + (1 - restingEnergy) * fading;
  const map = Math.random() < burstChance * energy ? tears() : null;
  if (!map) {
    root.style.filter = '';
    return;
  }
  const width = window.innerWidth;
  const split = ((2 + Math.random() * 8) * energy) / width;
  svg.querySelector('feImage')?.setAttribute('href', map);
  svg
    .querySelector('feDisplacementMap')
    ?.setAttribute('scale', String(((60 + Math.random() * 240) * energy) / width));
  const [red, cyan] = svg.querySelectorAll('feOffset');
  red?.setAttribute('dx', String(split));
  cyan?.setAttribute('dx', String(-split));
  root.style.filter = 'url(#screen-glitch)';
}

export function startGlitch(fadeMs = defaultFadeMs) {
  if (running) return;
  const svg = filter();
  const now = performance.now();
  const run: Run = now - stopped.at < resumeMs ? stopped : { startedAt: now, fadeMs };
  running = { ...run, svg, timer: window.setInterval(() => burst(svg, run), burstMs) };
  burst(svg, run);
}

export function stopGlitch() {
  if (!running) return;
  window.clearInterval(running.timer);
  running.svg.remove();
  stopped = { startedAt: running.startedAt, fadeMs: running.fadeMs, at: performance.now() };
  running = null;
  document.documentElement.style.filter = '';
}
