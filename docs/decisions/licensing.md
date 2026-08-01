# Licensing decision boundary

## Status

OpenRecall is licensed under the **Apache License 2.0**. The complete,
unmodified license text is in [`../../LICENSE`](../../LICENSE), the project
attribution is in [`../../NOTICE`](../../NOTICE), and redistributed third-party
material is described in
[`../../THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## Why Apache-2.0

The owner selected Apache-2.0 because it is a permissive open-source license
that allows private and commercial use, modification, and redistribution while
also providing an explicit patent grant from contributors. Its notice and
changed-file obligations make the provenance of redistributed work clear
without imposing a reciprocal source-code requirement.

This decision is intentional; the build does not generate or substitute the
project license. Contributions submitted for inclusion are licensed under the
terms in section 5 of Apache-2.0 unless the contributor explicitly states
otherwise. OpenRecall does not require a separate contributor license agreement.

## Redistribution duties

Source and binary redistributors must follow Apache-2.0, including retaining the
license, relevant notices, and prominent change notices where required. The
Windows archive also contains Node.js and production npm dependencies, whose
own license terms remain applicable and are not replaced by Apache-2.0.

The exact dependency and asset inventory is recorded in
[`../releases/dependency-license-review.md`](../releases/dependency-license-review.md).
The official Node.js 24.18.0 distribution license and every recognized deployed
package license file are copied into the release archive. Packaging fails closed
if required legal material is absent or an unaudited dependency boundary is
encountered.

## Release gate

A public release must pass `pnpm release:licenses`, packaging-tree inspection,
and artifact smoke tests. Those technical checks support license compliance but
are not legal advice and do not waive any third-party obligation.
