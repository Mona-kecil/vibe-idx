import { expect, it } from 'vite-plus/test';
import { aggregateBrokers } from './broker-data';
import { brokerDaySchema, investorFilter } from './brokers';

const amounts = { broker: 'XL', shares: 100, value: 1000, avg_price: 999, freq: 1 };
const domestic = { ...amounts, investor: 'domestic', broker_type: 'foreign' };
const foreign = {
  ...amounts,
  investor: 'foreign',
  broker_type: 'foreign',
  shares: 300,
  value: 6000,
};
const day = brokerDaySchema.parse({
  date: '2026-11-09',
  board: 'regular',
  buy: [domestic, foreign],
  sell: [foreign],
});

it('filters client domicile before merging brokers and derives averages from total value and shares', () => {
  const all = aggregateBrokers([day]);
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({
    broker_type: 'foreign',
    buy: 400,
    buyValue: 7000,
    sell: 300,
    sellValue: 6000,
    buyAvg: 17.5,
    sellAvg: 20,
  });
  expect(aggregateBrokers([day], 'FOREIGN')[0]).toMatchObject({ buy: 300, buyValue: 6000 });
  expect(aggregateBrokers([day], 'DOMESTIC')[0]).toMatchObject({
    buy: 100,
    buyValue: 1000,
    sell: 0,
  });
});

it('falls back to ALL for obsolete persisted ownership filters', () => {
  for (const source of ['LOCAL', 'GOV', null, undefined]) {
    expect(investorFilter(source)).toBe('ALL');
    expect(aggregateBrokers([day], investorFilter(source))).toEqual(aggregateBrokers([day]));
  }
  expect(investorFilter('DOMESTIC')).toBe('DOMESTIC');
  expect(investorFilter('FOREIGN')).toBe('FOREIGN');
});
