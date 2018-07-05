/**
 * @flow
 */

import type {FetchedOverride} from '../types.js';

const nodeCrypto = require('crypto');
const os = require("os");
import * as nodeFs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import * as http from 'http';
import * as tarFs from 'tar-fs';
import gunzip from 'gunzip-maybe';
import invariant from 'invariant';

import {SecurityError} from '../errors.js';
import type {OpamManifest} from '../resolvers/exotics/opam-resolver';
import {lookupManifest, parseReference} from '../resolvers/exotics/opam-resolver';
import TarballFetcher from '../fetchers/tarball-fetcher.js';
import * as constants from '../constants.js';
import * as fs from '../util/fs.js';
import * as child from '../util/child.js';
import DecompressZip from 'decompress-zip';

// We don't want to bundle `esy-bash` with the built webpack bundle,
// so we use `__non_webpack_require__`
const { bashExec, toCygwinPath } = __non_webpack_require__("esy-bash");

const isWindows = os.platform() === "win32";

export default class OpamFetcher extends TarballFetcher {
  getTarballMirrorPath(): ?string {
    const filename = this.getTarballFilename();
    return this.config.getOfflineMirrorPath(filename);
  }

  getTarballFilename(): string {
    const reference = parseReference(this.remote.reference);
    const filename =
      reference.scope != null
        ? `@${reference.scope}-${reference.name}@${reference.version}-${reference.uid}.tgz`
        : `${reference.name}@${reference.version}-${reference.uid}.tgz`;
    return filename;
  }

  async fetchFromExternal(): Promise<FetchedOverride> {
    const {dest: destPath} = this;
    const reference = parseReference(this.remote.reference);
    const manifest = await lookupManifest(reference.name, reference.version, this.config);
    let hash = this.hash || '';

    let tempPath = await fs.makeTempDir('esy-install');

    // If we have an URL to fetch we fetch & extract it in staging dir
    const {url, checksum} = manifest.opam;
    if (url != null) {
      const tarballFormat = getTarballFormatFromFilename(url);
      const opamTarballPath = path.join(tempPath, 'opam-tarball.tgz');
      hash = await this.fetchOpamTarball(url, checksum, opamTarballPath);
      await unpackOpamTarball(opamTarballPath, tempPath, tarballFormat);
      const [dirname] = (await fs.readdir(tempPath)).filter(
        name => name !== 'opam-tarball.tgz',
      );
      tempPath = path.join(tempPath, dirname);
      await fs.unlink(opamTarballPath);
    }

    // Create missing pieces from opam metadata
    await writeJson(path.join(tempPath, 'package.json'), manifest);
    await writeFiles(tempPath, manifest.opam.files);
    await applyPatches(tempPath, manifest.opam.patches);

    // Now we pack into a standard tarball format (standard means npm/yarn
    // understands it)
    const tempTarballPath = this.config.getTemp(this.getTarballFilename());
    await packDirectory(tempPath, tempTarballPath);

    // Put tarball into cache dir & unpack it there
    await fs.mkdirp(destPath);
    const destTarballPath = path.join(destPath, constants.TARBALL_FILENAME);
    await fs.rename(tempTarballPath, destTarballPath);
    await unpackTarball(destTarballPath, destPath);

    // Copy to offline mirror if needed
    const tarballMirrorPath = this.getTarballMirrorPath();
    if (tarballMirrorPath != null) {
      await fs.copy(destTarballPath, tarballMirrorPath, this.reporter);
    }

    const fetchOverride = {hash, resolved: null};
    return fetchOverride;
  }

  fetchOpamTarball(url: string, checksum: ?string, filename: string): Promise<string> {
    const registry = this.config.registries[this.registry];
    return registry.request(url, {
      headers: {
        'Accept-Encoding': 'gzip',
        Accept: 'application/octet-stream',
      },
      buffer: true,
      process: (req, resolve, reject) => {
        const {reporter} = this.config;

        const handleRequestError = res => {
          if (res.statusCode >= 400) {
            const statusDescription = http.STATUS_CODES[res.statusCode];
            reject(
              new Error(
                reporter.lang('requestFailed', `${res.statusCode} ${statusDescription}`),
              ),
            );
          }
        };

        req.on('response', handleRequestError);
        writeValidatedStream(req, filename, checksum).then(resolve, reject);
      },
    });
  }
}

function writeValidatedStream(stream, filename, md5checksum = null): Promise<string> {
  const hasher = nodeCrypto.createHash('md5');
  return new Promise((resolve, reject) => {
    const out = nodeFs.createWriteStream(filename);
    stream
      .on('data', chunk => {
        if (md5checksum != null) {
          hasher.update(chunk);
        }
      })
      .pipe(out)
      .on('error', err => {
        reject(err);
      })
      .on('finish', () => {
        const actualChecksum = hasher.digest('hex');
        if (md5checksum != null) {
          if (actualChecksum !== md5checksum) {
            reject(
              new SecurityError(
                `Incorrect md5sum (expected ${md5checksum}, got ${actualChecksum})`,
              ),
            );
            return;
          }
        }
        resolve(actualChecksum);
      });
    if (stream.resume) {
      stream.resume();
    }
  });
}

function writeJson(filename, object): Promise<void> {
  const data = JSON.stringify(object, null, 2);
  return fs.writeFile(filename, data, {encoding: 'utf8'});
}

async function unpackOpamTarball(
  filename,
  dest,
  format: 'gzip' | 'bzip' | 'zip' | 'xz',
): Promise<void> {
  if (format === 'zip') {
    await extractZip(filename, dest);
  } else {
    const unpackOptions = format === 'gzip' ? '-xzf' : format === 'xz' ? '-xJf' : '-xjf';

    if (isWindows) {
        // On Windows, we use the 'esy-bash' cygwin environment, since `tar` doesn't come out of the box.
        // Note that `tar` is one command that requires the paths to be in the Cygwin-format vs the Windows format.
        await bashExec(`tar ${unpackOptions} ${toCygwinPath(filename)} -C ${toCygwinPath(dest)}`);
    } else {
        await child.exec(`tar ${unpackOptions} ${filename} -C ${dest}`);
    }
  }
}

function extractZip(filename, dest): Promise<void> {
  let seenError = false;
  return new Promise((resolve, reject) => {
    const unzipper = new DecompressZip(filename);
    unzipper.on('error', err => {
      if (!seenError) {
        seenError = true;
        reject(err);
      }
    });

    unzipper.on('extract', () => {
      resolve();
    });

    unzipper.extract({
      path: dest,
    });
  });
}

function getTarballFormatFromFilename(filename): 'gzip' | 'bzip' | 'zip' | 'xz' {
  if (filename.endsWith('.tgz') || filename.endsWith('.tar.gz')) {
    return 'gzip';
  } else if (
    filename.endsWith('.tar.bz') ||
    filename.endsWith('.tar.bz2') ||
    filename.endsWith('.tbz')
  ) {
    return 'bzip';
  } else if (filename.endsWith('.zip')) {
    return 'zip';
  } else if (filename.endsWith('.xz')) {
    return 'xz';
  } else {
    // XXX: default to gzip? Is this safe?
    return 'gzip';
  }
}

async function writeFiles(dest, files) {
  if (files.length === 0) {
    return;
  }
  const writes = files.map(async file => {
    const filename = path.join(dest, file.name);
    await fs.mkdirp(path.dirname(filename));
    await fs.writeFile(path.join(dest, file.name), file.content, {
      encoding: 'utf8',
    });
  });
  await Promise.all(writes);
}

async function applyPatches(dest, patches) {
  for (const patch of patches) {
    const patchFilename = path.join(dest, patch.name);
    await fs.writeFile(patchFilename, patch.content, {encoding: 'utf8'});
    try {
      if (isWindows) {
          await bashExec(`patch -p0 -i ${patchFilename}`, {
            cwd: dest,
            stdio: 'inherit',
          });
      } else {
          await child.exec(`bash -c "patch -p1 < ${patchFilename}"`, {
             cwd: dest,
             stdio: 'inherit',
           });
      }
    } finally {
      await fs.unlink(patchFilename);
    }
  }
}

function packDirectory(directory, tarballPath) {
  return new Promise((resolve, reject) => {
    tarFs
      .pack(directory, {
        map: header => {
          const suffix = header.name === '.' ? '' : `/${header.name}`;
          header.name = `package${suffix}`;
          delete header.uid;
          delete header.gid;
          return header;
        },
      })
      .on('error', onStreamError(reject, `packing ${tarballPath}`))
      .pipe(new zlib.Gzip())
      .on('error', onStreamError(reject, `compressing ${tarballPath}`))
      .pipe(nodeFs.createWriteStream(tarballPath))
      .on('error', onStreamError(reject, `writing tarball ${tarballPath}`))
      .on('finish', () => {
        resolve();
      });
  });
}

function unpackTarball(tarballPath, directory) {
  return new Promise((resolve, reject) => {
    const inputStream = nodeFs.createReadStream(tarballPath);
    const extractorStream = gunzip();
    const untarStream = tarFs.extract(directory, {
      strip: 1,
      dmode: 0o755, // all dirs should be readable
      fmode: 0o644, // all files should be readable
      chown: false, // don't chown. just leave as it is
    });

    inputStream
      .on('error', onStreamError(reject, `reading ${tarballPath}`))
      .pipe(extractorStream)
      .on('error', onStreamError(reject, `decompressing ${tarballPath}`))
      .pipe(untarStream)
      .on('error', onStreamError(reject, `unpacking ${tarballPath}`))
      .on('finish', () => {
        resolve();
      });
  });
}

function onStreamError(reject, state) {
  return error => {
    error.message = `${error.message} (${state})`;
    reject(error);
  };
}
