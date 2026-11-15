import { z } from 'zod';

/** Ends quietly when output is piped into `head`, and prints only the message of an error. */
export function cliErrors() {
  process.stdout.on('error', () => process.exit(0));
  process.on('uncaughtException', (error) => {
    console.error(error instanceof z.ZodError ? z.prettifyError(error) : error.message);
    process.exit(1);
  });
}

export const plural = (count: number, noun: string) =>
  `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
