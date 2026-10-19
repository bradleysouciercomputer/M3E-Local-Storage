# M3E Local Storage

A local-first file manager built with [M3E (Material 3 Expressive)](https://matraic.github.io/m3e/) and Vite.

## Features

- Create nested folders and browse with breadcrumbs.
- Upload multiple files or drag and drop files into the current folder or a folder tile.
- Preview images, video, audio, PDFs, and small text/code files.
- Download files, rename and move items, and mark favorites.
- Search across file and folder names; sort by name, updated date, size, or type.
- Switch between grid and list views.
- Move items to Trash, restore them, or permanently delete them. Folder actions include their contents.
- Export and import portable JSON backups.
- Responsive layout and a dark theme.
- Local browser persistence using IndexedDB; no account or application server is required for file operations.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. To create a production build:

```sh
npm run build
npm run preview
```

## Deploy to GitHub Pages

A GitHub Actions workflow builds and deploys the site when you push to `main`. In the repository settings, go to **Settings → Pages** and set the build/deployment source to **GitHub Actions**. The Vite base path is configured for this repository name.

## What “local” means

File contents are saved as Blobs in IndexedDB for the browser's current site origin. The app does not send uploaded file contents to an application server. Data is tied to that browser profile and origin, so another browser or device will not see it automatically. Browser storage can be cleared by browser settings, and available quota varies by browser and device. Export a backup before clearing site data or moving devices.

The app requests persistent browser storage when the browser supports it, but browsers may not grant that request or guarantee that data will never be cleared. Large files and backups are subject to available storage and memory.

## Technology

- M3E web components: `@m3e/web`
- Vite
- IndexedDB for file bytes and folder metadata
