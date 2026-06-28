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

## Tech Stack

- React
- Next.js (static export)
- Tailwind CSS
- gh-pages
