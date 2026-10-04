'use strict';
const fs = require('fs');
const path = require('path');

class PathError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PathError';
    this.status = status;
  }
}

/** true when `target` is `root` itself or lives under it (purely lexical). */
function isInside(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/**
 * Resolve a user supplied, root-relative path to an absolute path that is
 * guaranteed to stay inside `root`, including after following symlinks.
 * A leading "/" is treated as "root", never as the filesystem root.
 */
function resolveInside(root, userPath) {
  if (typeof userPath !== 'string' || userPath === '') {
    throw new PathError('path is required', 400);
  }
  if (userPath.includes('\0')) throw new PathError('invalid path', 400);

  let rootReal;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    throw new PathError('folder not found', 404);
  }

  const abs = path.resolve(rootReal, userPath.replace(/^[/\\]+/, ''));
  if (!isInside(rootReal, abs)) throw new PathError('path escapes folder', 403);

  // Follow symlinks for whatever part of the path already exists.
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== rootReal) probe = path.dirname(probe);
  const probeReal = fs.realpathSync(probe);
  if (!isInside(rootReal, probeReal)) throw new PathError('path escapes folder', 403);

  const rel = path.relative(rootReal, abs).split(path.sep).join('/');
  return { abs, rel, root: rootReal };
}

module.exports = { resolveInside, isInside, PathError };
