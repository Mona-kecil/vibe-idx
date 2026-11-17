import { existsSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/** Ends quietly when output is piped into `head`, and prints only the message of an error. */
export function cliErrors() {
  process.stdout.on('error', () => process.exit(0));
  // Exiting through process.exit runs the exit handlers that remove temporary checkouts and locks.
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => process.exit(signal === 'SIGINT' ? 130 : 143));
  process.on('uncaughtException', (error) => {
    console.error(
      error instanceof z.ZodError
        ? z.prettifyError(error)
        : (diskFull(error, freeAt) ?? error.message),
    );
    process.exit(1);
  });
}

export const plural = (count: number, noun: string) =>
  `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;

export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type SystemError = Error & { code?: string; errno?: number; path?: string };

/** Bytes free on the disk holding `path`, or its nearest existing folder. */
function freeAt(path: string) {
  let at = path;
  while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
  const stats = statfsSync(at);
  return stats.bavail * stats.bsize;
}

/**
 * A plain message for running out of disk space or quota, which otherwise surfaces as a bare errno such as -122 or a
 * database's IO error. Undefined for any other error.
 */
export function diskFull(error: SystemError, free?: (path: string) => number) {
  const full =
    ['ENOSPC', 'EDQUOT'].includes(error.code ?? '') ||
    [-28, -122].includes(error.errno ?? 0) ||
    /no space left|quota exceeded|write error -(28|122)\b/i.test(error.message);
  if (!full) return undefined;
  const path = error.path ?? /"(\/[^"]+)"/.exec(error.message)?.[1];
  let room = '';
  try {
    if (path && free)
      room = `, with ${Math.round(free(path) / 2 ** 20).toLocaleString('en')} MB free there`;
  } catch {
    // The free space is a courtesy; the message stands without it.
  }
  return `Out of disk space${path ? ` writing ${path}` : ''}${room}. Free some space there, or point VIBE_IDX_FIXTURES at a disk with room: a fixture build writes about 1 GB.`;
}
