'use strict';

import * as vscode from 'vscode';
import * as vsUtils from './vs-utils';
import { GitExtension, Ref, RefType, Repository } from '../types/git';

type RefMap = Map<string, Repository[]>;

interface GitContext {
  repos: Repository[];
  refNames: string[];
  refNamesMap: RefMap;
}

export function listRefNames(): GitContext {
  const repos = getRepos();
  const refNamesMap = new Map() as RefMap;
  repos.forEach((it) => registerRefNames(it, refNamesMap));

  const refNames = [...refNamesMap.keys()].sort();
  return { repos, refNames, refNamesMap };
}

export async function checkoutRef(refName: string, context: GitContext): Promise<void> {
  const reposWithRef = getReposWithRef(refName, context);
  await parallelize(reposWithRef, (repo) => checkoutRepoRef(repo, refName));

  const reposWithoutRef = getReposWithoutRef(refName, context);
  await parallelize(reposWithoutRef, (repo) => checkoutRepoRef(repo, getDefaultRefName()));
}

// -----------------------------------------------------------------------------
// HELPERS: GIT MUTATORS
// -----------------------------------------------------------------------------

async function checkoutRepoRef(repo: Repository, refName: string): Promise<void> {
  if (refName === simplifyRefName(repo.state.HEAD)) {
    return;
  }

  try {
    await repo.checkout(refName);
  } catch (err) {
    const path = repo.rootUri.fsPath;
    console.error(`Failed to checkout ref in folder ${path}. ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// HELPERS: GIT GETTERS
// -----------------------------------------------------------------------------

function getRepos(): Repository[] {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
  const api = gitExtension?.getAPI(1);
  return api ? api.repositories : [];
}

function getReposWithRef(refName: string, context: GitContext): Repository[] {
  return context.refNamesMap.get(refName) || [];
}

function getReposWithoutRef(refName: string, context: GitContext): Repository[] {
  const reposWithRef = new Set(context.refNamesMap.get(refName));
  return context.repos.filter((it) => !reposWithRef.has(it));
}

function getDefaultRefName(): string {
  return (vsUtils.getConfiguration().defaultBranchName as string) || 'master';
}

// -----------------------------------------------------------------------------
// HELPERS: REF MAPPING
// -----------------------------------------------------------------------------

function registerRefNames(repo: Repository, map: RefMap): void {
  const refNames = repo.state.refs.map(simplifyRefName).filter(isString);

  for (const refName of refNames) {
    let bucket = map.get(refName);
    if (!bucket) {
      bucket = [];
      map.set(refName, bucket);
    }

    bucket.push(repo);
  }
}

function simplifyRefName(ref?: Ref) {
  if (!ref || !ref.name) {
    return undefined;
  } else if (ref.type === RefType.Head) {
    return ref.name;
  } else if (ref.type === RefType.RemoteHead && ref.remote) {
    return ref.name?.slice(ref.remote.length + 1);
  }
}

// -----------------------------------------------------------------------------
// HELPERS: SYSTEM
// -----------------------------------------------------------------------------

async function parallelize<T>(repositories: Repository[], fn: (repo: Repository) => Promise<T>): Promise<T[]> {
  const promises = repositories.map(fn);
  return Promise.all(promises);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
