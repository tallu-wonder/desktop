import { Repository, ILocalRepositoryState } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import {
  WorktreeEntry,
  getWorktreeDescription,
  getWorktreeDisplayName,
} from '../../models/worktree'
import { shortenSHA } from '../../models/commit'
import { IAheadBehind } from '../../models/branch'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import {
  groupRepositories,
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
} from '../repositories-list/group-repositories'

/** A repository row in the source control panel. */
export interface IScmRepositoryItem extends IFilterListItem {
  readonly kind: 'repository'
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly repository: Repositoryish
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
  /**
   * The ref the repository's **main** worktree is on: its branch name, or a
   * shortened SHA when that worktree's HEAD is detached. `null` until the
   * worktree list and status have loaded.
   *
   * Deliberately the main worktree rather than whatever worktree Desktop
   * currently has open: switching onto a linked worktree re-points
   * `repository.path` at it, and the repository row would otherwise report its
   * own child's branch.
   */
  readonly ref: string | null

  /** Whether `ref` is a shortened SHA rather than a branch name. */
  readonly refIsDetached: boolean

  readonly remoteName: string | null
  readonly hasUpstreamBranch: boolean

  /** The linked worktrees which are rendered as children of this row. */
  readonly linkedWorktrees: ReadonlyArray<WorktreeEntry>

  /**
   * The repository's main worktree, or `null` until the worktree list has
   * loaded. Activating the row switches back to it, so that the row does what
   * it says: a repository row stands for the main worktree, its children stand
   * for the linked ones.
   */
  readonly mainWorktree: WorktreeEntry | null

  /**
   * Whether the repository is currently sitting on its main worktree. False
   * when Desktop has switched onto one of the linked ones, which re-points
   * `repository.path` at that worktree.
   */
  readonly isOnMainWorktree: boolean

  /** Whether this row is currently expanded, showing its worktrees. */
  readonly isExpanded: boolean
}

/** A worktree row, nested underneath its repository. */
export interface IScmWorktreeItem extends IFilterListItem {
  readonly kind: 'worktree'
  readonly text: ReadonlyArray<string>
  readonly id: string

  /** The repository the worktree belongs to. */
  readonly parentRepository: Repository

  readonly worktree: WorktreeEntry

  /**
   * Whether this is the worktree its repository is currently switched onto,
   * i.e. the one `parentRepository.path` points at. That's the checkout the
   * repository's git operations act on, whether or not the repository is the
   * one selected in the app.
   */
  readonly isCurrentWorktree: boolean
}

export type ScmListItem = IScmRepositoryItem | IScmWorktreeItem

/**
 * The ids of the repositories that have at least one linked worktree, i.e. the
 * ones an expand-all can meaningfully act on.
 */
export function getExpandableRepositoryIds(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): ReadonlySet<number> {
  const ids = new Set<number>()

  for (const repo of repositories) {
    const state = localRepositoryStateLookup.get(repo.id) ?? emptyState

    if (describeWorktrees(repo, state).linkedWorktrees.length > 0) {
      ids.add(repo.id)
    }
  }

  return ids
}

/**
 * The repository a row's git operations should run against.
 *
 * A worktree row acts on behalf of its parent repository: fetch and push talk
 * to a remote through the one object store a repository and all of its
 * worktrees share, so which worktree git runs in makes no difference to the
 * result. Cloning repositories have no git directory yet, so they get no
 * actions at all.
 */
export const getActionRepository = (item: ScmListItem): Repository | null => {
  if (item.kind === 'worktree') {
    return item.parentRepository
  }

  return item.repository instanceof CloningRepository ? null : item.repository
}

/** The id used for a worktree row. Unique across the whole list. */
export const getWorktreeItemId = (
  repository: Repositoryish,
  worktree: WorktreeEntry
) => `${repository.id}:${worktree.path}`

const emptyState: ILocalRepositoryState = {
  aheadBehind: null,
  changedFilesCount: 0,
  currentBranch: null,
  currentTip: null,
  remoteName: null,
  hasUpstreamBranch: false,
  worktrees: [],
}

/**
 * Group the repositories the same way the repository list does and then splice
 * each repository's linked worktrees in underneath it as child rows.
 *
 * Expansion is asked for per repository rather than passed in as a set, so the
 * caller can answer "expanded unless collapsed by hand" and have a repository
 * that grows its first worktree later come up expanded on its own.
 *
 * Collapsed repositories contribute no child rows. While the user is filtering
 * every repository is treated as expanded so that a worktree can be found by
 * name even when its parent is collapsed.
 */
export function buildScmTree(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  isRepositoryExpanded: (repositoryId: number) => boolean,
  isFiltering: boolean
): ReadonlyArray<IFilterListGroup<ScmListItem, RepositoryListGroup>> {
  // No recent group: it duplicates repositories that are already listed under
  // their owner, which reads as noise in a list that's always on screen.
  const groups = groupRepositories(repositories, localRepositoryStateLookup, [])

  return groups.map(group => ({
    identifier: group.identifier,
    items: group.items.flatMap(item =>
      toRows(
        item,
        localRepositoryStateLookup,
        isRepositoryExpanded,
        isFiltering
      )
    ),
  }))
}

const normalizePath = (path: string) => path.replace(/[\\/]+$/, '')

/**
 * How a repository entry relates to the worktrees git lists for it.
 *
 * Normally the entry is the main worktree, or is the main worktree's entry
 * that Desktop has switched onto a linked one (which records
 * `mainWorktreePath`). Either way the row stands for the main worktree and the
 * linked ones nest underneath it.
 *
 * The exception is a linked worktree the user added as a repository of its
 * own: its path isn't the main worktree's and Desktop never switched it. That
 * entry stands for itself. It gets no children (its siblings belong under the
 * main repository's row), reports its own branch, and activating it must not
 * re-point it at the main worktree.
 */
const describeWorktrees = (
  repository: Repositoryish,
  state: ILocalRepositoryState
) => {
  const mainWorktree = state.worktrees.find(w => w.type === 'main')
  const isOnMainWorktree =
    mainWorktree === undefined ||
    normalizePath(repository.path) === normalizePath(mainWorktree.path)
  const wasSwitchedByDesktop =
    repository instanceof Repository &&
    repository.mainWorktreePath !== undefined

  if (!isOnMainWorktree && !wasSwitchedByDesktop) {
    return {
      mainWorktree: undefined,
      linkedWorktrees: [],
      isOnMainWorktree: true,
    }
  }

  return {
    mainWorktree,
    linkedWorktrees: state.worktrees.filter(w => w.type === 'linked'),
    isOnMainWorktree,
  }
}

/**
 * The ref to show on a repository's row. Prefers the main worktree entry,
 * which is correct even when Desktop is currently sitting on one of the
 * repository's linked worktrees, and falls back to the status we loaded from
 * whichever worktree that is until the worktree list arrives.
 */
const describeMainWorktree = (
  mainWorktree: WorktreeEntry | undefined,
  state: ILocalRepositoryState
) => {
  if (mainWorktree !== undefined) {
    return getWorktreeDescription(mainWorktree)
  }

  return (
    state.currentBranch ??
    (state.currentTip !== null ? shortenSHA(state.currentTip) : null)
  )
}

function toRows(
  item: IRepositoryListItem,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  isRepositoryExpanded: (repositoryId: number) => boolean,
  isFiltering: boolean
): ReadonlyArray<ScmListItem> {
  const { repository } = item
  const state = localRepositoryStateLookup.get(repository.id) ?? emptyState
  const { mainWorktree, linkedWorktrees, isOnMainWorktree } = describeWorktrees(
    repository,
    state
  )
  const isExpanded =
    linkedWorktrees.length > 0 &&
    (isFiltering || isRepositoryExpanded(repository.id))

  const repositoryRow: IScmRepositoryItem = {
    kind: 'repository',
    text: item.text,
    id: item.id,
    repository,
    needsDisambiguation: item.needsDisambiguation,
    aheadBehind: item.aheadBehind,
    changedFilesCount: item.changedFilesCount,
    ref: describeMainWorktree(mainWorktree, state),
    refIsDetached:
      mainWorktree !== undefined
        ? mainWorktree.isDetached
        : state.currentBranch === null && state.currentTip !== null,
    remoteName: state.remoteName,
    hasUpstreamBranch: state.hasUpstreamBranch,
    linkedWorktrees,
    mainWorktree: mainWorktree ?? null,
    isOnMainWorktree,
    isExpanded,
  }

  if (!isExpanded || !(repository instanceof Repository)) {
    return [repositoryRow]
  }

  const worktreeRows = linkedWorktrees.map<IScmWorktreeItem>(worktree => ({
    kind: 'worktree',
    text: [getWorktreeDisplayName(worktree), worktree.branch ?? worktree.head],
    id: getWorktreeItemId(repository, worktree),
    parentRepository: repository,
    worktree,
    isCurrentWorktree:
      normalizePath(repository.path) === normalizePath(worktree.path),
  }))

  return [repositoryRow, ...worktreeRows]
}
