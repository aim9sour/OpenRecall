# Licensing decision boundary

## Status

No license has been selected for OpenRecall, and no `LICENSE` file is present.
Under default copyright rules, publishing source code does not grant other
people permission to copy, modify, distribute, sublicense, or reuse it.

This documentation must not be read as a license or implied permission. The
repository may be reviewed privately by its owner and authorized collaborators,
but a public release, package publication, or invitation for general reuse is
blocked until the owner explicitly chooses a license.

## Why the decision is separate

A license determines permissions, warranty terms, patent treatment,
distribution duties, and compatibility with dependencies and contributions.
Those are owner/legal policy choices, not implementation details. The build
must therefore neither generate license text nor guess a permissive,
copyleft, source-available, or proprietary policy.

## Release gate

Before public publication, the owner must:

1. choose the intended sharing and contribution model;
2. review the recorded dependency and asset inventory in
   [`../releases/dependency-license-review.md`](../releases/dependency-license-review.md)
   for compatibility with the intended distribution;
3. select or obtain appropriate license text;
4. add the exact `LICENSE` and any required notices deliberately;
5. update both README files, contribution terms, and the release checklist.

Until those steps are explicit, all release documentation must state “no
license,” and automation must not tag or publish a public release.
