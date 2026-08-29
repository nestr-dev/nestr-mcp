# Security

## Reporting a vulnerability

Email **dev@nestr.io**. Please do not open a public issue for a suspected
vulnerability. We aim to acknowledge within two working days.

Include the affected version, the surface (`/mcp`, `/mcp/readonly`,
`/mcp/public`, or stdio), and enough detail to reproduce.

## What this server is

`@nestr/mcp` exposes a Nestr workspace to an MCP client. It holds no data of its
own: every request is executed against the Nestr API, which applies the
permission model described below. This server adds no permissions of its own and
stores no workspace data.

## Authentication

Two mechanisms, both carried per request:

- **OAuth 2.1** with PKCE (S256), for interactive clients. Tokens are issued by
  Nestr, and the server proxies the authorization and token endpoints. An OAuth
  session acts **as the signed-in user, with exactly that user's permissions**.
- **Workspace API keys** (`X-Nestr-API-Key`), for headless and server-to-server
  use. Generated in the Nestr UI under Settings > Integrations > Workspace API
  access, and revocable there.

## Workspace API keys are workspace-wide. Read this before issuing one.

A workspace API key is **not** scoped to the permissions of the person who
created it. It carries full access to its workspace regardless of user
permissions, and every action is attributed to the key rather than to a user, so
audit trails carry no user identity for key-driven activity.

The practical consequences:

- **Treat a workspace API key as a workspace-level credential.** Issuing it from
  a restricted account does not restrict it.
- **Prefer OAuth** for anything acting on behalf of a person. It is bounded by
  that person's permissions and it preserves user identity in audit trails.
- **Prefer `/mcp/readonly`** for any integration that only needs to read.
- **Rotate keys** when someone with access to one leaves, and revoke rather than
  leave dormant keys in place.

Per-tool scoping on a key is not implemented. If you need it, open an issue so we
can size it against real use.

## Authorisation surfaces

Three mounts, with deliberately different reach:

| Surface | Auth | Reach |
| --- | --- | --- |
| `/mcp` | OAuth session or workspace API key | The full tool set |
| `/mcp/readonly` | Authenticated, same as `/mcp` | Read-only tools only. Writes are not mounted, so they cannot be reached |
| `/mcp/public` | Unauthenticated | Product help and documentation only. No workspace data |

A full session presented to `/mcp/readonly` is refused rather than silently
downgraded, so a client cannot obtain write access by addressing the wrong mount.

## Dependencies

Production dependencies are audited on every release. `npm audit --omit=dev`
should report zero vulnerabilities before a version is published; if it does not,
the release waits. The published package contains `build` and `web` only, so a
consumer resolves dependency versions fresh against the ranges in
`package.json` rather than inheriting a pinned tree from this repository.

## Data handling

- No workspace data is stored by this server. Responses are proxied and
  discarded.
- OAuth sessions are held in Redis when `REDIS_URL` is set, and in a file-based
  store otherwise.
- Optional usage analytics via MCPcat are **off unless `MCPCAT_PROJECT_ID` is
  set**. When enabled they record tool-call metadata, not workspace content.
- Logs carry error messages, request paths and status codes. They are not
  intended to carry credentials or workspace records; if you find one that does,
  report it as a vulnerability.

## Deployment notes

- Run behind TLS. The OAuth flows assume `https` for anything other than
  `localhost`.
- Set `REDIS_URL` in any multi-instance deployment. The file-based store is not
  suitable for multiple pods.
- `helmet` is applied to the HTTP surface, and `express-rate-limit` to the OAuth
  authorize, token and client-registration endpoints.
