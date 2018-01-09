/**
 * Fetch https://opam.ocaml.org/urls.txt and cache data about prepared tarballs
 * and their checksums.
 *
 * @flow
 */

import * as path from 'path';
import {OPAM_REPOSITORY_URLS} from './config.js';
import * as fs from '../../../util/fs.js';
import _request from 'request';
import type Config from '../../../config.js';

export type URLIndex = {
  cacheKey: string,
  archives: {
    [opamName: string]: {
      [opamVersion: string]: {
        checksum: string,
        url: string,
      },
    },
  },
};

export async function resolve(
  index: URLIndex,
  opamName: string,
  opamVersion: string,
): Promise<?{checksum: string, url: string}> {
  let item = index.archives[opamName];
  if (item == null) {
    return null;
  }
  item = item[opamVersion];
  if (item == null) {
    return null;
  }
  return item;
}

function request(options) {
  return new Promise((resolve, reject) => {
    _request(options, (error, response, body) => {
      if (error) {
        reject(error);
      } else {
        resolve({response, body});
      }
    });
  });
}

export async function fetchIndex(config: Config): Promise<URLIndex> {
  async function _fetchAndCache() {
    config.reporter.info('Fetching OPAM URL index...');
    const {response, body} = await request({method: 'GET', uri: OPAM_REPOSITORY_URLS});
    const archives = parseArchives(body);
    const index: URLIndex = {
      cacheKey: responseToIndexCacheKey(response),
      archives,
    };
    const data = JSON.stringify(index);
    await fs.writeFile(cachePath, data);
    return index;
  }
  const cachePath = path.join(config.cacheFolder, 'opam-urls');
  if (!await fs.exists(cachePath)) {
    return _fetchAndCache();
  } else {
    const index: URLIndex = await fs.readJson(cachePath);
    const {response} = await request({method: 'HEAD', uri: OPAM_REPOSITORY_URLS});
    if (responseToIndexCacheKey(response) !== index.cacheKey) {
      return _fetchAndCache();
    } else {
      return index;
    }
  }
}

export function parseArchives(data: string) {
  // archives/0install.2.10+opam.tar.gz c65d2d26792ad4d51e0c88ae5d41cc5a 0o664
  const lines = data.split('\n');
  const archives = {};
  const re = /archives\/([^.]+)\.(.+)\+opam\.tar\.gz ([a-fA-F0-9]+)/;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.startsWith('archives/')) {
      continue;
    }
    var m = re.exec(line);
    if (m == null) {
      continue;
    }
    var opamName = m[1];
    var opamVersion = m[2];
    var checksum = m[3];
    var url = `https://opam.ocaml.org/archives/${opamName}.${opamVersion}+opam.tar.gz`;
    var item = archives[opamName];
    if (item == null) {
      item = {};
      archives[opamName] = item;
    }
    item[opamVersion] = {url, checksum};
  }
  return archives;
}

function responseToIndexCacheKey(response) {
  return response.headers['last-modified'] + '__' + response.headers['content-length'];
}
