import { describe, expect, it } from 'vite-plus/test';
import { edgeFills } from './BrokerFlow';

const fill = (code: string, avg: number, amount: number) => ({ code, avg, amount });
const small = (prefix: string, avg: number) =>
  Array.from({ length: 18 }, (_, i) => fill(`${prefix}${i}`, avg, 10));
const codes = (set: Set<{ code: string }>) => [...set].map((f) => f.code).sort();

describe('edgeFills', () => {
  it('flags leading buyers in the bottom quarter and leading sellers in the top quarter', () => {
    const buyers = [fill('DH', 650, 900), fill('AK', 670, 800), ...small('b', 600)];
    const sellers = [fill('KI', 690, 900), fill('DX', 681, 800), ...small('s', 760)];
    expect(codes(edgeFills(buyers, sellers))).toEqual(['DH', 'DX', 'KI']);
  });
  it('ignores brokers outside the top 10% by value however extreme their price', () => {
    const buyers = [fill('DH', 720, 34800), fill('XL', 725, 18100), ...small('b', 690)];
    const sellers = [fill('AK', 731, 20600), fill('CC', 721, 19300), ...small('s', 750)];
    expect(codes(edgeFills(buyers, sellers))).toEqual(['AK', 'DH']);
  });
  it('flags nothing when every leader shares one price', () => {
    expect(edgeFills([fill('DH', 100, 5)], [fill('KI', 100, 5)]).size).toBe(0);
  });
});
