# JavCode Finder Browser Extension

[简体中文](README.md) · [繁體中文](README.zh-TW.md)

JavCode Finder scans the current page for video codes when you click the toolbar icon, and then works with each code in the side panel:

- **Code scanning**: pulls every code on the page in one pass and de-duplicates them. Handles censored codes (`IPX-118`, `DLDSS-529`), uncensored codes, and all `FC2-*` spellings. Both the recognition regex and a **code blocklist regex** are editable in settings
- **Cover & trailer preview**: clicking a code loads its cover, title and description, performers, and release date on demand, with inline trailer playback
- **Title & performer translation**: in Chinese UI the Japanese title and performer names are translated automatically. You can plug in a self-hosted DeepL worker for reliability; without it the extension falls back to public translation endpoints
- **Page locate**: find and highlight where the code appears on the current page; repeated clicks cycle through multiple occurrences
- **Favorites**: bookmark the codes you care about; stored locally by default, with cloud sync available in settings
- **Cloud sync**: with it enabled, your favorite codes and settings sync to the cloud (your own WebDAV space) and are shared across devices
- **Emby library integration**: with an Emby URL and API key configured, titles already in your library are badged in the panel
- **Quick navigation**: three customizable external platform buttons (name + URL template) that open a search page for the code; the template needs a placeholder (`{code}` or `{番号}`). For example, with `https://javdb.com/search?q={code}`, clicking `ABP-123` opens `https://javdb.com/search?q=ABP-123`
- **Other**: Simplified Chinese / Traditional Chinese / English UI, adjustable preview volume, and an update check at most once every 24 hours

> Uncensored codes need the optional `d2pass-api` backend below, and their asset URLs usually still require the browser to reach the Japanese origin — see the “Optional backends” section below.

## Install on Chrome or Edge

1. Download the Chromium ZIP from [GitHub Releases](https://github.com/samxxmatrix/javcode-finder/releases).
2. Unzip it into a folder you will keep.
3. Open `chrome://extensions` or `edge://extensions`.
4. Enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.

Unpacked extension updates must be done manually: download and unzip the new version, then choose **Reload** on the extension card. The extension checks GitHub for a newer version at most once every 24 hours and offers a download link at the top of the side panel (dismissing it hides that version).

Firefox supports temporary development loads; a Mozilla-signed XPI for permanent install is not provided yet.

## Build from source

Requires Node.js 20.19 or newer.

```sh
npm ci
npm run compile
npm test
npm run build
npm run zip
```

The production ZIP is output to `.output/`. Build artifacts are not committed to Git.

Releases use `npm run release <patch|minor|major|x.y.z>`: it bumps the version (single source: `package.json`), appends `CHANGELOG.md`, builds and verifies the artifact version, tags `v<version>`, and writes the release asset `.output/version.json` (which the in-extension update notice reads). Add `--dry-run` to preview, `--push` to push.

## Optional backends (advanced)

The extension **works without any backend**: code scanning, highlighting, library integration, settings sync, and previews for censored codes all run inside the extension.

[`advanced/`](advanced/README.md) holds three **optional** backend services: `dmm-api` (preview source for DMM / FALENO codes), `d2pass-api` (codes from a set of uncensored sites → cover and trailer), and `deepl-translate-api` (translation proxy for preview titles and performers). Without them, scanning, locate, navigation, favorites, Emby integration, and censored-code previews still work — you only lose that particular capability. Each service ships its own `README.md` and deployment guide; deploying means fetching public pages under your own account, so check compliance and platform terms yourself.

## Privacy

The extension only reads the current top-level page after explicit user action. It never transmits or stores page URLs, page text, DOM content, code candidates, or browsing activity.

Cover and trailer data is loaded on demand, only after the user clicks a specific code. The background script sends that single code to a small number of third-party public pages and public endpoints; if the user has configured a self-hosted backend address in settings, those queries go to that backend instead — it is deployed and maintained by the user. A second public source may be queried in parallel and merged field by field. Every request carries only the clicked code, never page URLs, page text, DOM content, or code candidates.

## License

[MIT](LICENSE)
