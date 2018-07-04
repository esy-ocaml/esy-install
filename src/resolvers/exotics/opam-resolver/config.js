/* @flow */

const os = require("os");

export const OPAM_SCOPE = 'opam';

const isWindows = os.platform() === "win32";

const defaultRepository = isWindows ?
  'https://github.com/fdopen/opam-repository-mingw.git'
  : 'https://github.com/ocaml/opam-repository.git';

export const OPAM_REPOSITORY = process.env.ESY_OPAM_REPOSITORY
  ? process.env.ESY_OPAM_REPOSITORY
  : 'https://github.com/fdopen/opam-repository-mingw.git';

export const OPAM_REPOSITORY_OVERRIDE = process.env.ESY_OPAM_REPOSITORY_OVERRIDE
  ? process.env.ESY_OPAM_REPOSITORY_OVERRIDE
  : 'https://github.com/esy-ocaml/esy-opam-override.git';

export const OPAM_REPOSITORY_URLS = 'https://opam.ocaml.org/urls.txt';

export const OPAM_REPOSITORY_OVERRIDE_CHECKOUT =
  process.env.ESY_OPAM_REPOSITORY_OVERRIDE_CHECKOUT;
