/* @flow */

const path = require('path');
const EsyOpam = require('@esy-ocaml/esy-opam');

import type Config from '../../../config';
import * as crypto from '../../../util/crypto.js';
import * as fs from '../../../util/fs.js';
import {cloneOrUpdateRepository} from './util.js';
import {OPAM_REPOSITORY, OPAM_SCOPE} from './config.js';
import type {OpamManifest} from './index.js';
import * as OpamRepositoryOverride from './opam-repository-override.js';

type OpamRepository = {
  checkoutPath: string,
  override: OpamRepositoryOverride.OpamRepositoryOverride,
};

let _initializing: ?Promise<OpamRepository> = null;

/**
 * Initialize opam overrides
 */
export function init(config: Config): Promise<OpamRepository> {
  if (_initializing == null) {
    _initializing = initImpl(config);
  }
  return _initializing;
}

export async function getManifestCollection(
  repository: OpamRepository,
  packageName: string,
) {
  const packageDir = path.join(repository.checkoutPath, 'packages', packageName);
  if (!await fs.exists(packageDir)) {
    throw new Error(`No package found in opam repository: @${OPAM_SCOPE}/${packageName}`);
  }

  const manifestCollection = await convertOpamToManifestCollection(
    repository,
    packageName,
    packageDir,
  );

  return manifestCollection;
}

async function initImpl(config) {
  const checkoutPath = path.join(config.cacheFolder, 'opam-repository');
  const onClone = () => {
    config.reporter.info('Cloning ocaml/opam-repository (this might take a while)...');
  };
  const onUpdate = () => {
    config.reporter.info(
      'Updating ocaml/opam-repository checkout (this might take a while)...',
    );
  };
  await cloneOrUpdateRepository(OPAM_REPOSITORY, checkoutPath, {
    onClone,
    onUpdate,
  });
  const override = await OpamRepositoryOverride.init(config);
  return {checkoutPath, override};
}

async function convertOpamToManifest(repository, name, spec, packageDir) {
  const [_, ...versionParts] = spec.split('.');
  const version = versionParts.join('.');
  const opamFilename = path.join(packageDir, spec, 'opam');
  const opamFile = EsyOpam.parseOpam(await fs.readFile(opamFilename));
  let manifest: OpamManifest = (EsyOpam.renderOpam(name, version, opamFile): any);
  normalizeManifest(manifest);
  manifest = OpamRepositoryOverride.applyOverride(repository.override, manifest);
  manifest._uid = crypto.hash(JSON.stringify(manifest));

  const urlFilename = path.join(packageDir, spec, 'url');
  if (!await fs.exists(urlFilename)) {
    return manifest;
  }

  const urlData = await fs.readFile(urlFilename);
  if (urlData != null) {
    const opamUrl = EsyOpam.parseOpamUrl(urlData);
    const url = EsyOpam.renderOpamUrl(opamUrl);
    let checksum = url.checksum.filter(h => h.kind === 'md5')[0];
    checksum = checksum ? checksum.contents : null;
    manifest.opam.url = url.url;
    manifest.opam.checksum = checksum;
  }

  const patchFilenames: Array<string> = (manifest: any)._esy_opam_patches;
  if (patchFilenames) {
    manifest.opam.patches = await Promise.all(
      patchFilenames.map(async basename => {
        const filename = path.join(packageDir, spec, 'files', basename);
        const content = await fs.readFile(filename);
        return {name: basename, content};
      }),
    );
  }

  return manifest;
}

async function convertOpamToManifestCollection(repository, name, packageDir) {
  const versionDirList = await fs.readdir(packageDir);
  const manifestList = await Promise.all(
    versionDirList.map(versionDir =>
      convertOpamToManifest(repository, name, versionDir, packageDir),
    ),
  );
  const manifestCollection = {name, versions: {}};
  for (const manifest of manifestList) {
    manifestCollection.versions[manifest.version] = manifest;
  }
  return manifestCollection;
}

function normalizeManifest(manifest) {
  manifest.esy = manifest.esy || {};
  manifest.esy.exportedEnv = manifest.esy.exportedEnv || {};
  manifest.opam = manifest.opam || {};
  manifest.opam.url = manifest.opam.url || null;
  manifest.opam.checksum = manifest.opam.checksum || null;
  manifest.opam.files = manifest.opam.files || [];
  manifest.opam.patches = manifest.opam.patches || [];
}
