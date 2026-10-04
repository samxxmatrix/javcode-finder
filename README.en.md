# JavCode Finder Browser Extension

[简体中文](README.md) · [繁體中文](README.zh-TW.md)

JavCode Finder scans the current page for video codes when you click the toolbar icon, and provides:

- **Cover & trailer preview**: click a code to preview its cover from JavTrailers in the side panel, with optional HLS trailer playback
- **Page locate**: find and highlight where the code appears on the current page
- **Quick navigation**: jump straight to the JavTrailers detail page (matched by Content ID via the search page), or view details on JavDB
- **Custom rules**: customizable code regex, external navigation templates, and excluded sites

## Install on Chrome or Edge

1. Download the Chromium ZIP from [GitHub Releases](https://github.com/aizhimou/javranking-extension/releases).
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

## Privacy

The extension only reads the current top-level page after explicit user action. It never transmits or stores page URLs, page text, DOM content, code candidates, or browsing activity.

Cover and trailer data is fetched from javtrailers.com on demand only after the user clicks a code; navigation resolution requests the JavTrailers search page via the background script and contains no page or user data.

## License

[MIT](LICENSE)
