/* @flow */

const invariant = require('invariant');
const path = require('path');
const semver = require('semver');

import * as fs from '../../../util/fs.js';
import * as child from '../../../util/child.js';

export async function cloneOrUpdateRepository(
  remotePath: string,
  checkoutPath: string,
  params?: {branch?: string, onClone?: () => void, onUpdate?: () => void} = {},
) {
  const {onClone, onUpdate, branch = 'master'} = params;
  if (await fs.exists(checkoutPath)) {
    const localCommit = await gitReadMaster(checkoutPath, branch);
    const remoteCommit = await gitReadMaster(remotePath, branch);
    const curBranch = await defaultOnFailure(gitCurrentBranchName(checkoutPath), null);
    if (curBranch != branch) {
      await fs.unlink(checkoutPath);
      return cloneOrUpdateRepository(remotePath, checkoutPath, params);
    }
    if (localCommit !== remoteCommit) {
      if (onUpdate != null) {
        onUpdate();
      }
      await child.spawn(
        'git',
        ['pull', '--depth', '5', '-f', remotePath, `${branch}:${branch}`],
        {
          cwd: checkoutPath,
        },
      );
    }
  } else {
    if (onClone != null) {
      onClone();
    }
    await child.spawn('git', [
      'clone',
      '--branch',
      branch,
      '--depth',
      '5',
      remotePath,
      checkoutPath,
    ]);
  }
}

export async function gitReadMaster(repo: string, branch?: string = 'master') {
  const data = await child.spawn('git', ['ls-remote', repo, '-r', `heads/${branch}`]);
  const [commitId] = data.split('\t');
  return commitId.trim();
}

export async function gitCurrentBranchName(repo: string) {
  const data = await child.spawn('git', ['symbolic-ref', '-q', 'HEAD'], {cwd: repo});
  const fullBranchName = data.trim();
  const branchName = fullBranchName.replace(/^refs\/heads\//, '');
  return branchName;
}

export function stripVersionPrelease(version: string): string {
  const v = semver.parse(version);
  invariant(v != null, `Invalid version: ${version}`);
  v.prerelease = [];
  // $FlowFixMe: update semver typings
  return v.format();
}

async function defaultOnFailure(promise, defaultValue) {
  try {
    return await promise;
  } catch (_err) {
    return defaultValue;
  }
}
