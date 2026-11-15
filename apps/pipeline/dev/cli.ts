import { z } from 'zod';

/** Ends quietly when output is piped into `head`, and prints only the message of an error. */
export function cliErrors() {
  process.stdout.on('error', () => process.exit(0));
  // Exiting through process.exit runs the exit handlers that remove temporary checkouts and locks.
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => process.exit(signal === 'SIGINT' ? 130 : 143));
  process.on('uncaughtException', (error) => {
    console.error(error instanceof z.ZodError ? z.prettifyError(error) : error.message);
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
