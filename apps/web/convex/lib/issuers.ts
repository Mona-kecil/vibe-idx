import { z } from 'zod';
const company = z.object({
  KodeEmiten: z.string(),
  NamaEmiten: z.string(),
  PapanPencatatan: z.string(),
  Sektor: z.string().nullish(),
  SubSektor: z.string().nullish(),
  Industri: z.string().nullish(),
  SubIndustri: z.string().nullish(),
});
export function parseIssuers(input: unknown, updatedAt: number) {
  const response = z.object({ recordsTotal: z.number(), data: z.array(company) }).parse(input);
  if (response.recordsTotal !== response.data.length) throw new Error('Incomplete issuer list');
  return response.data.map((r) => ({
    ticker: r.KodeEmiten.trim(),
    name: r.NamaEmiten,
    board: r.PapanPencatatan,
    sector: r.Sektor ?? undefined,
    subSector: r.SubSektor ?? undefined,
    industry: r.Industri ?? undefined,
    subIndustry: r.SubIndustri ?? undefined,
    updatedAt,
  }));
}
