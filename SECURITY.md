# Security Policy

## Scope

Security issues affecting the FlightTrackr Web application are in scope, especially authentication bypasses in future sync features, secret exposure, server-side request vulnerabilities, injection, and privacy leaks.

## Secret handling

Never commit API keys, OAuth client secrets, passwords, session tokens, cookies, or `.env` files. Provider credentials belong in the hosting platform's secret/environment-variable store or in a local ignored file during development.

The OpenSky client credentials supplied during development are treated as sensitive and are not embedded in source code, browser JavaScript, static assets, or documentation.

## Reporting

Please report suspected vulnerabilities privately through the repository's GitHub security reporting mechanism rather than opening a public issue with exploitable details.

## Design expectations

- Personal flight history must remain local by default.
- New server-side persistence must be explicit, documented, and protected.
- New external providers must be reviewed for licensing, privacy, and rate-limit terms before being enabled in the public deployment.
- Any future account/sync capability should use secure passwordless or OAuth authentication, encrypted transport, secure cookies, CSRF protection where applicable, and encrypted-at-rest user data.
