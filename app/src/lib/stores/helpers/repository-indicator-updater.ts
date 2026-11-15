import { Repository } from '../../../models/repository'

/**
 * Refresh repository indicators every 15 minutes.
 */
export const DefaultRepositoryIndicatorInterval = 15 * 60 * 1000

/**
 * An upper bound to the skew that should be applied to the fetch interval to
 * prevent clients from accidentally syncing up.
 */
const SkewUpperBound = 30 * 1000

// We don't need cryptographically secure random numbers for
// the skew. Pseudo-random should be just fine.
// eslint-disable-next-line insecure-random
const skew = Math.ceil(Math.random() * SkewUpperBound)

export class RepositoryIndicatorUpdater {
  private running = false
  private refreshTimeoutId: number | null = null
  private paused = false
  private pausePromise: Promise<void> = Promise.resolve()
  private resolvePausePromise: (() => void) | null = null
  private lastRefreshStartedAt: number | null = null
  private refreshInterval = DefaultRepositoryIndicatorInterval
  private refreshing = false
  private refreshRequested = false

  public constructor(
    private readonly getRepositories: () => ReadonlyArray<Repository>,
    private readonly refreshRepositoryIndicators: (
      repository: Repository
    ) => Promise<void>
  ) {}

  public start() {
    if (!this.running) {
      log.debug('[RepositoryIndicatorUpdater] Starting')

      this.running = true
      this.scheduleRefresh()
    }
  }

  private scheduleRefresh(immediate: boolean = false) {
    if (this.running && this.refreshTimeoutId === null) {
      const timeSinceLastRefresh =
        this.lastRefreshStartedAt === null
          ? Infinity
          : Date.now() - this.lastRefreshStartedAt

      const timeout = immediate
        ? 0
        : Math.max(this.refreshInterval - timeSinceLastRefresh, 0) + skew
      const lastRefreshText = isFinite(timeSinceLastRefresh)
        ? `${(timeSinceLastRefresh / 1000).toFixed(3)}s ago`
        : 'never'
      const timeoutText = `${(timeout / 1000).toFixed(3)}s`

      log.debug(
        `[RepositoryIndicatorUpdater] Last refresh: ${lastRefreshText}, scheduling in ${timeoutText}`
      )

      this.refreshTimeoutId = window.setTimeout(
        () => this.refreshAllRepositories(),
        timeout
      )
    }
  }

  private async refreshAllRepositories() {
    // We're only ever called by the setTimeout so it's safe for us to clear
    // this without calling clearTimeout
    this.refreshTimeoutId = null

    // `refreshNow` can fire while a pass is still working through the list
    // (and a paused pass can sit there for a long time). Starting a second one
    // would just run every repository twice over.
    if (this.refreshing) {
      log.debug(
        '[RepositoryIndicatorUpdater] Refresh already in progress, queueing'
      )
      this.refreshRequested = true
      return
    }

    this.refreshing = true

    try {
      await this.refreshAllRepositoriesOnce()
    } finally {
      this.refreshing = false
    }

    if (this.refreshRequested) {
      this.refreshRequested = false
      this.scheduleRefresh(true)
    } else {
      this.scheduleRefresh()
    }
  }

  private async refreshAllRepositoriesOnce() {
    log.debug('[RepositoryIndicatorUpdater] Running refreshAllRepositories')
    if (this.paused) {
      log.debug(
        '[RepositoryIndicatorUpdater] Paused before starting refreshAllRepositories'
      )
      await this.pausePromise

      if (!this.running) {
        return
      }
    }

    this.lastRefreshStartedAt = Date.now()

    let repository
    const done = new Set<number>()
    const getNextRepository = () =>
      this.getRepositories().find(x => !done.has(x.id))

    const startTime = Date.now()
    let pausedTime = 0

    while (this.running && (repository = getNextRepository()) !== undefined) {
      await this.refreshRepositoryIndicators(repository)

      if (this.paused) {
        log.debug(
          `[RepositoryIndicatorUpdater] Pausing after ${done.size} repositories`
        )
        const pauseTimeStart = Date.now()
        await this.pausePromise
        pausedTime += Date.now() - pauseTimeStart
        log.debug(
          `[RepositoryIndicatorUpdater] Resuming after ${pausedTime / 1000}s`
        )
      }

      done.add(repository.id)
    }

    if (done.size >= 1) {
      const totalTime = Date.now() - startTime
      const activeTime = totalTime - pausedTime
      const activeTimeSeconds = (activeTime / 1000).toFixed(1)
      const pausedTimeSeconds = (pausedTime / 1000).toFixed(1)
      const totalTimeSeconds = (totalTime / 1000).toFixed(1)

      log.info(
        `[RepositoryIndicatorUpdater]: Refreshing sidebar indicators for ${done.size} repositories took ${activeTimeSeconds}s of which ${pausedTimeSeconds}s paused, total ${totalTimeSeconds}s`
      )
    }
  }

  /**
   * How often to refresh every repository's indicators. The default is
   * deliberately slow because the indicators are normally only visible in a
   * dropdown; a consumer that shows them all the time (the source control
   * panel) asks for something shorter.
   *
   * Any pending refresh is rescheduled against the new interval.
   */
  public setRefreshInterval(refreshInterval: number) {
    if (this.refreshInterval === refreshInterval) {
      return
    }

    log.debug(
      `[RepositoryIndicatorUpdater] Refresh interval is now ${
        refreshInterval / 1000
      }s`
    )
    this.refreshInterval = refreshInterval

    if (this.running) {
      this.clearRefreshTimeout()
      this.scheduleRefresh()
    }
  }

  /** Refresh every repository now, without waiting for the next interval. */
  public refreshNow() {
    if (!this.running) {
      return
    }

    if (this.refreshing) {
      this.refreshRequested = true
      return
    }

    this.clearRefreshTimeout()
    this.scheduleRefresh(true)
  }

  private clearRefreshTimeout() {
    if (this.refreshTimeoutId !== null) {
      window.clearTimeout(this.refreshTimeoutId)
      this.refreshTimeoutId = null
    }
  }

  public stop() {
    if (this.running) {
      log.debug('[RepositoryIndicatorUpdater] Stopping')
      this.running = false
      this.clearRefreshTimeout()
    }
  }

  public pause() {
    if (this.paused === false) {
      this.pausePromise = new Promise<void>(resolve => {
        this.resolvePausePromise = resolve
      })

      this.paused = true
    }
  }

  public resume() {
    if (this.paused) {
      if (this.resolvePausePromise !== null) {
        this.resolvePausePromise()
        this.resolvePausePromise = null
      }

      this.paused = false
    }
  }
}
