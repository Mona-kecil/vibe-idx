import type { Scenario } from '../scenario.js';

export default [
  {
    name: 'preview-panel',
    path: '/terminal?t=BBCA&l=flow',
    clock: '10:30',
    panel: true,
    steps: async (page) => {
      await page.locator('#preview-panel summary').click();
    },
    notes: [
      {
        at: '#preview-panel summary',
        text: 'Fixture session and clock. Click to open or close the panel.',
      },
      {
        at: '#preview-panel select[name=clock]',
        text: "Clock: after the close, or a time in the session, when the session's own data is not published yet.",
      },
      {
        at: '#preview-panel input[name=signed-in]',
        text: 'Signed in: untick to see the signed-out site.',
      },
      {
        at: 'role=tab[name="DD"]',
        text: 'Done detail shows the session before, since running trade is published after the close.',
      },
    ],
  },
] satisfies Scenario[];
