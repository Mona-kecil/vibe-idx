import { describe, expect, it } from 'vite-plus/test';
import { edgeFills } from './BrokerFlow';

const fill = (code: string, avg: number, volume: number) => ({ code, avg, volume });
const codes = (set: Set<{ code: string }>) => [...set].map((f) => f.code).sort();

describe('edgeFills', () => {
  it('flags buyers in the bottom quarter and sellers in the top quarter of the traded range', () => {
    const buyers = [fill('DH', 650, 100), fill('AK', 670, 100), fill('BK', 659, 100)];
    const sellers = [fill('KI', 690, 100), fill('YU', 660, 100), fill('DX', 681, 100)];
    expect(codes(edgeFills(buyers, sellers))).toEqual(['BK', 'DH', 'DX', 'KI']);
  });
  it('ignores a thin trade outside where the volume traded', () => {
    const buyers = [fill('DH', 650, 1000), fill('AK', 740, 1), fill('BK', 659, 1000)];
    const sellers = [fill('KI', 690, 1000), fill('DX', 681, 1000), fill('CC', 670, 1000)];
    expect(codes(edgeFills(buyers, sellers))).toEqual(['BK', 'DH', 'DX', 'KI']);
  });
  it('lets a near-flat net buyer count only by its net volume', () => {
    const buyers = [fill('DH', 650, 1000), fill('AK', 640, 10)];
    const sellers = [fill('KI', 690, 1000), fill('CC', 670, 1000)];
    expect(codes(edgeFills(buyers, sellers))).toEqual(['DH', 'KI']);
  });
  it('flags nothing when every fill shares one price', () => {
    expect(edgeFills([fill('DH', 100, 5)], [fill('KI', 100, 5)]).size).toBe(0);
  });
});
