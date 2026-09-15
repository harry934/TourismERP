# Lamai Africa Safaris — internal workspace

Enquiry-to-operations board for Lamai staff. Product requirements: [docs/PRD.md](docs/PRD.md). Map of every screen, button, and server method: [docs/SYSTEM.md](docs/SYSTEM.md).

## Run

```bash
npm install --prefix web
npm run build:ui
npx clasp push --force
npx clasp deploy
```

Open the deployed Apps Script `/exec` URL.

First visit shows a short logo splash, then **Create Super Admin** if the Sheet has no admin yet. Pick your own username and password. There is no demo seed data and no password in this repository.

The generated file `src/Index.html` is produced by `npm run build:ui` and is not stored in git. Clasp deploys from `src/` after you build.
