import * as Path from 'path'
import { shortenSHA } from './commit'
import type { IAheadBehind } from './branch'

export type WorktreeType = 'main' | 'linked'

export type WorktreeEntry = {
  readonly path: string
  readonly head: string
  /** Full ref name (e.g. `refs/heads/main`), or `null` when HEAD is detached */
  readonly branch: string | null
  readonly isDetached: boolean
  readonly type: WorktreeType
  readonly isLocked: boolean
  readonly isPrunable: boolean
}

/** The display name for a worktree (the basename of its path). */
export function getWorktreeDisplayName(worktree: WorktreeEntry): string {
  return Path.basename(worktree.path)
}

/**
 * The display description for a worktree: its branch name (without the
 * `refs/heads/` prefix) or a shortened HEAD SHA when HEAD is detached.
 */
export function getWorktreeDescription(worktree: WorktreeEntry): string {
  return worktree.branch
    ? worktree.branch.replace(/^refs\/heads\//, '')
    : shortenSHA(worktree.head)
}

/**
 * What a `git status` of one worktree says about its checked out branch: how
 * far it is from its upstream and how many uncommitted changes it holds.
 */
export interface IWorktreeStatusSummary {
  /** `null` when the branch has no upstream (or HEAD is detached). */
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
}
