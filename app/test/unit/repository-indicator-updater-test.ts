import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'
import { RepositoryIndicatorUpdater } from '../../src/lib/stores/helpers/repository-indicator-updater'

/** Let pending zero-delay timers and promise continuations run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

describe('RepositoryIndicatorUpdater', () => {
  const repository = new Repository('/repositories/one', 1, null, false)

  /** An updater whose refreshes block until released by the test. */
  const setup = () => {
    let started = 0
    let active = 0
    let maxActive = 0
    const pending = new Array<() => void>()

    const updater = new RepositoryIndicatorUpdater(
      () => [repository],
      () =>
        new Promise<void>(resolve => {
          started++
          active++
          maxActive = Math.max(maxActive, active)
          pending.push(() => {
            active--
            resolve()
          })
        })
    )

    return {
      updater,
      started: () => started,
      maxActive: () => maxActive,
      release: () => pending.shift()?.(),
    }
  }

  it('does nothing when asked to refresh before being started', async () => {
    const { updater, started } = setup()

    updater.refreshNow()
    await settle()

    assert.equal(started(), 0)
  })

  it('refreshes right away when asked to', async () => {
    const { updater, started, release } = setup()

    updater.start()
    updater.refreshNow()
    await settle()

    assert.equal(started(), 1)

    updater.stop()
    release()
  })

  it('queues one more pass instead of running two at once', async () => {
    const { updater, started, maxActive, release } = setup()

    updater.start()
    updater.refreshNow()
    await settle()
    assert.equal(started(), 1)

    // Asked again (twice) while the first pass is still under way.
    updater.refreshNow()
    updater.refreshNow()
    await settle()
    assert.equal(started(), 1)

    // The first pass finishes, and exactly one follow-up pass runs.
    release()
    await settle()
    assert.equal(started(), 2)

    release()
    await settle()
    assert.equal(started(), 2)
    assert.equal(maxActive(), 1)

    updater.stop()
  })

  it('does not start a pass while paused', async () => {
    const { updater, started, release } = setup()

    updater.pause()
    updater.start()
    updater.refreshNow()
    await settle()
    assert.equal(started(), 0)

    updater.resume()
    await settle()
    assert.equal(started(), 1)

    updater.stop()
    release()
  })
})
