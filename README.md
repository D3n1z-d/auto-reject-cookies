# Auto Reject Cookies

A tiny cross-browser extension that rejects cookie banners for you.
It needs no permissions and no background script: just one content script.

## Files

- `manifest.json`: tells the browser to inject `content.js` into every page and iframe.
- `content.js`: the logic (heavily commented).

## Install (for testing)

**Chrome / Edge / Brave / Opera / Vivaldi**
1. Open `chrome://extensions` (Edge: `edge://extensions`, Opera: `opera://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and pick `manifest.json`.
   (Temporary add-ons vanish when Firefox closes; publishing needs a free addons.mozilla.org account.)

**Safari (Mac only)**
Safari can't load this folder directly. Convert it with Xcode:
1. Install Xcode, then run: `xcrun safari-web-extension-converter /path/to/this/folder`
2. Run the generated project from Xcode.
3. Safari > Settings > Advanced > tick "Show features for web developers", then
   Develop > Allow Unsigned Extensions, then enable it in Settings > Extensions.
Publishing to others needs a paid Apple Developer account.

## How it works

1. Click the reject button of known consent platforms (OneTrust, Cookiebot, Didomi...).
2. Otherwise find anything that looks like a cookie banner and click "Reject all" / "Decline" / etc.
3. If only "Manage preferences" exists, open it, switch every optional toggle off, then click "Save".
4. Keep watching the page for a while, because banners often appear late.

## Known limits

- Some banners use unusual wording or hide "Reject" several screens deep.
  Fix: add the button text to `REJECT_PHRASES` or its selector to `KNOWN_REJECT_SELECTORS`.
- Closed shadow DOMs can't be read by any extension.
- It stops watching a page after 60 seconds, and never clicks more than 10 times per page.

## Ideas to extend it (good portfolio material)

- A popup with an on/off switch and a per-site allowlist (`chrome.storage`).
- A badge counter showing how many banners were rejected.
- Logging which sites failed so you can improve the selector list.
- Unit tests for `normalize()` and `matchesAny()`.
