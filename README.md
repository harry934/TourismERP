# Tourism Operations ERP — staff entry

This public repository only hosts the **GitHub Pages** shell that iframes the live Apps Script app. Application source code is not published here.

## Staff URL

1. Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **`main`**, folder **`/` (root)**.
2. Staff open `https://harry934.github.io/TourismERP/`.

The page loads the deployed Apps Script `/exec` URL inside an iframe so Google’s “created by a Google Apps Script user” banner is usually hidden.

## Update the app link

If you create a **new** Apps Script deployment, set the new `/exec` URL in [`index.html`](index.html) and push to `main`.
