/**
 * Single source of truth for the git identity DEVROOM uses on every commit
 * it makes on behalf of the Commander — battlefield init commits, mission
 * worktree local config, and the auto-sweep fallback commit.
 *
 * Reads `DEVROOM_GIT_USER` / `DEVROOM_GIT_EMAIL` from the environment with
 * sensible defaults so a fresh checkout still has a coherent author.
 */
export interface GitIdentity {
  name: string;
  email: string;
}

export function getGitIdentity(): GitIdentity {
  const name = process.env.DEVROOM_GIT_USER?.trim();
  const email = process.env.DEVROOM_GIT_EMAIL?.trim();
  return {
    name: name && name.length > 0 ? name : 'DEVROOM @ Nyhz',
    email: email && email.length > 0 ? email : 'nyhz@devroom.local',
  };
}
