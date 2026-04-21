// Called by the release workflow to update CHANGELOG.md and write a release body.
// Env vars expected: REPO, PREV_TAG, NEW_VERSION
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const _require   = createRequire(import.meta.url)

const repo       = process.env.REPO        || ''
const prevTag    = process.env.PREV_TAG    || ''
const newVersion = process.env.NEW_VERSION || _require('../../package.json').version
const today      = new Date().toISOString().split('T')[0]

// ── Collect commits since last tag ───────────────────────────────────────────
let commits
try {
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD'
  const raw = execSync(`git log --pretty=format:"- %s" ${range}`, { encoding: 'utf8' }).trim()
  commits = raw
    .split('\n')
    .filter(line => line.trim() && !line.includes('[skip ci]'))
    .join('\n')
  if (!commits) commits = '- Maintenance and internal improvements'
} catch {
  commits = '- Initial release'
}

// ── Build new CHANGELOG section ───────────────────────────────────────────────
const newSection = [
  `## [${newVersion}] - ${today}`,
  '',
  '### Changed',
  commits,
  '',
  '---',
  '',
].join('\n')

// ── Update CHANGELOG.md ───────────────────────────────────────────────────────
const changelogPath = join(__dirname, '../../CHANGELOG.md')
let changelog = readFileSync(changelogPath, 'utf8')

// Insert new version section after the [Unreleased] separator
if (changelog.includes('## [Unreleased]\n\n---\n\n')) {
  changelog = changelog.replace(
    '## [Unreleased]\n\n---\n\n',
    `## [Unreleased]\n\n---\n\n${newSection}\n`
  )
} else {
  // Fallback: insert after [Unreleased] line
  changelog = changelog.replace(
    /## \[Unreleased\][^\n]*\n/,
    `## [Unreleased]\n\n---\n\n${newSection}\n`
  )
}

// Update link references at the bottom
const unreleasedLink = `[Unreleased]: https://github.com/${repo}/compare/v${newVersion}...HEAD`
const versionLink = prevTag
  ? `[${newVersion}]: https://github.com/${repo}/compare/${prevTag}...v${newVersion}`
  : `[${newVersion}]: https://github.com/${repo}/releases/tag/v${newVersion}`

changelog = changelog.replace(
  /\[Unreleased\]: .+/,
  `${unreleasedLink}\n${versionLink}`
)

writeFileSync(changelogPath, changelog)
console.log(`CHANGELOG.md updated for v${newVersion}`)

// ── Write release body for GitHub Release ────────────────────────────────────
const bodyLines = [
  `## Clearbook v${newVersion}`,
  '',
  '### Changes',
  commits,
  '',
  '---',
  `See [CHANGELOG.md](https://github.com/${repo}/blob/main/CHANGELOG.md) for full history.`,
]

const bodyPath = join(__dirname, '../release-body.md')
writeFileSync(bodyPath, bodyLines.join('\n'))
console.log('Release body written to .github/release-body.md')
