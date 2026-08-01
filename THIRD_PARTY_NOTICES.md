# Third-party notices

OpenRecall is licensed under the Apache License 2.0. This file describes the
additional license material carried by the Windows binary distribution; it does
not replace or alter any third-party license.

## Node.js runtime

The Windows distribution bundles the official Node.js 24.18.0 Windows x64
runtime. Node.js is copyright the Node.js contributors and includes externally
maintained libraries under their respective terms. The complete, unmodified
license from that exact Node.js distribution is included at
`licenses/node/LICENSE` inside the archive.

Source and license reference:
<https://github.com/nodejs/node/blob/v24.18.0/LICENSE>

## Production npm dependencies

The packaged application contains only the production dependency graph created
from the committed `pnpm-lock.yaml`. Every deployed package's `LICENSE*`,
`COPYING*`, and `NOTICE*` material is copied under `licenses/npm/`, grouped by
package name and version. `docs/releases/dependency-license-review.md` records
the audited license-expression boundary, and `pnpm release:licenses` enforces it.

## OpenRecall assets

The OpenRecall icon source at `apps/web/assets/icon-source.svg` and its generated
PNG variants are original project assets and are distributed under the same
Apache License 2.0 as OpenRecall. Repository screenshots use synthetic study
content only.

## Redistribution rule

Release packaging fails closed when required OpenRecall, Node.js, or deployed
package license material is missing. Redistributors must retain the applicable
license and notice files and comply with each dependency's terms.
