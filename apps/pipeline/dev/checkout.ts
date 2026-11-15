import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: import.meta.dirname,
})
  .toString()
  .trim();

/** A detached checkout of `ref` in a temporary folder that borrows this checkout's installed packages. */
export async function checkout(ref: string) {
  const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoRoot })
    .toString()
    .trim();
  const dir = join(tmpdir(), `vibe-idx-base-${sha.slice(0, 12)}`);
  if (!existsSync(dir)) {
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, sha], { cwd: repoRoot });
    for (const modules of ['node_modules', 'apps/web/node_modules', 'apps/pipeline/node_modules'])
      if (existsSync(join(repoRoot, modules)))
        await symlink(join(repoRoot, modules), join(dir, modules));
  }
  return {
    dir,
    label: `${ref} (${sha.slice(0, 7)})`,
    remove: () => execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repoRoot }),
  };
}
