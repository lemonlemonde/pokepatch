# PokePatch

A barebones [Next.js](https://nextjs.org/) + React + Tailwind CSS site, deployable to GitHub Pages.

## Quick Start

```bash
cd pokepatch-website
npm install
npm run dev
```

Open [http://localhost:3000/pokepatch/](http://localhost:3000/pokepatch/) — the app uses `basePath: /pokepatch` for GitHub Pages.

## Deploy (GitHub Pages)

Repo: `lemonlemonde/pokepatch` → **https://lemonlemonde.github.io/pokepatch/**

```bash
cd pokepatch-website
npm run deploy
```

In the repo **Settings → Pages**, set source to the `gh-pages` branch (root).

**Note:** GitHub Pages runs Jekyll by default, which ignores folders starting with `_` (like `_next`). This project includes a `.nojekyll` file so CSS/JS assets are served correctly.

**Custom domain:** If your GitHub user site uses `miru.sh`, `lemonlemonde.github.io` will redirect there — that's expected. This site will live at **https://miru.sh/pokepatch/**.

## Tech Stack

- React
- Next.js (static export)
- Tailwind CSS
- gh-pages
