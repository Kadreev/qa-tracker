# Security

`qa-tracker serve` runs a local HTTP server that can write to files in your
repository. By default it binds to 127.0.0.1 and accepts edits only as
same-origin JSON requests with a loopback `Host`. `--host` and
`--allow-any-host` relax that; use them only on a network you trust.

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/Kadreev/qa-tracker/security/advisories/new)
rather than in a public issue.
