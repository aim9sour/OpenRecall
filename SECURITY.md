# Security policy

OpenRecall is an unreleased, local-only application. Security fixes target the
current main branch; no historical public release line is supported yet.

## Report a vulnerability

Use GitHub private vulnerability reporting for this repository. Include a
minimal reproduction using synthetic data, the affected commit, and the
expected impact. Do not open a public issue for an unpatched vulnerability and
do not upload a real OpenRecall SQLite file, card content, logs, secrets, or
machine paths.

No disclosure email address has been designated. GitHub private vulnerability
reporting is the responsible-disclosure channel until the repository owner
publishes another channel.

## Security boundary

- The production server binds only to `127.0.0.1:3210` and accepts the fixed
  same-origin authority.
- State-changing requests require the expected Origin and a per-process CSRF
  token.
- Browser and server security headers restrict scripts, connections, framing,
  MIME sniffing, and referrers.
- Normal runtime has no outbound DNS, telemetry, CDN, font, analytics, or cloud
  dependency.
- Cards are plain text. HTML-like markup and executable/rich media content are
  rejected; Markdown characters have no formatting semantics and remain
  literal text.
- Logs are content-free and use stable codes. PWA caches exclude API responses
  and private card data.
- Upload size, path containment, SQLite identity, schema version, integrity,
  and foreign keys are validated before restore.

## Sensitive artifacts

Treat the live database, downloaded backups, browser profiles, screenshots,
traces, crash dumps, and terminal captures as sensitive. A safe bug report uses
generated fixture cards and removes usernames and absolute paths. CI may upload
only synthetic, reviewed traces.

## Dependency and algorithm reports

Scheduler, optimizer, SQLite, Fastify, React, PWA, and build-tool updates are
security-sensitive. Reports must identify the exact package version and whether
stored state, migrations, replay, backup/restore, CSP, or local-only behavior
changes. FSRS-7 is unsupported until it passes the documented adapter release
gates.
