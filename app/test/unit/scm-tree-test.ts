import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { WorktreeEntry } from '../../src/models/worktree'
import {
  buildScmTree,
  getExpandableRepositoryIds,
  ScmListItem,
} from '../../src/ui/scm-panel/scm-tree'

const worktree = (
  path: string,
  type: 'main' | 'linked',
  branch: string | null
): WorktreeEntry => ({
  path,
  head: '0123456789abcdef0123456789abcdef01234567',
  branch: branch === null ? null : `refs/heads/${branch}`,
  isDetached: branch === null,
  type,
  isLocked: false,
  isPrunable: false,
})

const stateFor = (
  worktrees: ReadonlyArray<WorktreeEntry>,
  currentBranch: string | null = 'main',
  aheadBehind: ILocalRepositoryState['aheadBehind'] = null,
  changedFilesCount = 0,
  worktreeStatus: ILocalRepositoryState['worktreeStatus'] = new Map()
): ILocalRepositoryState => ({
  worktreeStatus,
  aheadBehind,
  changedFilesCount,
  currentBranch,
  currentTip: '0123456789abcdef0123456789abcdef01234567',
  remoteName: 'origin',
  hasUpstreamBranch: true,
  worktrees,
})

const main = worktree('/repos/alpha', 'main', 'main')
const linked = worktree('/worktrees/alpha-feature', 'linked', 'feature')
const otherLinked = worktree('/worktrees/alpha-fix', 'linked', 'fix')

/** A repository entry, optionally one Desktop has switched onto a worktree. */
const repo = (path: string, id: number, mainWorktreePath?: string) =>
  new Repository(
    path,
    id,
    null,
    false,
    null,
    {},
    false,
    undefined,
    mainWorktreePath
  )

const rows = (
  repositories: ReadonlyArray<Repository>,
  lookup: ReadonlyMap<number, ILocalRepositoryState>,
  isExpanded: (id: number) => boolean = () => true,
  isFiltering = false
): ReadonlyArray<ScmListItem> =>
  buildScmTree(repositories, lookup, isExpanded, isFiltering).flatMap(
    g => g.items
  )

describe('source control panel tree', () => {
  it('nests linked worktrees under an expanded repository', () => {
    const alpha = repo('/repos/alpha', 1)
    const lookup = new Map([[1, stateFor([main, linked, otherLinked])]])

    const items = rows([alpha], lookup)

    assert.deepStrictEqual(
      items.map(i => i.kind),
      ['repository', 'worktree', 'worktree']
    )

    const [row] = items
    assert.ok(row.kind === 'repository')
    assert.equal(row.ref, 'main')
    assert.equal(row.isOnMainWorktree, true)
    assert.equal(row.isExpanded, true)
  })

  it('shows no children for a collapsed repository unless filtering', () => {
    const alpha = repo('/repos/alpha', 1)
    const lookup = new Map([[1, stateFor([main, linked])]])

    const collapsed = rows([alpha], lookup, () => false)
    assert.equal(collapsed.length, 1)
    assert.ok(collapsed[0].kind === 'repository')
    assert.equal(collapsed[0].isExpanded, false)
    assert.equal(collapsed[0].linkedWorktrees.length, 1)

    assert.equal(rows([alpha], lookup, () => false, true).length, 2)
  })

  it('never expands a repository without linked worktrees', () => {
    const alpha = repo('/repos/alpha', 1)
    const lookup = new Map([[1, stateFor([main])]])

    const [row] = rows([alpha], lookup)
    assert.ok(row.kind === 'repository')
    assert.equal(row.isExpanded, false)
    assert.equal(getExpandableRepositoryIds([alpha], lookup).size, 0)
  })

  it('keeps describing the main worktree while switched onto a linked one', () => {
    // Desktop re-points the repository at the worktree it switched onto, so
    // the status it loads is the worktree's.
    const alpha = repo(linked.path, 1, main.path)
    const lookup = new Map([
      [1, stateFor([main, linked, otherLinked], 'feature')],
    ])

    const [row, first, second] = rows([alpha], lookup)

    assert.ok(row.kind === 'repository')
    assert.equal(row.ref, 'main')
    assert.equal(row.isOnMainWorktree, false)
    assert.equal(row.mainWorktree, main)

    assert.ok(first.kind === 'worktree' && second.kind === 'worktree')
    assert.equal(first.isCurrentWorktree, true)
    assert.equal(second.isCurrentWorktree, false)
  })

  it('reports every worktree its own status, wherever the repository is', () => {
    const mainCounts = { ahead: 1, behind: 2 }
    const linkedCounts = { ahead: 11, behind: 8 }
    const otherCounts = { ahead: 0, behind: 5 }
    const worktrees = [main, linked, otherLinked]

    const expectRows = (items: ReadonlyArray<ScmListItem>) => {
      const [parent, first, second] = items
      assert.ok(parent.kind === 'repository')
      assert.deepStrictEqual(parent.aheadBehind, mainCounts)
      assert.equal(parent.changedFilesCount, 1)
      assert.deepStrictEqual(first.aheadBehind, linkedCounts)
      assert.equal(first.changedFilesCount, 3)
      assert.deepStrictEqual(second.aheadBehind, otherCounts)
      assert.equal(second.changedFilesCount, 0)
    }

    // On the main worktree: the repository's status is the main worktree's
    // and the linked ones come from the per-worktree statuses.
    expectRows(
      rows(
        [repo('/repos/alpha', 1)],
        new Map([
          [
            1,
            stateFor(
              worktrees,
              'main',
              mainCounts,
              1,
              new Map([
                [
                  linked.path,
                  { aheadBehind: linkedCounts, changedFilesCount: 3 },
                ],
                [
                  otherLinked.path,
                  { aheadBehind: otherCounts, changedFilesCount: 0 },
                ],
              ])
            ),
          ],
        ])
      )
    )

    // Switched onto a linked worktree: the repository's status is now that
    // worktree's, and the main worktree's is one of the separate ones.
    expectRows(
      rows(
        [repo(linked.path, 1, main.path)],
        new Map([
          [
            1,
            stateFor(
              worktrees,
              'feature',
              linkedCounts,
              3,
              new Map([
                [main.path, { aheadBehind: mainCounts, changedFilesCount: 1 }],
                [
                  otherLinked.path,
                  { aheadBehind: otherCounts, changedFilesCount: 0 },
                ],
              ])
            ),
          ],
        ])
      )
    )
  })

  it('shows nothing for a worktree whose status has not loaded', () => {
    const [, child] = rows(
      [repo('/repos/alpha', 1)],
      new Map([[1, stateFor([main, linked], 'main', { ahead: 1, behind: 0 })]])
    )

    assert.ok(child.kind === 'worktree')
    assert.equal(child.aheadBehind, null)
    assert.equal(child.changedFilesCount, 0)
  })

  it('marks no worktree as current while on the main worktree', () => {
    const alpha = repo('/repos/alpha', 1)
    const lookup = new Map([[1, stateFor([main, linked])]])

    const [, child] = rows([alpha], lookup)
    assert.ok(child.kind === 'worktree')
    assert.equal(child.isCurrentWorktree, false)
  })

  it('treats a linked worktree added as its own repository as a plain row', () => {
    // Added directly by the user: its path is a linked worktree's, but
    // Desktop never switched it there, so no main worktree path is recorded.
    const standalone = repo(linked.path, 2)
    const lookup = new Map([[2, stateFor([main, linked], 'feature')]])

    const items = rows([standalone], lookup)
    assert.equal(items.length, 1)

    const [row] = items
    assert.ok(row.kind === 'repository')
    assert.equal(row.ref, 'feature')
    assert.equal(row.isOnMainWorktree, true)
    assert.equal(row.mainWorktree, null)
    assert.equal(row.linkedWorktrees.length, 0)
    assert.equal(getExpandableRepositoryIds([standalone], lookup).size, 0)
  })

  it('falls back to the loaded status until the worktree list arrives', () => {
    const alpha = repo('/repos/alpha', 1)

    const [onBranch] = rows([alpha], new Map([[1, stateFor([], 'topic')]]))
    assert.ok(onBranch.kind === 'repository')
    assert.equal(onBranch.ref, 'topic')
    assert.equal(onBranch.refIsDetached, false)

    const [detached] = rows([alpha], new Map([[1, stateFor([], null)]]))
    assert.ok(detached.kind === 'repository')
    assert.equal(detached.refIsDetached, true)

    const [unloaded] = rows([alpha], new Map())
    assert.ok(unloaded.kind === 'repository')
    assert.equal(unloaded.ref, null)
  })

  it('lists the repositories an expand-all can act on', () => {
    const alpha = repo('/repos/alpha', 1)
    const bravo = repo('/repos/bravo', 2)
    const lookup = new Map([
      [1, stateFor([main, linked])],
      [2, stateFor([worktree('/repos/bravo', 'main', 'main')])],
    ])

    assert.deepStrictEqual(
      [...getExpandableRepositoryIds([alpha, bravo], lookup)],
      [1]
    )
  })
})
