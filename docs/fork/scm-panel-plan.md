# Source Control panel (VS Code-style repo/worktree tree)

Fork: https://github.com/tallu-wonder/desktop (upstream remote = desktop/desktop)

Goal: a persistent left panel listing **all** added repositories, with worktrees
nested under their parent repo, each row showing branch + status and inline
actions (fetch / push / overflow menu) that work on repos that are *not* the
currently selected one.

Upstream already ships worktree support (`app/src/models/worktree.ts`,
`app/src/ui/worktrees/*`, `enableWorktreeSupport() === true`), so this is
mostly a UI + data-fan-out job, not a git-layer job.

## Stage 1 - data layer

`ILocalRepositoryState` (`app/src/models/repository.ts`) is the per-repo cache
the repository list already reads from, refreshed for every repo by
`repository-indicator-updater.ts`. Extend it:

| field | why |
| --- | --- |
| `currentBranch: string \| null` | branch chip on the row |
| `currentTip: string \| null` | short SHA when HEAD is detached |
| `hasRemote: boolean` | push vs. publish icon |
| `worktrees: ReadonlyArray<WorktreeEntry>` | the nested children |

Populate in `AppStore.updateSidebarIndicator` (already holds the full
`IStatusResult`) and `refreshIndicatorForRepository`. Worktrees need one extra
`git worktree list --porcelain` per repo per indicator tick - cheap, and the
updater is already throttled.

## Stage 2 - tree model

- `IRepositoryListItem` gains `kind: 'repository' | 'worktree'`, `depth`,
  `parentId`, `worktree?`.
- `groupRepositories()` splices worktree child items in after each repo whose
  id is in the expanded set and which has >= 1 linked worktree.
- Expansion state: component state, persisted through the existing
  `getObject`/`setObject` local-storage helpers.

## Stage 3 - the panel

- New `app/src/ui/scm-panel/` with `ScmPanel` (header + `SectionFilterList`),
  `scm-repository-row.tsx`, `scm-worktree-row.tsx`.
- `App.renderApp()` becomes a row flex: `ScmPanel` + `Resizable` +
  a column holding toolbar / banner / repository view.
- New app state: `scmPanelWidth: IConstrainedValue` (config `scm-panel-width`)
  and `scmPanelVisible: boolean` (config `scm-panel-visible`).
- `AppStore.updateResizableConstraints()` subtracts the panel width from
  `available` before it allocates the sidebar and the toolbar buttons.
- View-menu toggle: `menu-ids.ts`, `build-default-menu.ts`, `menu-event.ts`,
  handler in `app.tsx`.

## Stage 4 - row actions

| control | call |
| --- | --- |
| row click (repo) | `dispatcher.selectRepository(repo)` (panel does not close) |
| row click (worktree) | `dispatcher.switchWorktree(repo, worktree)` |
| fetch | `dispatcher.fetch(repo, FetchType.UserInitiatedTask)` |
| push | `dispatcher.push(repo)`, or `PopupType.PublishRepository` when unpublished |
| overflow | existing `generateRepositoryListContextMenu` / worktree equivalent |

Per-row spinner from a local `Map<repoId, 'fetch' \| 'push'>`; errors already
surface through the dispatcher's error pipeline.

## Dev environment

- `.nvmrc` wants node v24; the machine's default is v26. Prefix commands with
  `PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.
- `yarn` 1.21.1 installed globally.

---

## What shipped

All four stages are in, on branch `scm-panel`, verified against a real build.

New files:

- `app/src/ui/scm-panel/scm-tree.ts` - the row model and the tree builder
- `app/src/ui/scm-panel/scm-row.tsx` - a repository or worktree row
- `app/src/ui/scm-panel/scm-panel.tsx` - header + filter list + row actions
- `app/styles/ui/_scm-panel.scss`

Touched: `app/src/models/repository.ts`, `app/src/lib/app-state.ts`,
`app/src/lib/stores/app-store.ts`, `app/src/ui/dispatcher/dispatcher.ts`,
`app/src/ui/app.tsx`, `app/src/ui/lib/section-filter-list.tsx` (new optional
`onItemKeyDown`), `app/src/models/menu-ids.ts`,
`app/src/models/menu-labels.ts`, `app/src/main-process/menu/menu-event.ts`,
`app/src/main-process/menu/build-default-menu.ts`, `app/src/lib/menu-update.ts`.

The panel is on by default and toggles from View with `Ctrl/Cmd+Shift+L`
(`Shift+E` is upstream's "Rebase current branch").

## Traps hit along the way

- **`.ahead-behind` is a global class.** `ui/toolbar/_toolbar.scss` styles it
  unscoped as a dark toolbar badge, so reusing the repository list's class name
  rendered the arrows invisible against the panel. The panel's badge is
  `.scm-ahead-behind` for that reason.
- **`getItemAriaLabel` aria-hides a row's children.** `list-row.tsx` wraps
  children in `aria-hidden` whenever an item aria-label is supplied, which
  hides per-row action buttons from assistive tech (Chromium logs "Element with
  focus ... Ancestor with aria-hidden"). The panel supplies no item aria-label
  so its buttons stay reachable.
- **`localRepositoryStateLookup` is mutated in place** by the app store, so
  `memoizeOne` on it (as `RepositoriesList` does) pins you to a stale tree. The
  panel rebuilds its tree each render instead.
- **Don't `page.setViewportSize()` when driving Electron.** It pins Chromium's
  device metrics, so the app stops filling the window when it's resized and
  looks like a layout bug. Set the `BrowserWindow` bounds instead.
- **The dev build's renderer is served by webpack-dev-middleware on :3000**, so
  a Playwright launch of `dist/` renders a blank page. Build unpackaged prod
  (`NODE_ENV=production DESKTOP_SKIP_PACKAGE=1 yarn build:prod`) and launch
  `out/main.js`.

## Known gaps

- Pull and push act on the branch a repository currently has checked out, so
  only the row for that checkout offers them: the repository row on the main
  worktree, otherwise the row of the worktree it's switched onto. Other
  worktrees have to be opened first.
- With "repository indicators" turned off in settings nothing refreshes the
  unselected rows, so they show no branch and their actions do nothing.
- A linked worktree added as a repository of its own is listed as a plain
  row with no children; its siblings nest under the main repository's row.
- Filtering matches worktrees but drops their parent repository row, so a hit
  loses its context. VS Code keeps the parent visible.
- The toolbar's own repository dropdown is now redundant while the panel is
  open, and is still there.

---

## Fixes after first use

**The View menu toggle stranded itself disabled.** `menu-update.ts`'s
`getNoRepositoriesBuilder` only ever *disables* its ids; the ones it lists are
re-enabled later by `getRepositoryMenuBuilder`. `toggle-scm-panel` isn't in
that builder, so after a launch with no repositories it stayed greyed out for
the rest of the session and the panel could not be brought back. It now uses
`setEnabled` so the state is two-way. Regression-checked: hide leaves the item
enabled with the label flipped to "Show", and clicking it again restores the
panel.

**The panel didn't match the app.** It had its own background tint, a
VS-Code-style uppercase micro-caps header and an icon-only add button, so it
read as a foreign slab. Now:

- the header is `var(--toolbar-height)` tall with the toolbar's background and
  text colors, so the dark toolbar band runs unbroken across the window
- the body has no background of its own, only `border-right`, exactly like
  `#repository-sidebar`
- rows use the repository list's and worktree list's metrics (`padding: 0
  var(--spacing)`, 16px icons, `--font-size-sm` secondary ref text)
- the add button is the same `Add ▾` control the repository dropdown uses
- the selected row's children inherit its foreground instead of staying grey

## Installing it as a real app

`app/package.json` carries a distinct `productName` ("GitHub Desktop SCM") and
`bundleID` (`ai.wonderful.GitHubDesktopSCM`) so the fork installs beside an
existing GitHub Desktop and gets its own application-support directory.
`script/build.ts` also stops a non-publishable build from claiming the shared
`x-github-client` / `github-mac` URL schemes, which would otherwise compete
with the real app for "Open in Desktop" links.

Build and install:

```
NODE_ENV=production RELEASE_CHANNEL=development yarn build:prod
rm -rf "/Applications/GitHub Desktop SCM.app"
cp -R "dist/GitHub Desktop SCM-darwin-arm64/GitHub Desktop SCM.app" /Applications/
```

`NODE_ENV=production` gets a standalone renderer bundle (the development
webpack config expects a dev server on :3000) while
`RELEASE_CHANNEL=development` keeps the auto-updater off, so the fork can never
replace itself with an upstream release, and makes the build sign itself ad-hoc
(there's no Developer ID on this machine). The licenses step hits the network
and fails intermittently with `ERR_NON_2XX_3XX_RESPONSE`; just rerun.

---

## Second round of feedback

1. **No Recent group.** `buildScmTree` now calls `groupRepositories` with an
   empty recent list. The group duplicated repositories that are already listed
   under their owner, which reads as noise in a list that's always on screen.
2. **The ref is its own column.** Each row is a three-column CSS grid -
   `var(--scm-name-column)` (45%), the ref, then indicators and actions - so
   refs and action buttons line up down the panel like a table. Nesting is
   expressed as padding *inside* the name column so indenting a worktree
   doesn't shift the other two columns, and a row that can't offer a push
   renders an `.action-spacer` so the overflow button stays in its column.
3. **Row actions are always visible**, on every row, not just the hovered or
   selected one.
4. **The Current Repository and Current Worktree dropdowns go inert while the
   panel is open** (`aria-disabled`, tooltip pointing at the panel), along with
   their menu items `show-repository-list` and `show-worktrees-list` and the
   `chooseRepository` / `showWorktrees` handlers behind `Cmd+T` and
   `Cmd+Alt+W`. Desktop's `Button` uses `aria-disabled` plus `preventDefault`
   handlers rather than the native `disabled` attribute, so assert on
   `aria-disabled` when checking this, not on `button.disabled`.
5. **Expand and collapse all.** Reverted: a repository only gets a chevron
   when it actually has linked worktrees, and there is no "No worktrees"
   placeholder row. The panel header carries a single button that offers
   whichever of expand-all / collapse-all would change something (`unfold` /
   `fold` octicon, label and tooltip follow), disabled when no repository has
   worktrees at all.

Verified end to end: the dropdowns are `aria-disabled` with the panel open,
clicking one does not open its foldout, and both come back when the panel is
hidden.

### Trap: an item with empty `text` crashes the filter

(Kept for the record - the placeholder row that hit this has since been
removed.)

`fuzzy-find`'s `match()` sets `matches.title = matches[0]`, which is
`undefined` for an item whose `text` array is empty, and the row renderer then
reads `.length` off it. The first cut of the "No worktrees" placeholder carried
`text: []` and took the whole renderer down as soon as anything was typed in
the filter. Placeholders now carry real text *and* are left out entirely while
filtering, since a row of filler under every repository would bury the actual
matches.

### Note on `switchWorktree`

Clicking a worktree row re-points the *repository* at that worktree's path
(upstream `_switchWorktree` behaviour), so the panel afterwards lists the
repository under the worktree's directory name rather than the original one.
That's upstream semantics, not something this panel introduces, but it's
surprising in a list that shows every repository at once.

---

## Third round: wrong branch, and stale rows

**The repository row reported its own child's branch.** `Repository.path` is
re-pointed at a linked worktree when Desktop switches onto one
(`_switchWorktree`, with the original recorded in `mainWorktreePath`), so
`git status` for that repository returns the *worktree's* HEAD. A GitHub-backed
repository keeps its name (`Repository.name` is `gitHubRepository.name ||
basename(path)`), which is why the row still said `repo-a` while showing
`feature-branch` - and why this looked like a rendering bug
rather than a switched path.

The row now describes the **main** worktree: `IScmRepositoryItem.ref` /
`refIsDetached` come from the `type === 'main'` entry of the worktree list,
falling back to the loaded status only until that list arrives. The child row
for whichever worktree Desktop actually has open keeps its check icon.

Still inherited from the switched path: the row's ahead/behind and dirty
indicator describe the worktree Desktop has open, not the main worktree.
Fixing that means a `git status` per worktree per repository.

**Rows only filled in when a repository was clicked.** Nothing to do with the
panel: `InitialRepositoryIndicatorTimeout` is 2 minutes, `RepositoryIndicatorUpdater`
then adds up to 30s of skew and refreshes every **15 minutes**. That cadence is
fine for a dropdown; for a list that's always on screen it reads as broken, and
clicking a repository was the only thing filling it in (via `_refreshRepository`).

`RepositoryIndicatorUpdater` gained `setRefreshInterval` and `refreshNow`, and
`AppStore.updateRepositoryIndicatorCadence()` drives them from
`scmPanelVisible`: 30s while the panel is up, the default 15 minutes otherwise.
It runs on launch (from `loadInitialState`, after the repository list is in
place), when the panel is toggled on, when indicators are re-enabled, and on
window focus. Cost is one `git status` + `git worktree list` + `loadRemotes`
per repository per pass.

Verified by switching Desktop onto a linked worktree in the fixture set: the
parent row keeps `ref: main` while its child keeps
`ref: feature-branch`.

---

## Fourth round: clicking a repository row opened its child worktree

The row was made to *display* the main worktree's branch, but activating it
still called `selectRepository`, which re-opens whatever `repository.path`
points at - a linked worktree, if Desktop had switched onto one. So there was
no way back to the main worktree from the panel, and the row said one thing
while doing another.

A repository row now carries `mainWorktree` and `isOnMainWorktree`, and
activating it calls `switchWorktree(repository, mainWorktree)` when the
repository isn't already on its main worktree, falling back to
`selectRepository` otherwise (including while the worktree list is still
loading). `_switchWorktree` takes any entry, main included, and selects the
repository itself at the end.

Verified with two linked worktrees on one repository:

| action | worktree Desktop has open | repository rows' refs |
| --- | --- | --- |
| start | none | `main`, `main` |
| click worktree A | `feature-branch` | `main`, `main` |
| click worktree B | `second-wt` | `main`, `main` |
| click the repository row | none | `main`, `main` |

The check icon (`gitBranchCheck`) marks whichever worktree is open and clears
when the main worktree is selected. Note the parent row of a *non-GitHub*
repository renames itself to the worktree's directory name while switched onto
it, because `Repository.name` falls back to `basename(path)`; a GitHub-backed
repository keeps its name.

---

## Fifth round: the spinner lied about what was being fetched

`runOperation` used to mark the repository row *and* every worktree row
belonging to it as in flight, on the reasoning that a fetch reaches all of
them. Two rows spinning from one click reads as "it fetched the worktree, not
the repository", which is what it looked like. Progress is now scoped to the
row that was clicked: `onFetch` / `onPush` take the row rather than its
repository, and `getActionRepository` moved to `scm-tree.ts` so the panel and
the row can both reach it.

Nothing changed about *where* the fetch goes, because there is nowhere else for
it to go: a repository and all of its worktrees share one object store and one
set of remote refs, so `git fetch` from any of them updates all of them. The
button's row says which row you asked from, not which worktree got fetched.

Verified: fetching from the repository row spins only that row; fetching from a
worktree row spins only that worktree's row; both clear when the fetch settles.

---

## Sixth round: the sync button pulls

The spinning-arrows button now calls `dispatcher.pull`, not `fetch`. Fetching
is left to the background: every indicator pass runs `shouldBackgroundFetch`,
which fetches any repository that hasn't been fetched recently enough.

That threshold is `BackgroundFetchMinimumInterval` (30 minutes) normally and
`ScmPanelBackgroundFetchMinimumInterval` (**5 minutes**) while the panel is
open, and `getRepositoriesForIndicatorRefresh` stops excluding the selected
repository while the panel is open so it's on the same cadence as every other
row rather than relying on its own `BackgroundFetcher`. The indicator pass
itself runs every 30s with the panel open, so each repository gets fetched
about every 5 minutes.

Five minutes rather than something shorter because it's the floor
`BackgroundFetcher` already applies to the poll interval GitHub hands out;
fetching a whole repository list faster than that is impolite to the server.

`app/test/unit/stores/app-store-indicators-test.ts` asserted the old
"always exclude the selected repository" rule, so those cases now pin
`scmPanelVisible = false` and a new case covers the panel-open behaviour.

Pull applies to the branch the app has checked out for a repository, and there
is no API for pulling some other worktree's branch without switching to it. So
exactly one row per repository offers an enabled pull:

| row | enabled when | otherwise |
| --- | --- | --- |
| repository | Desktop is on the main worktree | "… is open on one of its worktrees; select it to pull its main worktree" |
| worktree | it's the worktree Desktop has open | "Open the … worktree to pull it" |

Repository rows are also disabled on a detached HEAD, and when the branch has
no tracking branch, rather than letting the pull fail in a dialog. Disabled
rather than hidden so the action column doesn't shift.

Verified: on the main worktree every repository row reads "Pull <name>" and
every worktree row is disabled; after opening a linked worktree the enabled
pull moves to that worktree's row and its parent becomes disabled.

---

## Why the panel still differs from VS Code's Source Control Repositories

Measured against the side-by-side comparison, not guessed.

### Not differences - transient, and already gone

**Blank `repo-f` row, no ahead/behind anywhere.** The app log showed
`ENOENT: Git failed to execute ... dugite` repeatedly. Those errors all predate
the running instance: replacing `/Applications/GitHub Desktop SCM.app` with
`rm -rf` + `cp -R` while an older instance was still running pulled the bundled
git out from under it, so every `git` call in that instance failed. A failed
status makes `updateSidebarIndicator` *delete* the repository's lookup entry,
which is exactly a row with no branch, no indicators and a publish icon
(`remoteName === null`). Zero git errors since the current launch.

Latent issue worth fixing: a transient status failure shouldn't empty a row
that's permanently on screen. Keeping the last known values (and only clearing
for a genuinely missing repository) would be more robust.

**The `1↓ 0↑` / `4↓ 0↑` / `3↓ 0↑` counts VS Code shows.** On disk every one of
those repositories is level with its upstream:

```
repo-f                 main 0  0
repo-b                 main 0  0
repo-c                 main 0  0
```

So the panel is right and VS Code's numbers are stale - it fetched, showed the
counts, and hasn't re-checked since those branches were brought up to date.

### Real differences

| VS Code | this panel | why |
| --- | --- | --- |
| submodules nested as child repositories (`gemoji`, `gitignore`, `choosealicense.com`, `license-list-XML` under `desktop`) | only worktrees nest | not implemented; the tree only knows about `git worktree list` |
| one flat list | grouped by owner (one group per account or organisation) | deliberate: reuses Desktop's `groupRepositories`, which is how its repository dropdown has always grouped |
| `scm-panel*` - dirty as an asterisk on the branch | a blue dot in the indicators column | Desktop's own convention (`dotFill`, as in its repository list) |
| a checked-book icon on the active repository | row selection only | the icon slot already carries Desktop's repo/private/fork icon |
| `1↓ 0↑` always shown, after the branch | only non-zero counts, right-aligned | Desktop's convention: it hides zeroes |
| its own ordering (`desktop` last) | alphabetical within each group | `groupRepositories` sorts case-insensitively by display name |

Only the first row of that table is a missing capability; the rest are places
where the panel deliberately follows Desktop's conventions rather than
VS Code's.

---

## Seventh round: the background fetch erased the ahead/behind it just earned

Measured first: `repo-a` was 1 behind, `repo-b` 30 behind,
`repo-c` 61 behind on disk - exactly the numbers VS Code
showed - while the panel's indicator column was empty. So the panel was wrong,
not stale.

`refreshIndicatorForRepository` ended with

```ts
const aheadBehind = await this.fetchForRepositoryIndicator(repository)
lookup.set(repository.id, { ...existing, aheadBehind })
```

and `fetchForRepositoryIndicator` returns `gitStore.aheadBehind` for the
repository that `withRefreshedGitHubRepository` hands it. That can be a
*different* `Repository` instance, because refreshing the GitHub metadata
produces a new one - and `GitStoreCache` is keyed on `repository.hash`, which
includes `gitHubRepository.hash`. A new hash means a brand new `GitStore`,
whose `_aheadBehind` is `null` until something calls `loadStatus` on it. So the
fetch returned `null` and the write erased the counts `updateSidebarIndicator`
had just stored.

Only repositories with GitHub metadata can hit this, which is why local
fixtures never reproduced it and why every real repository did. It
was harmless upstream: the write happens at most once every 30 minutes and the
repository list is a dropdown nobody watches. With the panel always on screen
and a 5 minute fetch interval, it wiped the column.

The block now re-reads the status from the repository's own `GitStore` after
fetching and takes `branchAheadBehind` and the changed-file count from that, so
the numbers reflect what was just fetched instead of whatever a possibly-fresh
GitStore happened to remember.

Verified against a fixture whose remote had moved on and whose `FETCH_HEAD` was
removed so the background fetch would definitely run: the row read `1 ahead,
5 behind` both before and after the fetch landed, and `git rev-list` confirmed
1/5 on disk afterwards.

---

## Eighth round: it only refreshed the repository you clicked

The log said it plainly:

```
Refreshing sidebar indicators for 9 repositories took 8.4s of which 1827.0s paused
Refreshing sidebar indicators for 9 repositories took 8.2s of which 1796.1s paused
Refreshing sidebar indicators for 9 repositories took 12.0s of which 1827.0s paused
```

Two problems in those three lines.

**The updater was paused almost all the time.** `_setAppFocusState` pauses
`RepositoryIndicatorUpdater` whenever the window loses focus - sensible when
the indicators only show inside a dropdown, useless when they're a panel you
keep visible while working in an editor or a terminal. A pass would start,
stall mid-list for half an hour, and only move when the window came back. The
one repository that did update was whichever one got clicked, via
`_refreshRepository`. The updater now stays running while the panel is open,
and only pauses on blur when the panel is hidden.

**Passes were stacking.** Three summaries at the same second are three
`refreshAllRepositories` loops walking the same nine repositories, because
`refreshNow()` (focus, panel toggle, indicators re-enabled) started a new pass
without caring that a paused one was still alive. A pass now sets a `refreshing`
flag; `refreshNow()` during one only asks for another when it finishes.

The interval also went from 30s to **60s**: a pass takes 1-8s of git for nine
repositories, and at 30s that was a near-continuous duty cycle for a panel
nobody needs updated twice a minute.

Verified with the window in the background (frontmost application was
something else entirely): four consecutive passes, `0.0s paused` on every one,
one pass at a time, roughly 90s apart (60s interval plus the updater's skew).

---

## Ninth round: expand-all is a mode, not a snapshot

`onExpandAll` used to write down the ids of the repositories that had worktrees
at that moment, so a repository whose first worktree appeared afterwards came
up collapsed. Expansion is now remembered as one of two shapes:

| localStorage key | meaning |
| --- | --- |
| `scm-panel-expand-all-worktrees` | the mode: every repository with worktrees is expanded |
| `scm-panel-collapsed-repositories` | exceptions to the mode, collapsed by hand |
| `scm-panel-expanded-repositories` | the explicit list, used only when the mode is off |

`buildScmTree` now takes an `isRepositoryExpanded(id)` predicate instead of a
set, so the panel can answer "expanded unless collapsed by hand" and a new
worktree needs no interaction. Collapsing a single repository while the mode is
on records an exception rather than dropping the mode, which would otherwise
freeze the worktree layout as it looked at that moment. Collapse-all clears the
mode and both lists.

Verified end to end against three fixture repositories:

| step | result |
| --- | --- |
| expand all | `alpha` and `bravo` expanded; `charlie` has no worktrees, so no twistie |
| add a first worktree to `bravo` on disk | its row appeared already expanded, with nothing clicked |
| collapse `alpha` by hand | `alpha` `aria-expanded=false`, `bravo` still expanded, header still reads "Collapse all worktrees" |
| localStorage | `expandAll=1`, no explicit expanded list, `collapsed` holds only `alpha` |

---

## Tenth round: measuring the "I have to stand on it" claim

Measured on the live install rather than reasoned about.

**The background fetch is running across every repository.** `FETCH_HEAD` on
all nine was touched inside a 14 second window, four minutes before the check:

```
repo-d                 last_fetch=16:53:05
repo-e                 last_fetch=16:53:05
repo-a                 last_fetch=16:53:06
...
repo-i                 last_fetch=16:53:19     (now=16:56:56)
```

**There was nothing to display.** Every repository was exactly level with its
own upstream at that moment, and `desktop` sits on `scm-panel`, which has never
been pushed and so has no upstream at all:

```
repo-d                 main       ahead/behind=0/0
...
desktop                scm-panel  no-upstream
```

So the empty indicator column was correct. What's real is the **latency**: the
panel could be up to 5 minutes behind VS Code, whose `git.autofetchPeriod`
defaults to 180s, and standing on a repository triggers `_refreshRepository`
immediately, which makes the difference feel like a dependency on clicking.
`ScmPanelBackgroundFetchMinimumInterval` is now 3 minutes to match VS Code.

**The display path needs no interaction.** With `charlie` selected, a commit
pushed to `alpha`'s upstream showed up on `alpha`'s row as `1 behind` after
**10 seconds**, zero clicks. (The fixtures have file remotes and no account, so
`inferLastPushForRepository` returns null and `shouldBackgroundFetch` short
circuits past the interval - on GitHub repositories the worst case is the 3
minute gate plus up to 90s of pass interval and skew.)

---

## Eleventh round: review before the first push

A read-through of the whole branch turned up a handful of things:

- The toggle's `Cmd/Ctrl+Shift+E` was already upstream's "Rebase current
  branch". It's `Cmd/Ctrl+Shift+L` now.
- The row highlight stuck to whatever had last been clicked, because the
  list's own selection is never cleared in a panel that doesn't unmount. It's
  dropped whenever the app's selected repository changes.
- "Current worktree" meant "the selected repository's worktree", so a
  switched but unselected repository offered pull on no row at all. It now
  means the worktree the repository's path points at.
- Push follows the same rule as pull: the repository row on the main
  worktree, otherwise the row of the worktree the repository is switched onto.
- A linked worktree added as a repository of its own is a plain row that
  stands for itself, rather than being re-pointed at the main worktree when
  clicked.
- Showing the panel closes the repository and worktree foldouts it disables.

**Pull sometimes did nothing.** `withPushPullFetch` silently drops a request
while another network operation is running in the repository, and
`performPull` silently returns when the tip hasn't been loaded. The panel's
background fetch (every few minutes, and on every window focus) makes the
first common; an unselected repository makes the second common. Row actions
now go through `AppStore._prepareForScmPanelOperation`, which loads the tip and
remote and then waits (up to two minutes) for the repository to go quiet.

Tests: `app/test/unit/scm-tree-test.ts` and
`app/test/unit/repository-indicator-updater-test.ts`.

---

## Twelfth round: every worktree shows its own status

The ahead/behind counts and the uncommitted-changes dot used to exist once per
repository, from the `git status` of whatever worktree the repository was
switched onto, and were drawn on the repository row. Each row now reports its
own: the repository row the main worktree's, each worktree row that
worktree's, wherever the repository happens to be.

`ILocalRepositoryState.worktreeStatus` holds a summary for every worktree
other than the current one, loaded by `getWorktreeStatusSummary` (one
`git status` per extra worktree per indicator pass; nothing for a repository
without linked worktrees). `_switchWorktree` files the outgoing worktree's
status under its path so its row doesn't go blank until the next pass.

## Thirteenth round: power use

macOS listed the app under "Using Significant Energy". With the panel open the
indicator pass ran every minute around the clock, focused or not: about 530
passes and 47,000 git processes a day, the per-worktree status being the
largest share.

- Focused: unchanged, every minute plus an immediate pass on focus.
- Visible but not focused: every 5 minutes
  (`ScmPanelBackgroundRepositoryIndicatorInterval`).
- Window hidden or minimized (`document.visibilityState`): paused, with a pass
  as soon as it is visible again.
- Remotes are re-read at most every 10 minutes per repository instead of on
  every pass.
- `getWorktreeStatusSummary` uses `--untracked-files=normal`, so an untracked
  directory counts as one entry instead of being walked file by file.

Measured over two hours in the background after the change: one pass every
5 minutes 15 seconds, against one every 78 seconds before.
