import * as React from 'react'

import { ILocalRepositoryState, Repository } from '../../models/repository'
import { PopupType } from '../../models/popup'
import { IMatches } from '../../lib/fuzzy-find'
import {
  getBoolean,
  getNumberArray,
  setBoolean,
  setNumberArray,
} from '../../lib/local-storage'
import { showContextualMenu, IMenuItem } from '../../lib/menu-item'
import { assertNever } from '../../lib/fatal-error'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { SectionFilterList } from '../lib/section-filter-list'
import { TooltippedContent } from '../lib/tooltipped-content'
import {
  getGroupKey,
  Repositoryish,
  RepositoryListGroup,
} from '../repositories-list/group-repositories'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { generateWorktreeContextMenuItems } from '../worktrees/worktree-list-item-context-menu'
import {
  buildScmTree,
  getActionRepository,
  getExpandableRepositoryIds,
  IScmRepositoryItem,
  ScmListItem,
} from './scm-tree'
import { ScmRow, ScmRowOperation } from './scm-row'

const RowHeight = 29

/**
 * Expansion is remembered between sessions in one of two shapes.
 *
 * `expandAll` is a mode rather than a snapshot: while it's set, every
 * repository that has worktrees shows them, including repositories that only
 * grow their first worktree later. Individual repositories collapsed by hand
 * are kept as exceptions to it.
 *
 * With the mode off, the expanded repositories are listed explicitly.
 */
const expandAllKey = 'scm-panel-expand-all-worktrees'
const expandedRepositoriesKey = 'scm-panel-expanded-repositories'
const collapsedRepositoriesKey = 'scm-panel-collapsed-repositories'

interface IScmPanelProps {
  readonly dispatcher: Dispatcher

  readonly repositories: ReadonlyArray<Repositoryish>
  readonly selectedRepository: Repositoryish | null
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >

  /** Whether the user has enabled the setting to confirm removing a repository */
  readonly askForConfirmationOnRemoveRepository: boolean

  readonly onRemoveRepository: (repository: Repositoryish) => void
  readonly onShowRepository: (repository: Repositoryish) => void
  readonly onViewOnGitHub: (repository: Repositoryish) => void
  readonly onOpenInShell: (repository: Repositoryish) => void
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell */
  readonly shellLabel?: string

  /** Called when the panel's close button is activated */
  readonly onHidePanel: () => void
}

interface IScmPanelState {
  readonly filterText: string
  /** Whether every repository with worktrees is expanded by default. */
  readonly expandAll: boolean

  /** Expanded repositories, used when `expandAll` is off. */
  readonly expandedRepositoryIds: ReadonlySet<number>

  /** Repositories collapsed by hand, used when `expandAll` is on. */
  readonly collapsedRepositoryIds: ReadonlySet<number>
  readonly selectedItem: ScmListItem | null

  /** The git operation currently running, keyed by row id */
  readonly operations: ReadonlyMap<string, ScmRowOperation>
}

/**
 * A persistent panel listing every repository the user has added, with each
 * repository's linked worktrees nested underneath it.
 *
 * Unlike the repository dropdown in the toolbar this list stays open when a
 * repository is selected, and its rows can act on repositories other than the
 * currently selected one.
 */
export class ScmPanel extends React.Component<IScmPanelProps, IScmPanelState> {
  public constructor(props: IScmPanelProps) {
    super(props)

    this.state = {
      filterText: '',
      expandAll: getBoolean(expandAllKey, false),
      expandedRepositoryIds: new Set(getNumberArray(expandedRepositoriesKey)),
      collapsedRepositoryIds: new Set(getNumberArray(collapsedRepositoriesKey)),
      selectedItem: null,
      operations: new Map(),
    }
  }

  public componentDidUpdate(prevProps: IScmPanelProps) {
    // `state.selectedItem` is the list's own (keyboard) selection and wins
    // over the app's selected repository while it's set. The repository
    // dropdown this is modelled on gets away with never clearing it because it
    // unmounts when it closes; this panel doesn't, so drop it whenever the
    // app's selection moves - a repository was added, removed, or switched to
    // another worktree - or the highlight would stay on the old row for good.
    const prev = prevProps.selectedRepository
    const next = this.props.selectedRepository

    if (
      this.state.selectedItem !== null &&
      (prev?.id !== next?.id || prev?.path !== next?.path)
    ) {
      this.setState({ selectedItem: null })
    }
  }

  public render() {
    // Not memoized: `localRepositoryStateLookup` is mutated in place by the
    // app store, so comparing it by reference would keep us on a stale tree.
    const groups = buildScmTree(
      this.props.repositories,
      this.props.localRepositoryStateLookup,
      this.isExpanded,
      this.state.filterText.length > 0
    )

    const selectedItem =
      this.state.selectedItem ??
      findSelectedItem(groups, this.props.selectedRepository)

    return (
      <div id="scm-panel">
        <div className="scm-panel-header">
          <h2 className="scm-panel-title">Repositories</h2>
          {this.renderExpandCollapseAllButton()}
          <Button
            className="scm-panel-header-button"
            ariaLabel="Hide the source control panel"
            tooltip="Hide the source control panel"
            onClick={this.props.onHidePanel}
          >
            <Octicon symbol={octicons.sidebarCollapse} />
          </Button>
        </div>
        <SectionFilterList<ScmListItem, RepositoryListGroup>
          rowHeight={RowHeight}
          selectedItem={selectedItem}
          filterText={this.state.filterText}
          onFilterTextChanged={this.onFilterTextChanged}
          renderItem={this.renderItem}
          renderGroupHeader={this.renderGroupHeader}
          onItemClick={this.onItemClick}
          onItemKeyDown={this.onRowKeyDown}
          onItemContextMenu={this.onItemContextMenu}
          onSelectionChanged={this.onSelectionChanged}
          renderPostFilter={this.renderPostFilter}
          renderNoItems={this.renderNoItems}
          groups={groups}
          invalidationProps={{
            repositories: this.props.repositories,
            localRepositoryStateLookup: this.props.localRepositoryStateLookup,
            expandAll: this.state.expandAll,
            expandedRepositoryIds: this.state.expandedRepositoryIds,
            collapsedRepositoryIds: this.state.collapsedRepositoryIds,
            operations: this.state.operations,
            filterText: this.state.filterText,
          }}
          getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
        />
      </div>
    )
  }

  private renderItem = (item: ScmListItem, matches: IMatches) => (
    <ScmRow
      key={item.id}
      item={item}
      matches={matches}
      onToggleExpanded={this.onToggleExpanded}
      onPull={this.onPull}
      onPush={this.onPush}
      onOverflowMenu={this.onOverflowMenu}
      operation={this.state.operations.get(item.id) ?? null}
    />
  )

  private getGroupLabel(group: RepositoryListGroup) {
    const { kind } = group
    if (kind === 'enterprise') {
      return group.host
    } else if (kind === 'other') {
      return 'Other'
    } else if (kind === 'dotcom') {
      return group.owner.login
    } else if (kind === 'recent') {
      return 'Recent'
    } else {
      return assertNever(kind, `Unknown repository group kind ${kind}`)
    }
  }

  private renderGroupHeader = (group: RepositoryListGroup) => {
    const label = this.getGroupLabel(group)

    return (
      <TooltippedContent
        key={getGroupKey(group)}
        className="filter-list-group-header"
        tooltip={label}
        onlyWhenOverflowed={true}
        tagName="div"
      >
        {label}
      </TooltippedContent>
    )
  }

  private renderPostFilter = () => (
    <Button
      className="new-repository-button"
      ariaLabel="Add a repository"
      onClick={this.onAddRepositoryClick}
    >
      Add
      <Octicon symbol={octicons.triangleDown} />
    </Button>
  )

  private renderNoItems = () => (
    <div className="no-items no-results-found">
      {this.props.repositories.length === 0
        ? 'No repositories yet'
        : "Sorry, I can't find that repository"}
    </div>
  )

  // NOTE: deliberately no `getItemAriaLabel`. Supplying one makes the list
  // wrap the row's contents in an `aria-hidden` element, which would hide this
  // panel's per-row action buttons from assistive technology.

  private getGroupAriaLabelGetter =
    (groups: ReadonlyArray<{ identifier: RepositoryListGroup }>) =>
    (group: number) =>
      this.getGroupLabel(groups[group].identifier)

  private onFilterTextChanged = (filterText: string) =>
    this.setState({ filterText })

  private onSelectionChanged = (selectedItem: ScmListItem | null) =>
    this.setState({ selectedItem })

  private onItemClick = (item: ScmListItem) => {
    if (item.kind === 'repository') {
      const hasIndicator =
        item.changedFilesCount > 0 ||
        (item.aheadBehind?.ahead ?? 0) > 0 ||
        (item.aheadBehind?.behind ?? 0) > 0

      this.props.dispatcher.recordRepoClicked(hasIndicator)

      // A repository row stands for the main worktree, so activating it has to
      // switch back to that worktree when Desktop is sitting on one of the
      // linked ones. Selecting the repository alone would just re-open
      // whichever worktree its path currently points at.
      if (
        !item.isOnMainWorktree &&
        item.mainWorktree !== null &&
        item.repository instanceof Repository
      ) {
        this.props.dispatcher.switchWorktree(item.repository, item.mainWorktree)
      } else {
        this.props.dispatcher.selectRepository(item.repository)
      }
    } else {
      this.props.dispatcher.switchWorktree(item.parentRepository, item.worktree)
    }
  }

  /** Left/right arrows collapse and expand a repository's worktrees. */
  private onRowKeyDown = (
    item: ScmListItem,
    event: React.KeyboardEvent<any>
  ) => {
    if (item.kind !== 'repository' || item.linkedWorktrees.length === 0) {
      return
    }

    if (event.key === 'ArrowRight' && !item.isExpanded) {
      event.preventDefault()
      this.setExpanded(item.repository.id, true)
    } else if (event.key === 'ArrowLeft' && item.isExpanded) {
      event.preventDefault()
      this.setExpanded(item.repository.id, false)
    }
  }

  private onToggleExpanded = (item: IScmRepositoryItem) =>
    this.setExpanded(item.repository.id, !item.isExpanded)

  /**
   * Whether a repository's worktrees are shown. In expand-all mode that's
   * everything except the repositories collapsed by hand, so a repository
   * whose first worktree appears later is expanded without being asked.
   */
  private isExpanded = (repositoryId: number) =>
    this.state.expandAll
      ? !this.state.collapsedRepositoryIds.has(repositoryId)
      : this.state.expandedRepositoryIds.has(repositoryId)

  private setExpanded = (repositoryId: number, expanded: boolean) => {
    if (this.state.expandAll) {
      // Stay in expand-all mode and record the repository as an exception,
      // rather than dropping the mode and freezing today's worktree layout.
      const collapsedRepositoryIds = new Set(this.state.collapsedRepositoryIds)

      if (expanded) {
        collapsedRepositoryIds.delete(repositoryId)
      } else {
        collapsedRepositoryIds.add(repositoryId)
      }

      setNumberArray(collapsedRepositoriesKey, [...collapsedRepositoryIds])
      this.setState({ collapsedRepositoryIds })
      return
    }

    const expandedRepositoryIds = new Set(this.state.expandedRepositoryIds)

    if (expanded) {
      expandedRepositoryIds.add(repositoryId)
    } else {
      expandedRepositoryIds.delete(repositoryId)
    }

    setNumberArray(expandedRepositoriesKey, [...expandedRepositoryIds])
    this.setState({ expandedRepositoryIds })
  }

  /**
   * Expand-all and collapse-all share a button: it offers whichever of the two
   * would actually change something. It's only enabled when some repository
   * has worktrees to show in the first place.
   */
  private renderExpandCollapseAllButton() {
    const expandable = getExpandableRepositoryIds(
      this.props.repositories,
      this.props.localRepositoryStateLookup
    )
    const anyExpanded = [...expandable].some(this.isExpanded)
    const label = anyExpanded
      ? 'Collapse all worktrees'
      : 'Expand all worktrees'

    return (
      <Button
        className="scm-panel-header-button"
        ariaLabel={label}
        tooltip={label}
        disabled={expandable.size === 0}
        onClick={anyExpanded ? this.onCollapseAll : this.onExpandAll}
      >
        <Octicon symbol={anyExpanded ? octicons.fold : octicons.unfold} />
      </Button>
    )
  }

  private onCollapseAll = () => {
    setBoolean(expandAllKey, false)
    setNumberArray(expandedRepositoriesKey, [])
    setNumberArray(collapsedRepositoriesKey, [])

    this.setState({
      expandAll: false,
      expandedRepositoryIds: new Set<number>(),
      collapsedRepositoryIds: new Set<number>(),
    })
  }

  /**
   * Turns expand-all on as a mode instead of writing down the repositories
   * that happen to have worktrees right now, so a repository that gains its
   * first worktree later comes up expanded too.
   */
  private onExpandAll = () => {
    setBoolean(expandAllKey, true)
    setNumberArray(collapsedRepositoriesKey, [])

    this.setState({
      expandAll: true,
      collapsedRepositoryIds: new Set<number>(),
    })
  }

  private onPull = (item: ScmListItem) => {
    const repository = getActionRepository(item)

    if (repository !== null) {
      this.runOperation(item.id, 'pull', async () =>
        this.props.dispatcher.pull(
          await this.props.dispatcher.prepareForScmPanelOperation(repository)
        )
      )
    }
  }

  private onPush = (item: ScmListItem) => {
    const repository = getActionRepository(item)

    if (repository === null) {
      return
    }

    if (item.kind === 'repository' && item.remoteName === null) {
      this.props.dispatcher.showPopup({
        type: PopupType.PublishRepository,
        repository,
      })
      return
    }

    this.runOperation(item.id, 'push', async () =>
      this.props.dispatcher.push(
        await this.props.dispatcher.prepareForScmPanelOperation(repository)
      )
    )
  }

  /**
   * Run a git operation on behalf of a row, showing progress on that row and
   * that row only. A fetch reaches the whole repository (one object store is
   * shared by a repository and all of its worktrees), but spinning every
   * related row made it look like the wrong worktree was being fetched.
   */
  private runOperation = async (
    rowId: string,
    operation: ScmRowOperation,
    run: () => Promise<void>
  ) => {
    this.setOperation(rowId, operation)

    try {
      await run()
    } finally {
      this.setOperation(rowId, null)
    }
  }

  private setOperation = (rowId: string, operation: ScmRowOperation | null) =>
    this.setState(prevState => {
      const operations = new Map(prevState.operations)

      if (operation === null) {
        operations.delete(rowId)
      } else {
        operations.set(rowId, operation)
      }

      return { operations }
    })

  private onOverflowMenu = (
    item: ScmListItem,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    showContextualMenu(this.getContextMenuItems(item))
  }

  private onItemContextMenu = (
    item: ScmListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    showContextualMenu(this.getContextMenuItems(item))
  }

  private getContextMenuItems = (
    item: ScmListItem
  ): ReadonlyArray<IMenuItem> => {
    if (item.kind === 'worktree') {
      return generateWorktreeContextMenuItems({
        path: item.worktree.path,
        isMainWorktree: item.worktree.type === 'main',
        isLocked: item.worktree.isLocked,
        onRenameWorktree: this.onRenameWorktree(item.parentRepository),
        onRemoveWorktree: this.onRemoveWorktree(item.parentRepository),
      })
    }

    return generateRepositoryListContextMenu({
      repository: item.repository,
      shellLabel: this.props.shellLabel,
      externalEditorLabel: this.props.externalEditorLabel,
      askForConfirmationOnRemoveRepository:
        this.props.askForConfirmationOnRemoveRepository,
      onViewOnGitHub: this.props.onViewOnGitHub,
      onOpenInShell: this.props.onOpenInShell,
      onShowRepository: this.props.onShowRepository,
      onOpenInExternalEditor: this.props.onOpenInExternalEditor,
      onRemoveRepository: this.props.onRemoveRepository,
      onChangeRepositoryAlias: this.onChangeRepositoryAlias,
      onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
      onCreateWorktree: this.onCreateWorktree,
    })
  }

  private onRenameWorktree =
    (repository: Repository) => (worktreePath: string) =>
      this.props.dispatcher.showPopup({
        type: PopupType.RenameWorktree,
        repository,
        worktreePath,
      })

  private onRemoveWorktree =
    (repository: Repository) => (worktreePath: string) =>
      this.props.dispatcher.requestDeleteWorktree(repository, worktreePath)

  private onCreateWorktree = (repository: Repository) =>
    this.props.dispatcher.showPopup({ type: PopupType.AddWorktree, repository })

  private onChangeRepositoryAlias = (repository: Repository) =>
    this.props.dispatcher.showPopup({
      type: PopupType.ChangeRepositoryAlias,
      repository,
    })

  private onRemoveRepositoryAlias = (repository: Repository) =>
    this.props.dispatcher.changeRepositoryAlias(repository, null)

  private onAddRepositoryClick = () =>
    showContextualMenu([
      {
        label: __DARWIN__ ? 'Clone Repository…' : 'Clone repository…',
        action: () =>
          this.props.dispatcher.showPopup({
            type: PopupType.CloneRepository,
            initialURL: null,
          }),
      },
      {
        label: __DARWIN__ ? 'Create New Repository…' : 'Create new repository…',
        action: () =>
          this.props.dispatcher.showPopup({ type: PopupType.CreateRepository }),
      },
      {
        label: __DARWIN__
          ? 'Add Existing Repository…'
          : 'Add existing repository…',
        action: () =>
          this.props.dispatcher.showPopup({ type: PopupType.AddRepository }),
      },
    ])
}

/**
 * The row matching the app's currently selected repository, so that the
 * selection survives a rebuild of the tree. That's the row of the linked
 * worktree the repository is switched onto when there is one on screen, and
 * the repository's own row otherwise.
 */
function findSelectedItem(
  groups: ReadonlyArray<{ items: ReadonlyArray<ScmListItem> }>,
  selectedRepository: Repositoryish | null
): ScmListItem | null {
  if (selectedRepository === null) {
    return null
  }

  let repositoryRow: ScmListItem | null = null

  for (const group of groups) {
    for (const item of group.items) {
      if (
        item.kind === 'worktree' &&
        item.isCurrentWorktree &&
        item.parentRepository.id === selectedRepository.id
      ) {
        return item
      }

      if (
        item.kind === 'repository' &&
        item.repository.id === selectedRepository.id
      ) {
        repositoryRow = item
      }
    }
  }

  return repositoryRow
}
