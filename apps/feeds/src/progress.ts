import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/** Jakarta dates, both ends included. */
export type Window = { from: string; to: string };

const dayMs = 24 * 3600e3;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The parts of `wanted` that no window of `covered` spans, oldest first. */
export function gaps(wanted: Window, covered: Window[]): Window[] {
  const out: Window[] = [];
  let from = at(wanted.from);
  const end = at(wanted.to);
  for (const range of [...covered].sort((a, b) => a.from.localeCompare(b.from))) {
    if (at(range.to) < from) continue;
    if (at(range.from) > end) break;
    if (at(range.from) > from) out.push({ from: day(from), to: day(at(range.from) - dayMs) });
    from = Math.max(from, at(range.to) + dayMs);
  }
  if (from <= end) out.push({ from: day(from), to: wanted.to });
  return out;
}

/** `covered` with `added` in it, touching windows joined. */
export function cover(covered: Window[], added: Window): Window[] {
  const merged: Window[] = [];
  for (const range of [...covered, added].sort((a, b) => a.from.localeCompare(b.from))) {
    const last = merged.at(-1);
    if (last && at(range.from) <= at(last.to) + dayMs)
      last.to = range.to > last.to ? range.to : last.to;
    else merged.push({ ...range });
  }
  return merged;
}

/** What a backfill has finished, by ticker: the dates it asked Google about and the archive took. */
export type Progress = Record<string, Window[]>;

const windowSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
const fileSchema = z.object({
  version: z.literal(1),
  destinations: z.record(z.string(), z.record(z.string(), z.array(windowSchema))),
});

async function readFileProgress(file: string) {
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) return { version: 1 as const, destinations: {} };
  try {
    return fileSchema.parse(JSON.parse(text));
  } catch (failure) {
    throw new Error(
      `${file} is not a readable progress file (${failure instanceof Error ? failure.message.split('\n')[0] : 'unknown'}). Delete it, or pass --restart to forget the progress saved for this destination and start over.`,
      { cause: failure },
    );
  }
}

/** The progress saved for `destination`, an empty one when there is none or `restart` forgets it. */
export async function loadProgress(file: string, destination: string, restart = false) {
  if (restart) return {};
  return (await readFileProgress(file)).destinations[destination] ?? {};
}

/** Saves the progress of `destination` whole, through a temporary file renamed over the old one. */
export async function saveProgress(
  file: string,
  destination: string,
  progress: Progress,
  restart = false,
) {
  const saved = await readFileProgress(file).catch((failure: unknown) => {
    if (restart) return { version: 1 as const, destinations: {} };
    throw failure;
  });
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    partial,
    JSON.stringify({ ...saved, destinations: { ...saved.destinations, [destination]: progress } }),
  );
  await rename(partial, file);
}
