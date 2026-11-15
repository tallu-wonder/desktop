import * as React from 'react'
import classNames from 'classnames'

import { Repository } from '../../models/repository'
import {
  getWorktreeDescription,
  getWorktreeDisplayName,
} from '../../models/worktree'
import { IMatches } from '../../lib/fuzzy-find'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { HighlightText } from '../lib/highlight-text'
import { Button } from '../lib/button'
import { TooltippedContent } from '../lib/tooltipped-content'
import { commitGrammar } from '../repositories-list/repository-list-item'
import {
  getActionRepository,
  IScmRepositoryItem,
  IScmWorktreeItem,
  ScmListItem,
} from './scm-tree'

/** The git operation currently running for a row, if any. */
export type ScmRowOperation = 'pull' | 'push'

interface IScmRowProps {
  readonly item: ScmListItem

  /** The characters in the row's name to highlight */
  readonly matches: IMatches

  /** Called when the twistie of a repository row is activated */
  readonly onToggleExpanded: (item: IScmRepositoryItem) => void

  /**
   * Called when the row's pull button is activated. Takes the row rather than
   * its repository so only the row that was clicked shows progress.
   */
  readonly onPull: (item: ScmListItem) => void

  /** Called when the row's push (or publish) button is activated */
  readonly onPush: (item: ScmListItem) => void

  /** Called when the row's overflow button is activated */
  readonly onOverflowMenu: (
    item: ScmListItem,
    event: React.MouseEvent<HTMLButtonElement>
  ) => void

  /** The operation currently running for this row, if any */
  readonly operation: ScmRowOperation | null
}

/**
 * A single row in the source control panel: a repository, one of its
 * worktrees, or the placeholder for a repository without any.
 *
 * Every row is laid out in the same three columns - name, ref, trailing - so
 * that the refs line up down the panel like a table. Indentation happens
 * inside the name column so that nesting doesn't shift the other two.
 */
export class ScmRow extends React.Component<IScmRowProps> {
  public render() {
    const { item } = this.props

    return item.kind === 'repository'
      ? this.renderRepositoryRow(item)
      : this.renderWorktreeRow(item)
  }

  private renderRepositoryRow(item: IScmRepositoryItem) {
    const { repository, needsDisambiguation } = item
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const alias = repository instanceof Repository ? repository.alias : null
    const prefix =
      needsDisambiguation && gitHubRepo ? `${gitHubRepo.owner.login}/` : null

    return (
      <div className="scm-row scm-repository-row">
        <div className="row-name">
          {this.renderTwistie(item)}
          <Octicon
            className="row-icon"
            symbol={iconForRepository(repository)}
          />
          <div className={classNames('name', { alias: alias !== null })}>
            {prefix && <span className="prefix">{prefix}</span>}
            <HighlightText
              text={alias ?? repository.name}
              highlight={this.props.matches.title}
            />
          </div>
        </div>
        <div className="row-ref">
          {this.renderRef(item.ref, item.refIsDetached)}
        </div>
        <div className="row-trailing">
          {this.renderIndicators(item)}
          {this.renderActions(item)}
        </div>
      </div>
    )
  }

  private renderWorktreeRow(item: IScmWorktreeItem) {
    return (
      <div className="scm-row scm-worktree-row">
        <div className="row-name">
          <div className="twistie-spacer" />
          <Octicon
            className="row-icon"
            symbol={
              item.isCurrentWorktree
                ? octicons.gitBranchCheck
                : octicons.gitBranch
            }
          />
          <div className="name">
            <HighlightText
              text={
                item.worktree.path.split(/[\\/]/).pop() ?? item.worktree.path
              }
              highlight={this.props.matches.title}
            />
          </div>
        </div>
        <div className="row-ref">
          {this.renderRef(
            getWorktreeDescription(item.worktree),
            item.worktree.isDetached
          )}
        </div>
        <div className="row-trailing">
          <div className="indicators">
            {item.worktree.isLocked && (
              <TooltippedContent
                className="worktree-locked"
                tagName="div"
                tooltip="This worktree is locked"
              >
                <Octicon symbol={octicons.lock} />
              </TooltippedContent>
            )}
          </div>
          {this.renderActions(item)}
        </div>
      </div>
    )
  }

  /**
   * A repository only gets a twistie when it actually has worktrees to show;
   * the others get a spacer so their names still line up.
   */
  private renderTwistie(item: IScmRepositoryItem) {
    const count = item.linkedWorktrees.length

    if (count === 0) {
      return <div className="twistie-spacer" />
    }

    const label = `${
      item.isExpanded ? 'Hide' : 'Show'
    } ${count} linked worktree${count === 1 ? '' : 's'} in ${
      item.repository.name
    }`

    return (
      <Button
        className="twistie"
        ariaLabel={label}
        tooltip={label}
        ariaExpanded={item.isExpanded}
        onClick={this.onTwistieClick}
      >
        <Octicon
          symbol={
            item.isExpanded ? octicons.chevronDown : octicons.chevronRight
          }
        />
      </Button>
    )
  }

  private renderRef(ref: string | null, isDetached: boolean = false) {
    if (ref === null) {
      return null
    }

    return (
      <div className={classNames('ref', { detached: isDetached })}>
        <Octicon
          symbol={isDetached ? octicons.gitCommit : octicons.gitBranch}
        />
        <span className="ref-name">{ref}</span>
      </div>
    )
  }

  private renderIndicators(item: IScmRepositoryItem) {
    const { aheadBehind, changedFilesCount } = item
    const ahead = aheadBehind?.ahead ?? 0
    const behind = aheadBehind?.behind ?? 0
    const hasChanges = changedFilesCount > 0

    if (ahead === 0 && behind === 0 && !hasChanges) {
      return <div className="indicators" />
    }

    const aheadBehindTitle =
      ahead === 0 && behind === 0
        ? undefined
        : 'The currently checked out branch is' +
          (behind ? ` ${commitGrammar(behind)} behind ` : '') +
          (behind && ahead ? 'and' : '') +
          (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
          'its tracked branch.'

    return (
      <div className="indicators">
        {(ahead > 0 || behind > 0) && (
          <TooltippedContent
            className="scm-ahead-behind"
            tagName="div"
            tooltip={aheadBehindTitle}
          >
            {ahead > 0 && (
              <>
                <Octicon symbol={octicons.arrowUp} />
                <span className="count">{ahead}</span>
              </>
            )}
            {behind > 0 && (
              <>
                <Octicon symbol={octicons.arrowDown} />
                <span className="count">{behind}</span>
              </>
            )}
          </TooltippedContent>
        )}
        {hasChanges && (
          <TooltippedContent
            className="change-indicator"
            tagName="div"
            tooltip={`${changedFilesCount} uncommitted change${
              changedFilesCount === 1 ? '' : 's'
            }`}
          >
            <Octicon symbol={octicons.dotFill} />
          </TooltippedContent>
        )}
      </div>
    )
  }

  /**
   * The actions a row offers: pull, push, and the overflow menu. Like pull,
   * push acts on the branch the app has checked out for the repository, so
   * it's offered on the repository row and on the row of the worktree the
   * repository is switched onto, never on the other worktrees.
   */
  private renderActions(item: ScmListItem) {
    const actionRepository = getActionRepository(item)
    const pushRepository =
      item.kind === 'repository' || item.isCurrentWorktree
        ? actionRepository
        : null

    return (
      <div className="actions">
        {actionRepository !== null && this.renderPullAction(item)}
        {pushRepository !== null ? (
          this.renderPushAction(item, pushRepository)
        ) : (
          // Keep the overflow button in the same column on rows that can't
          // offer a push.
          <div className="action-spacer" />
        )}
        <Button
          className="action overflow"
          ariaLabel="More actions"
          tooltip="More actions"
          onClick={this.onOverflowClick}
        >
          <Octicon symbol={octicons.kebabHorizontal} />
        </Button>
      </div>
    )
  }

  /**
   * Pull acts on the branch the app currently has checked out for the
   * repository, so exactly one row per repository can offer it: the
   * repository row when Desktop is on the main worktree, otherwise the row of
   * whichever worktree is open. The others are disabled rather than hidden so
   * the column stays put, and say what to do about it.
   *
   * Fetching is not offered here at all; it happens on its own in the
   * background.
   */
  private renderPullAction(item: ScmListItem) {
    const { operation } = this.props
    const reason = describePullAvailability(item)
    const disabled = reason !== null || operation !== null
    const label = reason ?? `Pull ${describeRowName(item)}`

    return (
      <Button
        className="action"
        ariaLabel={label}
        tooltip={label}
        disabled={disabled}
        onClick={this.onPullClick}
      >
        <Octicon
          className={classNames({ spin: operation === 'pull' })}
          symbol={octicons.sync}
        />
      </Button>
    )
  }

  private renderPushAction(item: ScmListItem, repository: Repository) {
    const { operation } = this.props
    const isUnpublished =
      item.kind === 'repository' ? item.remoteName === null : false

    // A repository row stands for the main worktree. While the repository is
    // switched onto a linked one a push would send that worktree's branch, so
    // it's that worktree's row which offers it.
    const reason =
      item.kind === 'repository' && !item.isOnMainWorktree && !isUnpublished
        ? `${repository.name} is open on one of its worktrees; push from that worktree's row`
        : null

    const label =
      reason ??
      (isUnpublished
        ? `Publish ${repository.name}`
        : `Push ${describeRowName(item)}`)

    return (
      <Button
        className="action"
        ariaLabel={label}
        tooltip={label}
        disabled={reason !== null || operation !== null}
        onClick={this.onPushClick}
      >
        <Octicon
          className={classNames({ spin: operation === 'push' })}
          symbol={isUnpublished ? octicons.upload : octicons.repoPush}
        />
      </Button>
    )
  }

  private onTwistieClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()

    if (this.props.item.kind === 'repository') {
      this.props.onToggleExpanded(this.props.item)
    }
  }

  private onPullClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    this.props.onPull(this.props.item)
  }

  private onPushClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    this.props.onPush(this.props.item)
  }

  private onOverflowClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    this.props.onOverflowMenu(this.props.item, event)
  }
}

/** The name to use for a row in an action's label. */
const describeRowName = (item: ScmListItem) =>
  item.kind === 'repository'
    ? item.repository.name
    : getWorktreeDisplayName(item.worktree)

/**
 * Why this row can't be pulled, or `null` when it can. Pull applies to the
 * branch the app has checked out for the repository, so a row that doesn't
 * represent that checkout has nothing to pull.
 */
const describePullAvailability = (item: ScmListItem): string | null => {
  if (item.kind === 'worktree') {
    return item.isCurrentWorktree
      ? null
      : `Open the ${getWorktreeDisplayName(item.worktree)} worktree to pull it`
  }

  if (!item.isOnMainWorktree) {
    return `${item.repository.name} is open on one of its worktrees; select it to pull its main worktree`
  }

  if (item.ref !== null && item.refIsDetached) {
    return `${item.repository.name} has a detached HEAD and nothing to pull into`
  }

  if (item.remoteName !== null && !item.hasUpstreamBranch) {
    return `${
      item.ref ?? item.repository.name
    } has no tracked branch to pull from`
  }

  return null
}
