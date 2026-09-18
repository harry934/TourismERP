# Tourism Operations ERP — internal workspace

Enquiry-to-operations board for tourism staff. Product requirements: [docs/PRD.md](docs/PRD.md). Map of every screen, button, and server method: [docs/SYSTEM.md](docs/SYSTEM.md).

## Run

```bash
npm install --prefix web
npm run build:ui
npx clasp push --force
npx clasp deploy
```

Open the **GitHub Pages** URL after you enable Pages (staff entry). The page iframes the Apps Script app so Google’s “created by a Google Apps Script user” banner is usually hidden.

### Staff URL (GitHub Pages)

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **`main`**, folder **`/` (root)**.
3. Staff open `https://<user-or-org>.github.io/<repo>/` (for example `https://username.github.io/TourismERP/`).

The raw Apps Script `/exec` URL still works but may show Google’s banner. Update the iframe `src` in root [`index.html`](index.html) only if you create a **new** deployment id.

First visit shows a short logo splash, then **Create Super Admin** if the Sheet has no admin yet. Pick your own username and password. There is no demo seed data and no password in this repository.

The generated file `src/Index.html` is produced by `npm run build:ui` and is not stored in git. Clasp deploys from `src/` after you build.
