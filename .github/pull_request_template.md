## Summary

Describe the user-visible outcome and the reason for the change.

## Verification

- [ ] I ran `pnpm verify:full` sequentially, or documented the exact relevant
  gates and why the full command was not applicable.
- [ ] I verified migrations and backup/restore when storage changed.
- [ ] I checked both RTL and LTR layouts when the interface changed.
- [ ] I checked keyboard use, focus order, live announcements, and NVDA behavior when interaction changed.
- [ ] I built and smoked both normal and portable release modes when packaging changed.
- [ ] I inspected the packaged artifact for databases, logs, traces, source maps, secrets, and required license files.
- [ ] I updated `CHANGELOG.md` or explained why the change has no release-note impact.

## Release and artifact impact

Describe effects on `OpenRecall.cmd`, `OpenRecall-Portable.cmd`, data locations,
bundled runtime files, third-party notices, checksums, and provenance. Write
“not applicable” when the change cannot affect a release artifact.

## High-risk dependency changes

- [ ] I read and linked the upstream changelog.
- [ ] I updated adapter fixtures for scheduler or optimizer changes.
- [ ] I verified database migration and backup compatibility.

Use “not applicable” with a short reason for any unchecked item.
