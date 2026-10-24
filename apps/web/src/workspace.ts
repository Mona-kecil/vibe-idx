import { z } from 'zod';

export const modules = {
  brokers: { name: 'Broksum', icon: 'broker', ticker: true },
  market: { name: 'Market summary', icon: 'market', ticker: false },
  ownership: { name: 'Ownership', icon: 'ownership', ticker: true },
  profile: { name: 'Company profile', icon: 'profile', ticker: true },
  price: { name: 'Price & volume', icon: 'price', ticker: true },
  report: { name: '5% report', icon: 'report', ticker: false },
  radar: { name: 'Market radar', icon: 'radar', ticker: false },
  news: { name: 'News', icon: 'news', ticker: true },
  sources: { name: 'Sources', icon: 'sources', ticker: true },
};
export const moduleSchema = z.enum([
  'brokers',
  'market',
  'ownership',
  'profile',
  'price',
  'report',
  'radar',
  'news',
  'sources',
]);
export type Module = z.infer<typeof moduleSchema>;
const controlsSchema = z.object({
  ticker: z.string(),
  from: z.string(),
  through: z.string(),
  compare: z.boolean(),
  query: z.string(),
  sort: z.enum(['ticker', 'close', 'change_pct', 'volume', 'value', 'net_foreign']),
  direction: z.number(),
  ownershipView: z.enum(['five', 'registry', 'one']),
  reportMode: z.enum(['all', 'changed']),
  reportTicker: z.string(),
  marketFilter: z.string(),
  brokerUnit: z.enum(['shares', 'value']),
  brokerFlow: z.enum(['net', 'gross']),
  brokerCodes: z.array(z.string()).nullable(),
  brokerDay: z.string().nullable(),
  priceDay: z.string().nullable().default(null),
});
const panelSchema = z.object({
  id: z.string(),
  type: moduleSchema,
  span: z.number().min(4).max(12),
  height: z.number().min(280).max(1100),
  state: controlsSchema,
});
const workspaceSchema = z
  .object({
    version: z.literal(1),
    linked: z.boolean(),
    collapsed: z.boolean(),
    activeId: z.string().nullable(),
    focusId: z.string().nullable(),
    nextId: z.number().int().positive(),
    panels: z.array(panelSchema),
  })
  .transform((state) => {
    const exists = (id: string | null) => state.panels.some((panel) => panel.id === id);
    return {
      ...state,
      activeId: exists(state.activeId) ? state.activeId : null,
      focusId: exists(state.focusId) ? state.focusId : null,
    };
  });
export type Panel = z.infer<typeof panelSchema>;
export type Controls = Panel['state'];
export type WorkspaceState = z.infer<typeof workspaceSchema>;
export const layoutKey = 'vibe-idx-workspace-v1';
export function makePanel(id: string, type: Module, ticker: string): Panel {
  return {
    id,
    type,
    span: 6,
    height: 530,
    state: {
      ticker,
      from: '',
      through: '',
      compare: false,
      query: '',
      sort: 'ticker',
      direction: 1,
      ownershipView: 'five',
      reportMode: 'all',
      reportTicker: 'all',
      marketFilter: 'all',
      brokerUnit: 'shares',
      brokerFlow: 'net',
      brokerCodes: null,
      brokerDay: null,
      priceDay: null,
    },
  };
}
export function initialWorkspace(ticker = 'SINI'): WorkspaceState {
  return {
    version: 1,
    linked: true,
    collapsed: false,
    activeId: 'p1',
    focusId: null,
    nextId: 5,
    panels: [
      makePanel('p1', 'brokers', ticker),
      makePanel('p2', 'market', ticker),
      makePanel('p3', 'ownership', ticker),
      makePanel('p4', 'profile', ticker),
    ],
  };
}
export function restoreWorkspace(
  saved: string | null,
  ticker?: string,
  reloading = false,
): WorkspaceState {
  let state = initialWorkspace(ticker);
  if (saved) {
    try {
      const parsed = workspaceSchema.safeParse(JSON.parse(saved));
      if (parsed.success) state = parsed.data;
    } catch {
      /* A discarded or edited browser layout starts a new desk. */
    }
  }
  if (ticker && !reloading) {
    state = {
      ...state,
      focusId: null,
      panels: state.panels.map((panel) =>
        modules[panel.type].ticker ? { ...panel, state: { ...panel.state, ticker } } : panel,
      ),
    };
    if (!state.panels.some((panel) => modules[panel.type].ticker))
      state = workspaceReducer(state, { type: 'add', module: 'price', ticker });
  }
  return state;
}
export type WorkspaceAction =
  | { type: 'active'; id: string }
  | { type: 'ticker'; id: string; ticker: string }
  | { type: 'link' | 'sidebar' }
  | { type: 'add'; module: Module; ticker?: string }
  | { type: 'duplicate' | 'remove' | 'focus'; id: string }
  | { type: 'controls'; id: string; patch: Partial<Controls> }
  | { type: 'resize'; id: string; span: number; height: number }
  | { type: 'move'; id: string; before: string | null };
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  const active = state.panels.find((panel) => panel.id === state.activeId) ?? state.panels[0];
  switch (action.type) {
    case 'active':
      return state.activeId === action.id ? state : { ...state, activeId: action.id };
    case 'ticker':
      return {
        ...state,
        activeId: action.id,
        panels: state.panels.map((panel) =>
          modules[panel.type].ticker && (state.linked || panel.id === action.id)
            ? {
                ...panel,
                state: {
                  ...panel.state,
                  ticker: action.ticker,
                  brokerDay: null,
                  priceDay: null,
                },
              }
            : panel,
        ),
      };
    case 'link': {
      const linked = !state.linked;
      const ticker = active?.state.ticker ?? 'SINI';
      return {
        ...state,
        linked,
        panels: linked
          ? state.panels.map((panel) =>
              modules[panel.type].ticker
                ? { ...panel, state: { ...panel.state, ticker, brokerDay: null, priceDay: null } }
                : panel,
            )
          : state.panels,
      };
    }
    case 'sidebar':
      return { ...state, collapsed: !state.collapsed };
    case 'add': {
      const panel = makePanel(
        `p${state.nextId}`,
        action.module,
        action.ticker ?? active?.state.ticker ?? 'SINI',
      );
      return {
        ...state,
        panels: [...state.panels, panel],
        nextId: state.nextId + 1,
        activeId: panel.id,
        focusId: null,
      };
    }
    case 'duplicate': {
      const original = state.panels.find((panel) => panel.id === action.id);
      if (!original) return state;
      const panel = {
        ...original,
        id: `p${state.nextId}`,
        state: { ...original.state, brokerCodes: original.state.brokerCodes?.slice() ?? null },
      };
      const panels = state.panels.slice();
      panels.splice(panels.indexOf(original) + 1, 0, panel);
      return { ...state, panels, nextId: state.nextId + 1, activeId: panel.id, focusId: null };
    }
    case 'remove': {
      const panels = state.panels.filter((panel) => panel.id !== action.id);
      return {
        ...state,
        panels,
        activeId: state.activeId === action.id ? (panels[0]?.id ?? null) : state.activeId,
        focusId: state.focusId === action.id ? null : state.focusId,
      };
    }
    case 'focus':
      return {
        ...state,
        activeId: action.id,
        focusId: state.focusId === action.id ? null : action.id,
      };
    case 'controls':
      return {
        ...state,
        panels: state.panels.map((panel) =>
          panel.id === action.id ? { ...panel, state: { ...panel.state, ...action.patch } } : panel,
        ),
      };
    case 'resize':
      return {
        ...state,
        panels: state.panels.map((panel) =>
          panel.id === action.id
            ? {
                ...panel,
                span: Math.max(4, Math.min(12, action.span)),
                height: Math.max(280, Math.min(1100, action.height)),
              }
            : panel,
        ),
      };
    case 'move': {
      const panel = state.panels.find((panel) => panel.id === action.id);
      if (!panel || action.id === action.before) return state;
      const panels = state.panels.filter((panel) => panel.id !== action.id);
      const index = panels.findIndex((panel) => panel.id === action.before);
      panels.splice(index < 0 ? panels.length : index, 0, panel);
      return { ...state, panels, activeId: action.id };
    }
  }
}
export function tickerFromPath(path: string) {
  return /^\/t\/([A-Z0-9-]{1,12})\/?$/i.exec(path)?.[1]?.toUpperCase();
}
