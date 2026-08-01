# Dependency license and asset review

Audit date: 2026-08-01

This review is generated from the exact installed dependency graph behind the
committed pnpm lockfile. Counts below describe the audited Windows x64 install;
pnpm selects different optional native packages on other operating systems.
The CI gate reviews the declared expressions on each installed platform. This
prepares the repository owner's later licensing decision; it does not select or
imply a license for OpenRecall itself and is not legal advice.

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
still apply to anyone who installs or redistributes them. Before shipping
`node_modules`, a packaged toolchain, or third-party binaries, review the exact
upstream license texts and attribution/notice duties for that distribution
format.

## Repository assets

No third-party font, photograph, audio, video, or icon set is tracked. The PWA
PNG icons are deterministically generated during the build from
`apps/web/assets/icon-source.svg`, the project-owned source artwork. Card
examples contain only synthetic plain text.

## Owner decision still required

This audit completes the dependency-and-asset inventory step only. The owner
must still choose the intended sharing model, select the project license, add
the exact `LICENSE` and any required notices, and update publication language
before a public release is authorized.
