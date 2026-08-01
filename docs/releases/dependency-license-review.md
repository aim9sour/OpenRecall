# Dependency license and asset review

Audit date: 2026-08-01

This review is generated from the exact installed dependency graph behind the
committed pnpm lockfile. Counts below describe the audited Windows x64 install;
pnpm selects different optional native packages on other operating systems.
The CI gate reviews the declared expressions on each installed platform.
OpenRecall itself is licensed under Apache-2.0; this inventory addresses the
separate terms of dependencies and assets and is not legal advice.

## Reproducible gate

Run:

```bash
pnpm install --frozen-lockfile
pnpm release:licenses
```

The gate asks pnpm for both `--prod` and complete installed-package license
reports. It fails when a new license expression has not been reviewed, and it
has a narrower allowlist for production dependencies. A package update that
changes a declared license therefore requires an explicit policy review rather
than silently passing CI.

## Production dependency scope

The current `pnpm licenses list --prod --json` report contains 95 entries. All
are under the following reviewed permissive license expressions:

| License expression | Entries |
| --- | ---: |
| Apache-2.0 | 3 |
| BSD-3-Clause | 3 |
| BlueOak-1.0.0 | 5 |
| ISC | 6 |
| MIT | 78 |

No MPL, LGPL, GPL, AGPL, or Creative Commons dependency appears in pnpm's
production scope at this baseline. This is an inventory statement, not a legal
compatibility conclusion.

## Development-only reviewed expressions

The complete development graph contains 524 entries. In addition to the
production-approved expressions and other permissive variants, the following
categories need attention if OpenRecall ever distributes its development
dependency tree or prebuilt tooling:

| Expression | Current packages | Current use |
| --- | --- | --- |
| Apache-2.0 AND LGPL-3.0-or-later | `@img/sharp-win32-x64` | Windows-native image-generation binary used by build/test tooling |
| LGPL-3.0-or-later | `@img/sharp-libvips-linux-*` | Linux-native libvips binaries selected only on their matching build/test platform |
| MPL-2.0 | `@axe-core/playwright`, `axe-core`, `ico-endec`, `lightningcss`, `lightningcss-win32-x64-msvc` | Accessibility and build tooling |
| CC-BY-4.0 | `caniuse-lite` | Browser-compatibility build data |

The Linux-specific libvips packages are present in the cross-platform lockfile
but are not installed in this Windows count. These packages are not reported by
pnpm in the production scope on their applicable platform. Their own licenses
still apply to anyone who installs or redistributes them. The Windows archive
does not ship the development dependency tree or build toolchain.

## Repository assets

No third-party font, photograph, audio, video, or icon set is tracked. The PWA
PNG icons are deterministically generated during the build from
`apps/web/assets/icon-source.svg`, the project-owned source artwork. Card
examples contain only synthetic plain text.

## Selected project license and release boundary

The owner selected Apache-2.0 for OpenRecall. This review does not relicense any
dependency or asset. The Windows packager must include the complete Node.js
distribution license, preserve recognized license and notice files from every
deployed production package, and fail when required material is missing. See
`LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md` at the repository root.
