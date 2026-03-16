# Deploy Pipeline

This repository uses GitHub Actions for CI and tag-based CD.

## Workflow

- File: `.github/workflows/frontend-ci-cd.yml`
- CI runs on:
  - `pull_request` to `main`
  - `push` to `main`
- Deploy runs on tag:
  - `front-v*` (example: `front-v1.0.0`)

## Required GitHub Secret

- `FRONTEND_DEPLOY_HOOK_URL`: Deploy hook endpoint (Vercel, Netlify, Cloudflare Pages, etc.)

## Release Process

1. Merge changes into `main`
2. Create and push a tag:

```bash
git tag front-v1.0.0
git push origin front-v1.0.0
```

3. GitHub Actions triggers deploy hook automatically.
