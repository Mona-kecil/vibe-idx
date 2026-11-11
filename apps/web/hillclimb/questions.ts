import type { Locator } from 'playwright-core';
import type { Ui } from './ui';

export type Question = { text: string; ask: (ui: Ui) => Promise<void> };

const body = (table: Locator) => table.locator('tbody > tr');
const top = (rows: Locator, first = 10) => ({ rows, first });

/**
 * The frozen question list from docs/terminal-hillclimb.md, asked in order in one session.
 * The paths are rescripted when the UI changes; the answers they must reach are not.
 */
export const questions: Question[] = [
  {
    text: 'Which tickers fired a signal today?',
    async ask(ui) {
      const sig = await ui.open('SIG');
      const day =
        (await sig.getByRole('row').first().getByRole('cell').first().textContent()) ?? '';
      await ui.see(sig.getByRole('row').filter({ hasText: day }));
    },
  },
  {
    text: 'What moved most, by change and by value?',
    async ask(ui) {
      const mov = await ui.open('MOV');
      await ui.press(mov, 'GAIN');
      await ui.see(top(body(mov.getByRole('table'))));
      await ui.press(mov, 'VALUE');
      await ui.see(top(body(mov.getByRole('table'))));
    },
  },
  {
    text: 'How are my pinned tickers doing?',
    async ask(ui) {
      const wl = await ui.open('WL');
      await ui.see(body(wl.getByRole('table')));
    },
  },
  {
    text: 'What did price and volume do over the period?',
    async ask(ui) {
      const gp = await ui.open('GP');
      await ui.see(gp.getByRole('img', { name: /^Price history/ }));
    },
  },
  {
    text: 'Who holds it, and who changed their holding?',
    async ask(ui) {
      const hds = await ui.open('HDS');
      await ui.see(hds.getByRole('region'));
    },
  },
  {
    text: 'Which brokers were net buyers and sellers?',
    async ask(ui) {
      const brk = await ui.open('BRK');
      await ui.see(
        top(body(brk.getByRole('table').first())),
        top(body(brk.getByRole('table').last())),
      );
    },
  },
  {
    text: 'Are the top brokers accumulating or distributing over time?',
    async ask(ui) {
      const bfl = await ui.open('BFL');
      await ui.see(bfl.locator('.flow-chart'));
    },
  },
  {
    text: 'Are foreigners buying or selling, and does price agree?',
    async ask(ui) {
      const ff = await ui.open('FF');
      const gp = await ui.open('GP');
      await ui.see(ff.locator('.flow-chart'), gp.getByRole('img', { name: /^Price history/ }));
    },
  },
  {
    text: "What were a day's largest orders, and their fills?",
    async ask(ui) {
      const dd = await ui.open('DD');
      await ui.press(dd, 'LOT');
      const orders = body(dd.getByRole('table'));
      await ui.see(top(orders));
      await ui.click(orders.first(), 'largest order');
      await ui.see(
        ui.page.getByLabel('Selected block summary'),
        ui.page.locator('.tick-tape tbody > tr[data-highlighted="true"]').first(),
      );
    },
  },
  {
    text: 'At which prices did volume trade, and what rested on the book at close?',
    async ask(ui) {
      const tb = await ui.open('TB');
      await ui.see(body(tb.getByRole('table')));
      const ob = await ui.open('OB');
      await ui.see(top(body(ob.getByRole('table'))));
    },
  },
  {
    text: 'What has the company disclosed?',
    async ask(ui) {
      const feed = await ui.open('FEED');
      await ui.see(top(feed.locator('[data-feed-kind="disclosure"]')));
    },
  },
  {
    text: 'What is its news, and which corporate action dates are coming?',
    async ask(ui) {
      const feed = await ui.open('FEED');
      // Preserve NEWS's frozen answer set, which ranks the original source date strings.
      const news = await Promise.all(
        (await feed.locator('[data-feed-kind="news"]').all()).map(async (row) => ({
          row,
          date: (await row.getAttribute('data-source-date')) ?? '',
        })),
      );
      news.sort((a, b) => b.date.localeCompare(a.date));
      await ui.see(
        ...(news.length
          ? news.slice(0, 10).map(({ row }) => row)
          : [feed.locator('[data-feed-empty="news"]')]),
      );
      await ui.see(
        feed.locator('[data-feed-kind="action"]').or(feed.locator('[data-feed-empty="action"]')),
      );
    },
  },
];
