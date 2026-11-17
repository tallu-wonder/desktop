import { describe, it } from 'node:test'
import assert from 'node:assert'
import { parsePorcelainStatus } from '../../src/lib/status-parser'
import { parseWorktreeStatusSummary } from '../../src/lib/git/worktree'

const summarize = (...fields: ReadonlyArray<string>) =>
  parseWorktreeStatusSummary(
    parsePorcelainStatus(Buffer.from(fields.map(f => `${f}\0`).join('')))
  )

describe('worktree status summary', () => {
  it('reads ahead/behind and counts changed paths', () => {
    const summary = summarize(
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head feature',
      '# branch.upstream origin/feature',
      '# branch.ab +11 -8',
      '1 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 1111111111111111111111111111111111111111 README.md',
      '? notes.txt'
    )

    assert.deepStrictEqual(summary.aheadBehind, { ahead: 11, behind: 8 })
    assert.equal(summary.changedFilesCount, 2)
  })

  it('has no ahead/behind without an upstream', () => {
    const summary = summarize(
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head local-only'
    )

    assert.equal(summary.aheadBehind, null)
    assert.equal(summary.changedFilesCount, 0)
  })
})
