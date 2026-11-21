---
status: accepted
---

# Card Content runs on its own origin

Card Templates carry HTML, CSS and JavaScript written by anyone who shared a Deck. Hayaki renders them in an iframe whose page (`src-tauri/card/card.html`) is served by the `media` URI scheme (`http://media.localhost/_hayaki/card.html` on Windows), next to the collection's media files. The interface's origin is different, so a template's scripts cannot call Tauri commands or read the interface. Capabilities are granted only to the main window's own origin.

The interface talks to the card page only by `postMessage`: it sends the rendered HTML, CSS, body classes and frame colours. The page answers with ready and shown events, `pycmd`/`bridgeCommand` calls (answer, play), forwarded keys so study shortcuts keep working while the card has focus, and the typed answer when asked.

## Consequences

- Relative media references resolve against the media folder with no rewriting, and audio and video can seek through byte ranges.
- MathJax is embedded in the binary and loaded only when a side contains maths.
- The media scheme serves plain file names only. Paths with separators, `..` or drive prefixes are refused (tested in `media.rs`).
