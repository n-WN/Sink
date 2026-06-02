# Sink + Clipboard

A simple, fast, secure link shortener with analytics, plus a temporary text clipboard (pastebin) - running 100% on Cloudflare, free tier.

This is a fork of [Sink](https://github.com/miantiao-me/Sink) that adds an authenticated, auto-expiring clipboard on the home page, with syntax highlighting, Markdown preview, raw view, and a REST API.

## Features

### Link shortener (from Sink)

- URL shortening with customizable slugs, UTM parameters, and case sensitivity
- Per-link analytics powered by Cloudflare Workers Analytics Engine
- AI-assisted slug and OpenGraph metadata generation
- Link control: expiration, passwords, unsafe-link warning pages
- Smart routing by device or country
- QR codes, import/export, full i18n

### Clipboard (added in this fork)

- The home page is an authenticated clipboard. Visiting `/` asks for the site token, then shows the editor.
- Temporary by design: every snippet has a TTL (10 minutes to 30 days) and is auto-deleted by Cloudflare KV when it expires.
- Three views per snippet: syntax Highlight (Shiki, Vitesse light/dark), Markdown Preview, and Raw.
- Shareable raw URL secured by a per-snippet read key, so a shared link never exposes the site token.
- Full REST API under `/api/paste`.

The home page no longer renders the marketing landing page. To restore a redirect there instead, set `NUXT_HOME_URL`.

## Deployment

Deploys to [Cloudflare Workers](./docs/deployment/workers.md) (recommended) or [Cloudflare Pages](./docs/deployment/pages.md). Everything fits within the Cloudflare free tier (Workers, KV, Analytics Engine). The clipboard uses the same `KV` namespace as the shortener; no extra bindings are required.

After deploying, set at least `NUXT_SITE_TOKEN` (the dashboard and clipboard password). See the [configuration docs](./docs/configuration.md).

## Clipboard API

All endpoints require `Authorization: Bearer <NUXT_SITE_TOKEN>`, except the raw endpoint, which also accepts the per-snippet read key via `?k=`.

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/api/paste/create` | Create a snippet. Body: `{ content, lang?, title?, ttl? }`. Returns its `id`. |
| `GET` | `/api/paste/list` | List snippet metadata (newest first), paginated. |
| `GET` | `/api/paste/:id` | Get one snippet (full content + metadata + read key). |
| `GET` | `/api/paste/:id/raw` | Raw `text/plain` body. Auth via `?k=<readKey>` or the Bearer header. |
| `DELETE` | `/api/paste/:id` | Delete a snippet. |

Example:

```bash
# Create
curl -X POST https://your-domain/api/paste/create \
  -H "Authorization: Bearer $SITE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"console.log(1)","lang":"javascript","ttl":3600}'

# Read raw via the per-snippet key (no site token in the URL)
curl 'https://your-domain/api/paste/<id>/raw?k=<readKey>'
```

Security notes for the clipboard: the raw endpoint sends `X-Content-Type-Options: nosniff`, a `default-src 'none'; sandbox` CSP, and `Referrer-Policy: no-referrer` so raw content cannot execute and the read key is not leaked via referers. Markdown is rendered with `html: false` and sanitized with DOMPurify before display. Paste ids are validated before any KV access, and the `list` limit is capped to keep usage within the free KV budget.

## Configuration

[Configuration docs](./docs/configuration.md). Useful keys: `NUXT_SITE_TOKEN` (password), `NUXT_HOME_URL` (redirect `/` instead of showing the clipboard), `NUXT_REDIRECT_STATUS_CODE`.

## API (links)

[Link API docs](./docs/api.md). The OpenAPI spec is served at `/_docs/openapi.json`, with UIs at `/_docs/scalar` and `/_docs/swagger`.

## MCP

There is no native MCP server, but the OpenAPI spec can be proxied:

```json
{
  "mcpServers": {
    "sink": {
      "command": "uvx",
      "args": ["mcp-openapi-proxy"],
      "env": {
        "OPENAPI_SPEC_URL": "https://your-domain/_docs/openapi.json",
        "API_KEY": "<NUXT_SITE_TOKEN>",
        "TOOL_WHITELIST": "/api/link,/api/paste"
      }
    }
  }
}
```

## Credits

- Upstream: [Sink](https://github.com/miantiao-me/Sink) by miantiao-me
- [Cloudflare](https://www.cloudflare.com/), [NuxtHub](https://hub.nuxt.com/)
- Syntax highlighting and Markdown rendering: [Shiki](https://shiki.style/) with the Vitesse theme by Anthony Fu
