export type Tile<T> = { item: T; x: number; y: number; w: number; h: number };

/** Squarified treemap: areas proportional to `value`, in input order. */
export function treemap<T extends { value: number }>(
  items: T[],
  width: number,
  height: number,
): Tile<T>[] {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total || !width || !height) return [];
  const remaining = items.map((item) => ({
    item,
    area: (item.value / total) * width * height,
  }));
  const out: Tile<T>[] = [];
  let x = 0,
    y = 0,
    w = width,
    h = height;
  type Node = (typeof remaining)[number];
  let row: Node[] = [];
  const worst = (nodes: Node[], edge: number) => {
    if (!nodes.length) return Infinity;
    const sum = nodes.reduce((n, node) => n + node.area, 0);
    return Math.max(
      (edge ** 2 * Math.max(...nodes.map((node) => node.area))) / sum ** 2,
      sum ** 2 / (edge ** 2 * Math.min(...nodes.map((node) => node.area))),
    );
  };
  function place(nodes: Node[]) {
    const sum = nodes.reduce((n, node) => n + node.area, 0);
    if (w >= h) {
      const rw = sum / h;
      let yy = y;
      for (const node of nodes) {
        const rh = node.area / rw;
        out.push({ item: node.item, x, y: yy, w: rw, h: rh });
        yy += rh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = sum / w;
      let xx = x;
      for (const node of nodes) {
        const rw = node.area / rh;
        out.push({ item: node.item, x: xx, y, w: rw, h: rh });
        xx += rw;
      }
      y += rh;
      h -= rh;
    }
  }
  for (const node of remaining) {
    if (worst([...row, node], Math.min(w, h)) > worst(row, Math.min(w, h))) {
      place(row);
      row = [];
    }
    row.push(node);
  }
  if (row.length) place(row);
  return out;
}
