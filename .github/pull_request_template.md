## Summary

Describe the user-visible outcome and the reason for the change.

## Verification

- [ ] I ran `pnpm verify:full` sequentially, or documented the exact relevant
  gates and why the full command was not applicable.
- [ ] I verified migrations and backup/restore when storage changed.
- [ ] I checked both RTL and LTR layouts when the interface changed.
- [ ] I checked keyboard use, focus order, live announcements, and NVDA behavior when interaction changed.

## High-risk dependency changes

- [ ] I read and linked the upstream changelog.
- [ ] I updated adapter fixtures for scheduler or optimizer changes.
- [ ] I verified database migration and backup compatibility.

Use “not applicable” with a short reason for any unchecked item.
