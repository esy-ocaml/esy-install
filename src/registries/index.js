/* @flow */

import YarnRegistry from './yarn-registry.js';
import NpmRegistry from './npm-registry.js';
import EsyRegistry from './esy-registry.js';

export const registries = {
  esy: EsyRegistry,
  npm: NpmRegistry,
  yarn: YarnRegistry,
};

export const registryNames = Object.keys(registries);

export type RegistryNames = $Keys<typeof registries>;
export type ConfigRegistries = {
  esy: EsyRegistry,
  npm: NpmRegistry,
  yarn: YarnRegistry,
};
