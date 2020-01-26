import semver from 'semver'
import { niceDate } from './utils'

const MERGE_COMMIT_PATTERN = /^Merge (remote-tracking )?branch '.+'/
const COMMIT_MESSAGE_PATTERN = /\n+([\S\s]+)/

function commitReducer ({ map, version }, commit) {
  const currentVersion = commit.tag || version
  const commits = map[currentVersion] || []
  return {
    map: {
      ...map,
      [currentVersion]: [...commits, commit]
    },
    version: currentVersion
  }
}

function getCommitsByCategory (commits) {
  const featureCommits = []
  const bugFixCommits = []
  const improvementCommits = []
  const otherCommits = []
  const allCommits = []
  for (const commit of commits) {
    if (commit.subject &&
      commit.subject.toLowerCase().includes('[feature]')) {
      commit.feature = true
      featureCommits.push(commit)
    } else if (commit.subject &&
      commit.subject.toLowerCase().includes('[bug]')) {
      commit.bugFix = true
      bugFixCommits.push(commit)
    } else if (commit.subject &&
      commit.subject.toLowerCase().includes('[enhancement]')) {
      commit.enhancement = true
      improvementCommits.push(commit)
    } else if (commit.subject &&
      commit.subject.toLowerCase().includes('[deprecate]')) {
      commit.deprecate = true
      improvementCommits.push(commit)
    } else if (commit.subject &&
      commit.subject.toLowerCase().includes('[remove]')) {
      commit.remove = true
      improvementCommits.push(commit)
    } else {
      otherCommits.push(commit)
    }


    commit.subject = commit.subject
      .replace('[Feature]', '')
      .replace('[feature]', '')
      .replace('[Enhancement]', '')
      .replace('[enhancement]', '')
      .replace('[Bug]', '')
      .replace('[bug]', '')
      .replace('[Deprecate]', '')
      .replace('[deprecate]', '')
      .replace('[Remove]', '')
      .replace('[remove]', '')
    allCommits.push(commit)
  }
  return {
    featureCommits: featureCommits.length > 0 ? featureCommits : undefined,
    bugFixCommits: bugFixCommits.length > 0 ? bugFixCommits : undefined,
    improvementCommits: improvementCommits.length > 0 ? improvementCommits : undefined,
    otherCommits: otherCommits.length > 0 ? otherCommits : undefined,
    allCommits: allCommits.length > 0 ? allCommits : undefined
  }
}

export function parseReleases (commits, remote, latestVersion, options) {
  const { map } = commits.reduce(commitReducer, { map: {}, version: latestVersion })
  return Object.keys(map).map((key, index, versions) => {
    let commits = map[key]
    const previousVersion = versions[index + 1] || null
    const versionCommit = commits.find(commit => commit.tag) || {}
    const merges = commits.filter(commit => commit.merge).map(commit => commit.merge)
    const fixes = commits.filter(commit => commit.fixes).map(commit => ({ fixes: commit.fixes, commit }))
    const tag = versionCommit.tag || latestVersion
    const date = versionCommit.date || new Date().toISOString()
    const filteredCommits = commits
      .filter(commit => filterCommit(commit, options, merges))
      .sort(commitSorter(options))
    const emptyRelease = merges.length === 0 && fixes.length === 0
    const { tagPattern, tagPrefix } = options
    commits = sliceCommits(filteredCommits, options, emptyRelease)
    console.log('commits : ', commits)
    const { featureCommits, bugFixCommits, improvementCommits, otherCommits, allCommits } = getCommitsByCategory(commits)
    return {
      tag,
      title: tag || 'Unreleased',
      date,
      isoDate: date.slice(0, 10),
      niceDate: niceDate(date),
      featureCommits,
      bugFixCommits,
      improvementCommits,
      otherCommits,
      allCommits,
      merges,
      fixes,
      summary: getSummary(versionCommit.message, options),
      major: Boolean(!tagPattern && tag && previousVersion && semver.diff(tag, previousVersion) === 'major'),
      href: previousVersion ? remote.getCompareLink(`${tagPrefix}${previousVersion}`, tag ? `${tagPrefix}${tag}` : 'HEAD') : null
    }
  }).filter(release => {
    return options.unreleased ? true : release.tag
  })
}

export function sortReleases (a, b) {
  const tags = {
    a: inferSemver(a.tag),
    b: inferSemver(b.tag)
  }
  if (tags.a && tags.b) {
    if (semver.valid(tags.a) && semver.valid(tags.b)) {
      return semver.rcompare(tags.a, tags.b)
    }
    if (tags.a === tags.b) {
      return 0
    }
    return tags.a < tags.b ? 1 : -1
  }
  if (tags.a) return 1
  if (tags.b) return -1
  return 0
}

function inferSemver (tag) {
  if (/^v?\d+$/.test(tag)) {
    // v1 becomes v1.0.0
    return `${tag}.0.0`
  }
  if (/^v?\d+\.\d+$/.test(tag)) {
    // v1.0 becomes v1.0.0
    return `${tag}.0`
  }
  return tag
}

function sliceCommits (commits, { commitLimit, backfillLimit }, emptyRelease) {
  if (commitLimit === false) {
    return commits
  }
  const limit = emptyRelease ? backfillLimit : commitLimit
  const minLimit = commits.filter(c => c.breaking).length
  return commits.slice(0, Math.max(minLimit, limit))
}

function filterCommit (commit, { ignoreCommitPattern }, merges) {
  if (commit.fixes || commit.merge) {
    // Filter out commits that already appear in fix or merge lists
    return false
  }
  if (commit.breaking) {
    return true
  }
  if (ignoreCommitPattern) {
    // Filter out commits that match ignoreCommitPattern
    return new RegExp(ignoreCommitPattern).test(commit.subject) === false
  }
  if (semver.valid(commit.subject)) {
    // Filter out version commits
    return false
  }
  if (MERGE_COMMIT_PATTERN.test(commit.subject)) {
    // Filter out merge commits
    return false
  }
  if (merges.findIndex(m => m.message === commit.subject) !== -1) {
    // Filter out commits with the same message as an existing merge
    return false
  }
  return true
}

function getSummary (message, { releaseSummary }) {
  if (!message || !releaseSummary) {
    return null
  }
  if (COMMIT_MESSAGE_PATTERN.test(message)) {
    return message.match(COMMIT_MESSAGE_PATTERN)[1]
  }
  return null
}

function commitSorter ({ sortCommits }) {
  return (a, b) => {
    if (!a.breaking && b.breaking) return 1
    if (a.breaking && !b.breaking) return -1
    if (sortCommits === 'date') return new Date(a.date) - new Date(b.date)
    if (sortCommits === 'date-desc') return new Date(b.date) - new Date(a.date)
    return (b.insertions + b.deletions) - (a.insertions + a.deletions)
  }
}
