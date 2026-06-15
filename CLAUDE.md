# WUD — Claude Code Instructions

## Project Overview

WUD (What's Up Docker?) monitors running containers, queries registries for newer image versions, and fires triggers when updates are found. It exposes a REST API and a Vue 3 web UI on port 3000.

## Repo Structure

```
app/          Node.js/Express/TypeScript backend
  api/          Express routers (containers, watchers, triggers, registries, auth, store, server)
  authentication/ Auth providers (basic, OIDC)
  configuration/  All WUD_* env var parsing and validation (Joi)
  model/          Data models
  prometheus/     Prometheus metrics
  registries/     Registry integrations (Hub, GHCR, ECR, ACR, GCR, GitLab, Gitea, Quay…)
  store/          LokiJS persistence
  triggers/       Trigger integrations (mail, Discord, Slack, Telegram, HTTP, command…)
  watchers/       Docker watcher implementation
ui/           Vue 3 + Vuetify 3 frontend (built separately before Docker build)
  src/
    router/       Vue Router — base path read from window.__WUD_BASE_PATH__ at runtime
    services/     All fetch() calls use url() from services/base.ts — never hardcode /api or /auth
    views/        One view per route
  public/         Static assets / index.html template
  dist/           Build output — this is what gets copied into the Docker image
e2e/          Cucumber integration tests (Apickli)
docs/         Docsify documentation site
```

## Tech Stack

- **Backend:** Node.js 24, Express 4, TypeScript 5, Bunyan logging, Passport auth, LokiJS store
- **Frontend:** Vue 3.3, Vue Router 4, Vuetify 3.4, TypeScript 5, Vue CLI (webpack)
- **Testing:** Jest 29 + ts-jest (unit), Cucumber 11 + Apickli (e2e)
- **Docker:** Node 24 Alpine, multistage build

## Development

### Run backend
```bash
cd app && npm install && npm start
# Listens on http://localhost:3000, hot-reloads via nodemon
```

### Run frontend dev server
```bash
cd ui && npm install && npm run serve
# Dev server on http://localhost:8080
# Proxies /api and /auth to localhost:3000
```

## Building

### Build UI (required before Docker build)
```bash
cd ui && npm ci && npm run build
# Output: ui/dist/
```

### Build app (TypeScript compile)
```bash
cd app && npm ci && npm run build
# Output: app/dist/
```

### Build Docker image
```bash
# Always build the UI first — Dockerfile copies ui/dist/ directly
cd ui && npm ci && npm run build
docker build -t wud --build-arg WUD_VERSION=local .
```

## Tests

```bash
# App unit tests
cd app && npm test

# UI unit tests
cd ui && npm run test:unit
cd ui && npm run test:unit:watch

# E2E (requires Docker)
cd e2e && npm run test:setup && npm run test:start-wud && npm run test:local && npm run test:cleanup
```

## Key Environment Variables

All use the `WUD_` prefix. Any var can be loaded from a file by appending `__FILE` (e.g. `WUD_AUTH_BASIC_JOHN_HASH__FILE=/run/secrets/hash`).

| Variable | Default | Purpose |
|---|---|---|
| `WUD_SERVER_PORT` | `3000` | HTTP listen port |
| `WUD_SERVER_ENABLED` | `true` | Enable/disable API+UI |
| `WUD_SERVER_BASEPATH` | `/` | Runtime subpath for reverse proxy (e.g. `/wud/`) |
| `WUD_SERVER_TLS_ENABLED` | `false` | Enable HTTPS |
| `WUD_SERVER_TLS_KEY` / `_CERT` | — | TLS key/cert paths (required when TLS enabled) |
| `WUD_SERVER_CORS_ENABLED` | `false` | Enable CORS |
| `WUD_SERVER_FEATURE_DELETE` | `true` | Allow container delete via API |
| `WUD_LOG_LEVEL` | `info` | Log level |
| `WUD_LOG_FORMAT` | `text` | `text` or `json` |
| `WUD_PUBLIC_URL` | guessed from request | Base URL for redirect links |
| `WUD_PROMETHEUS_ENABLED` | `true` | Expose `/metrics` endpoint |

Watchers, registries, triggers and auth are configured dynamically via `WUD_WATCHER_*`, `WUD_REGISTRY_*`, `WUD_TRIGGER_*`, `WUD_AUTH_*`.

## Subpath Proxy Support

WUD supports running behind a prefix-stripping reverse proxy (e.g. Caddy `handle_path`).

Set `WUD_SERVER_BASEPATH=/wud/` at runtime. Express injects `window.__WUD_BASE_PATH__` into `index.html` when serving it. The Vue router and all `fetch()` calls read this value at runtime — **never** use hardcoded `/api/` or `/auth/` paths in UI services.

The `url()` helper in [ui/src/services/base.ts](ui/src/services/base.ts) must be used for every fetch call:
```ts
import { url } from "./base";
fetch(url("api/containers"), { credentials: "include" });
```

Example Caddy config:
```
handle_path /wud/* {
    reverse_proxy localhost:3000
}
```

## Branch Conventions

| Pattern | Purpose |
|---|---|
| `main` | Stable, upstream-compatible |
| `feature/*` | Feature work (PRable to upstream) |
| `ci/docker-publish` | Personal CI branch — triggers GHCR publish |

## CI / Docker Publish

`.github/workflows/docker-publish.yml` triggers on push to `ci/docker-publish` or manual dispatch. It builds the UI, then builds and pushes the Docker image to `ghcr.io/balaji-g42/wud:latest` using `GITHUB_TOKEN` (no extra secrets needed).
