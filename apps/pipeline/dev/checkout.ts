import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { alive } from './cli';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: import.meta.dirname,
})
  .toString()
  .trim();

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const prefix = join(tmpdir(), 'vibe-idx-base-');

const worktrees = () =>
  git('worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));

/** Removes temporary checkouts whose process is gone, such as one killed before it could clean up. */
function removeOrphans() {
  for (const dir of worktrees()) {
    const pid = dir.startsWith(prefix) ? Number(/-(\d+)$/.exec(dir)?.[1]) : 0;
    if (pid && !alive(pid)) git('worktree', 'remove', '--force', dir);
  }
}

/**
 * A detached checkout of `ref` in a temporary folder that borrows this checkout's installed packages. Each
 * process gets its own, removed when the process exits, so tools running at once never share one.
 */
export async function checkout(ref: string) {
  const sha = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  removeOrphans();
  const dir = `${prefix}${sha.slice(0, 12)}-${process.pid}`;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    if (existsSync(dir)) git('worktree', 'remove', '--force', dir);
  };
  process.once('exit', remove);
  git('worktree', 'add', '--detach', '--quiet', dir, sha);
  for (const modules of ['node_modules', 'apps/web/node_modules', 'apps/pipeline/node_modules'])
    if (existsSync(join(repoRoot, modules)))
      await symlink(join(repoRoot, modules), join(dir, modules));
  return { dir, label: `${ref} (${sha.slice(0, 7)})`, remove };
}

/** Fails for a path inside any checkout of the repository: screenshots can show private broker data. */
export function outsideRepo(path: string) {
  const full = resolve(process.env.INIT_CWD ?? '.', path);
  const within = (dir: string) => {
    const rest = relative(dir, full);
    return !rest.startsWith('..') && !isAbsolute(rest);
  };
  if (worktrees().some(within))
    throw new Error(
      `${full} is inside the repository, and screenshots can show private broker data. Write them outside it, such as under /tmp.`,
    );
  return full;
}
