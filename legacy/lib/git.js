const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultAgentScanRoots } = require('./config');
const { runCommand } = require('./shell');

function parseWorktreePorcelain(input) {
  const rows = input.split(/\r?\n/);
  const worktrees = [];
  let current = null;

  for (const row of rows) {
    if (!row) {
      if (current && current.worktree) {
        worktrees.push(current);
      }
      current = null;
      continue;
    }

    const firstSpace = row.indexOf(' ');
    const key = firstSpace === -1 ? row : row.slice(0, firstSpace);
    const value = firstSpace === -1 ? '' : row.slice(firstSpace + 1);

    if (key === 'worktree') {
      current = {
        worktree: value,
        head: '',
        branch: null,
        detached: false
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === 'HEAD') {
      current.head = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    } else if (key === 'detached') {
      current.detached = true;
      current.branch = null;
    }
  }

  if (current && current.worktree) {
    worktrees.push(current);
  }

  return worktrees;
}

function getCurrentTopLevel(cwd) {
  const resolvedCwd = safeRealpath(cwd);
  const result = runCommand('git', ['rev-parse', '--show-toplevel'], {
    cwd: resolvedCwd,
    allowFailure: true
  });

  if (result.ok) {
    return result.stdout;
  }

  const anchor = findGitAnchor(resolvedCwd);
  if (anchor) {
    return safeRealpath(anchor);
  }

  throw new Error(result.stderr || `fatal: not a git repository: ${resolvedCwd}`);
}

function listWorktrees(cwd) {
  const resolvedCwd = safeRealpath(cwd);
  const attempts = [resolvedCwd];
  const inferredBasePath = inferBaseRepoPath(resolvedCwd);
  const inferredBaseByWorktreeId = inferBaseRepoPathFromWorktreeId(resolvedCwd);

  if (inferredBasePath && inferredBasePath !== resolvedCwd) {
    attempts.push(inferredBasePath);
  }
  if (
    inferredBaseByWorktreeId &&
    inferredBaseByWorktreeId !== resolvedCwd &&
    !attempts.includes(inferredBaseByWorktreeId)
  ) {
    attempts.push(inferredBaseByWorktreeId);
  }

  let parsed = null;
  let lastError = '';

  for (const attemptCwd of attempts) {
    const result = runCommand('git', ['worktree', 'list', '--porcelain'], {
      cwd: attemptCwd,
      allowFailure: true
    });

    if (result.ok) {
      parsed = parseWorktreePorcelain(result.stdout);
      break;
    }

    lastError = result.stderr || lastError;
  }

  if (!parsed) {
    throw new Error(lastError || 'Unable to list git worktrees.');
  }

  return parsed.map((entry) => ({
    ...entry,
    resolvedWorktree: safeRealpath(entry.worktree)
  }));
}

function getBaseWorktreePath(cwd) {
  const worktrees = listWorktrees(cwd);

  if (!worktrees.length) {
    throw new Error('No git worktrees found in this repository.');
  }

  return worktrees[0].worktree;
}

function resolveWorktreeRef({ ref, worktrees, cwd }) {
  const selectedRef = ref || getCurrentTopLevel(cwd);

  const byBranch = worktrees.find((item) => item.branch === selectedRef);
  if (byBranch) {
    return byBranch;
  }

  const absoluteRef = path.resolve(cwd, selectedRef);
  if (fs.existsSync(absoluteRef)) {
    const resolvedInput = safeRealpath(absoluteRef);
    const pathMatch = worktrees.find((item) => item.resolvedWorktree === resolvedInput);

    if (pathMatch) {
      return pathMatch;
    }

    throw new Error(`'${selectedRef}' exists but is not a tracked git worktree.`);
  }

  const fallbackMatches = worktrees.filter((item) => {
    const basename = path.basename(item.worktree);
    return basename === selectedRef || item.worktree.endsWith(`@${selectedRef}`) || basename.endsWith(`@${selectedRef}`);
  });

  if (fallbackMatches.length === 1) {
    return fallbackMatches[0];
  }

  if (fallbackMatches.length > 1) {
    throw new Error(`Ambiguous worktree reference '${selectedRef}'. Use a full branch name or full path.`);
  }

  throw new Error(`Unable to resolve worktree '${selectedRef}'. Run 'linchpin wt ls' to view available worktrees.`);
}

function safeRealpath(inputPath) {
  try {
    return fs.realpathSync(inputPath);
  } catch (_error) {
    return path.resolve(inputPath);
  }
}

function findGitAnchor(startPath) {
  let current = safeRealpath(startPath);

  try {
    if (!fs.statSync(current).isDirectory()) {
      current = path.dirname(current);
    }
  } catch (_error) {
    current = path.dirname(current);
  }

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function inferBaseRepoPath(startPath) {
  const anchor = findGitAnchor(startPath);
  if (!anchor) {
    return null;
  }

  const candidates = [anchor, safeRealpath(anchor)];
  for (const candidate of candidates) {
    const baseCandidate = stripWorktreeSuffix(candidate);
    if (!baseCandidate || baseCandidate === candidate) {
      continue;
    }

    if (!fs.existsSync(path.join(baseCandidate, '.git'))) {
      continue;
    }

    return safeRealpath(baseCandidate);
  }

  return null;
}

function inferBaseRepoPathFromWorktreeId(startPath) {
  const anchor = findGitAnchor(startPath);
  if (!anchor) {
    return null;
  }

  const gitdirPointer = readGitdirPointer(anchor);
  const worktreeId = extractWorktreeId(gitdirPointer);

  if (!worktreeId) {
    return null;
  }

  const repoName = path.basename(path.dirname(anchor));
  const parentRoot = path.dirname(path.dirname(anchor));
  const grandparentRoot = path.dirname(parentRoot);

  const agentScanRoots = getDefaultAgentScanRoots();
  const directCandidates = dedupePaths([
    path.join(parentRoot, repoName),
    path.join(grandparentRoot, repoName),
    path.join(os.homedir(), 'Documents', 'GitHub', repoName),
    path.join(os.homedir(), 'Documents', repoName),
    path.join(os.homedir(), repoName),
    ...agentScanRoots.map((root) => path.join(root, repoName))
  ]);

  for (const candidate of directCandidates) {
    if (hasWorktreeMetadata(candidate, worktreeId)) {
      return safeRealpath(candidate);
    }
  }

  const scanRoots = dedupePaths([
    parentRoot,
    grandparentRoot,
    path.join(os.homedir(), 'Documents', 'GitHub'),
    path.join(os.homedir(), 'Documents'),
    ...agentScanRoots
  ]);

  for (const root of scanRoots) {
    const fromRoot = findRepoWithWorktreeId(root, worktreeId);
    if (fromRoot) {
      return fromRoot;
    }
  }

  return null;
}

function readGitdirPointer(worktreePath) {
  const gitPath = path.join(worktreePath, '.git');

  let stat;
  try {
    stat = fs.lstatSync(gitPath);
  } catch (_error) {
    return null;
  }

  if (!stat.isFile()) {
    return null;
  }

  try {
    const content = fs.readFileSync(gitPath, 'utf8');
    const match = content.match(/^gitdir:\s*(.+)\s*$/m);
    return match ? match[1].trim() : null;
  } catch (_error) {
    return null;
  }
}

function extractWorktreeId(gitdirPointer) {
  if (!gitdirPointer || typeof gitdirPointer !== 'string') {
    return null;
  }

  const normalized = gitdirPointer.replace(/\\/g, '/');
  const match = normalized.match(/\/\.git\/worktrees\/([^/]+)$/);
  return match ? match[1] : null;
}

function hasWorktreeMetadata(repoPath, worktreeId) {
  if (!repoPath || !worktreeId) {
    return false;
  }

  return fs.existsSync(path.join(repoPath, '.git', 'worktrees', worktreeId));
}

function findRepoWithWorktreeId(rootPath, worktreeId) {
  let entries;
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (_error) {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(rootPath, entry.name);
    if (hasWorktreeMetadata(candidate, worktreeId)) {
      return safeRealpath(candidate);
    }
  }

  return null;
}

function dedupePaths(paths) {
  const seen = new Set();
  const results = [];

  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }

    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function stripWorktreeSuffix(repoPath) {
  let current = path.resolve(repoPath);

  while (true) {
    const basename = path.basename(current);
    const atIndex = basename.lastIndexOf('@');
    if (atIndex > 0) {
      const repoName = basename.slice(0, atIndex);
      return path.join(path.dirname(current), repoName);
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

module.exports = {
  dedupePaths,
  extractWorktreeId,
  findRepoWithWorktreeId,
  findGitAnchor,
  getBaseWorktreePath,
  getCurrentTopLevel,
  hasWorktreeMetadata,
  inferBaseRepoPath,
  inferBaseRepoPathFromWorktreeId,
  listWorktrees,
  parseWorktreePorcelain,
  readGitdirPointer,
  resolveWorktreeRef,
  safeRealpath
};
