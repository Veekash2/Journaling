# Journaling

A simple black-and-white journal for writing down how you feel.

**Live site:** https://veekash2.github.io/Journaling/

## Features

- Write entries with a title, a mood tag and free text; everything saves as you type
- Mood chart showing how often you felt each mood and a day-by-day timeline
- Take or add photos of paper journal pages, and set any date on an entry
- Past entries open in a read view, with an Edit button
- Delete with Undo
- Export all entries to one PDF (photos included), for reading or for AI analysis
- Backup and Import (JSON, photos included)
- Profiles, so several people can keep separate journals on one computer
- Storage: keep entries in the browser (default), or save them as Markdown files in a folder you choose (works as an Obsidian vault; Chrome or Edge on desktop)
- Light and dark mode

## Privacy

There is no server. Entries stay in your browser, or in the folder you choose. Profiles have no password, so anyone using the same computer and browser can switch profiles.

## Run locally

```
npm install
npm run dev
```

Then open http://localhost:5180.

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages (see `.github/workflows/deploy.yml`).
