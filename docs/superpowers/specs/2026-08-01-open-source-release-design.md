# OpenRecall Open-Source Release Design

## Objective

Publish OpenRecall as a polished public repository at
`https://github.com/aim9sour/OpenRecall` and ship a stable `v1.0.0` Windows
release. The repository must be understandable to users and contributors,
while the release must run without requiring users to install Node.js, pnpm,
or development tools.

The release is blocked until all Linux and Windows release gates pass,
including the two Linux reflow failures currently reproduced at a 320-pixel
viewport.

## Ownership and repository identity

- Git author and committer identity: `Abdullah Mansour`.
- Verified GitHub email: `abdullahmansour.marketing@gmail.com`.
- GitHub owner: `aim9sour`.
- Repository name: `OpenRecall`.
- Visibility: public.
- Default branch: `main`.
- First public release: stable `v1.0.0`, not a prerelease.

The existing Git history already uses the required name and email, so history
must not be rewritten.

## License and redistribution

OpenRecall source code and project documentation will use the Apache License,
Version 2.0. The repository will contain:

- the unmodified Apache 2.0 text in `LICENSE`;
- a concise `NOTICE` naming OpenRecall and Abdullah Mansour;
- an updated licensing decision that records the selected policy;
- package metadata and both README files identifying `Apache-2.0`;
- third-party notices for every component redistributed in the Windows ZIP.

Apache 2.0 is selected over MIT and 0BSD because it remains permissive while
adding an explicit contributor patent grant and clear redistribution terms.
This is a project policy choice, not legal advice.

The Windows distribution includes an official Node.js binary and production
dependencies. It must include the Node.js license and all notices required by
the audited production dependency inventory. The release workflow must fail
closed when a required license cannot be classified or included.

## Windows distribution

GitHub Releases will provide one primary artifact:

`OpenRecall-v1.0.0-windows-x64.zip`

The archive contains the built web client and server, the exact production
dependencies, the official Node.js 24.18.0 Windows x64 runtime, project and
third-party license files, a short release README, and two launchers:

1. `OpenRecall.cmd` starts normal mode. Application data remains in
   `%LOCALAPPDATA%\OpenRecall-nodejs\Data`.
2. `OpenRecall-Portable.cmd` starts portable mode. Application data is stored
   in `Data` beside the launcher.

Both launchers use one shared PowerShell implementation. The launcher starts
the bundled Node executable, waits for the existing `OPENRECALL_READY` signal,
and opens `http://127.0.0.1:3210` in Google Chrome. If Chrome cannot be located,
it opens the fixed URL with the system browser and prints a clear diagnostic.
Normal and portable mode never migrate or merge each other's data
automatically.

Portable mode requires an extracted, user-writable directory. Documentation
must warn against running it from inside the ZIP, `Program Files`, read-only
media, or an unreliable synchronized directory. Moving the complete extracted
folder moves portable data; copying only the executable files does not.

The archive must never contain development dependencies, source maps, test
fixtures, real databases, logs, traces, user paths, credentials, or private
card content.

## Packaging architecture

One repository script owns the distribution layout. It performs these bounded
steps:

1. verify exact Node.js and pnpm versions;
2. build every production workspace;
3. create a clean staging directory;
4. deploy only the server and production workspace dependencies;
5. place the built web client where the production server expects it;
6. download the official Node.js 24.18.0 Windows x64 archive and verify its
   published SHA-256 digest;
7. copy only the required Node runtime files;
8. generate the third-party notice inventory from audited lockfile data;
9. add launchers, README, `LICENSE`, and `NOTICE`;
10. inspect the staged tree for forbidden artifacts;
11. create the versioned ZIP and SHA-256 file.

The script accepts explicit input and output directories for tests and CI. It
must not delete or overwrite an unresolved path, repository root, user data
directory, or existing release artifact.

## Repository presentation

The English README remains the GitHub landing page and links to a complete
Arabic README. Both use the same information architecture:

1. concise product statement and language switch;
2. restrained badges for the stable release, Linux CI, Windows CI, license,
   Node baseline, and accessibility;
3. one synthetic-data application screenshot;
4. prominent Windows release download and two-launcher explanation;
5. privacy and local-only guarantees;
6. core features, including FSRS-6, smart variants, continuous due review,
   SQLite backup/restore, localization, and screen-reader interaction;
7. developer setup and verification;
8. links to import, architecture, contribution, support, security, changelog,
   and license documents;
9. honest v1 limitations.

The repository also receives a 1280-by-640 social preview derived from the
existing OpenRecall visual identity and synthetic UI content. Screenshots and
preview assets must not contain real cards, databases, usernames, absolute
paths, tokens, or browser profile information.

Repository description:

> Local-first, screen-reader-accessible spaced repetition with FSRS-6, smart
> card variants, SQLite, Arabic and English.

Repository topics:

`spaced-repetition`, `flashcards`, `fsrs`, `accessibility`, `screen-reader`,
`nvda`, `sqlite`, `local-first`, `arabic`, `react`, `typescript`, `pwa`.

## Community files

The repository will include:

- structured issue forms for general bugs, accessibility/screen-reader bugs,
  and feature requests;
- an issue chooser that disables blank public issues and directs
  vulnerabilities to GitHub private vulnerability reporting;
- the existing pull-request template, updated for release packaging and both
  data modes;
- `CONTRIBUTING.md` updated for the public Apache-2.0 contribution model;
- `SECURITY.md` updated for a supported `v1.x` line and private reporting;
- `CODE_OF_CONDUCT.md` using Contributor Covenant 3.0;
- `SUPPORT.md` separating usage questions from bugs and security reports;
- `CHANGELOG.md` finalized for `1.0.0` with the actual release date only when
  the release is published.

Issue forms must request synthetic reproductions and explicitly warn users not
to upload SQLite databases, real card text, logs containing paths, or private
screen-reader speech history.

## Automation and repository security

The existing Linux and Windows workflows remain the primary release gates.
They will be completed with:

- dependency review for pull requests;
- CodeQL scanning for JavaScript and TypeScript;
- Dependabot for npm and GitHub Actions;
- a Windows release workflow triggered by a semantic version tag;
- artifact SHA-256 generation and GitHub build provenance attestation;
- a smoke test that starts the staged normal distribution;
- a smoke test that starts portable mode and proves its database is created
  only in the staged `Data` directory;
- package-content assertions before artifact upload.

Third-party GitHub Actions must use maintained major versions verified against
their official repositories. Dependabot will keep those references current.
Every workflow gets the minimum permissions needed by its steps.

After the initial push, repository settings will enable Issues, Discussions,
private vulnerability reporting, Dependabot alerts and security updates,
available secret scanning and push protection, automatic head-branch deletion,
and squash merging. A `main` ruleset requires the relevant CI checks for pull
requests while allowing the repository owner an emergency bypass.

The release must be assembled as a draft, receive every asset, and only then be
published. Release immutability will be enabled when available for the account.

## Linux reflow correction

Chromium on Linux gives `input[type="date"]` a larger intrinsic minimum width
than the audited Windows Chrome baseline. The implicit Grid track in
`.filter-form` expands to that minimum and causes the statistics page to reach
330 pixels in a 320-pixel viewport.

The fix will explicitly constrain the filter form's Grid track with
`minmax(0, 1fr)` and keep controls at a shrinkable inline size. A focused test
must prove that the form can shrink without changing keyboard order, labels,
native date semantics, RTL behavior, or focus handling. Both previously
failing English Playwright cases and the complete accessibility suite must pass
on Linux before publication.

## Verification and release sequence

Verification is sequential within each checkout:

1. focused tests for reflow and packaging;
2. `pnpm verify`;
3. Linux production smoke and complete Playwright suite;
4. Windows production build, unit/integration gates, stable Chrome Playwright,
   and distribution smoke tests;
5. inspection of the exact final ZIP and its license inventory;
6. manual Chrome/NVDA confirmation supplied by the owner for Arabic and
   English critical review flows.

Publication order:

1. finish and review all repository changes;
2. make the working tree clean and ensure every commit uses the approved
   identity;
3. rename the branch to `main`;
4. create `aim9sour/OpenRecall` as a public repository and push complete
   history;
5. apply repository metadata, labels, security settings, and rules;
6. wait for required GitHub Actions to pass;
7. create and push annotated tag `v1.0.0`;
8. let the release workflow build and test the ZIP;
9. publish the completed stable release and verify its downloadable assets,
   checksum, and attestation.

If any gate, staged launcher, archive inspection, or GitHub workflow fails,
the repository may remain public but `v1.0.0` must not be published until the
failure is understood and corrected.

## Explicit non-goals

- No MSI installer, code-signing certificate, native desktop wrapper, Node
  single-executable application, auto-updater, cloud service, or package
  registry publication in this release.
- No Linux binary archive in `v1.0.0`; Linux remains supported from source and
  through CI.
- No automatic transfer between normal and portable data directories.
- No telemetry, remote runtime dependency, or update process that bypasses
  the existing safe PWA update boundary.

## Primary references

- Apache Software Foundation, “Applying the Apache License, Version 2.0”:
  <https://www.apache.org/legal/apply-license>
- Node.js license and bundled third-party notices:
  <https://github.com/nodejs/node/blob/main/LICENSE>
- GitHub issue templates and forms:
  <https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates>
- GitHub dependency review:
  <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action>
- GitHub artifact attestations:
  <https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>
- GitHub immutable releases:
  <https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>
- Contributor Covenant 3.0:
  <https://www.contributor-covenant.org/version/3/0/code_of_conduct/>
