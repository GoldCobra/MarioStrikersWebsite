# Source Assets

Non-runtime design sources live here. These files are intentionally kept out of `assets/` so the active website asset tree contains only files needed by the browser.

- `psd/`: Photoshop source files for navigation, boxes, leaderboards, landing page, clubs, and Gear Builder visuals.

Agree on one editor per PSD for each task because binary changes cannot be
combined like text. Commit the source and relevant exported runtime assets
together. Keep unrelated design edits out of code pull requests; do not rewrite
asset history or convert every source file as part of routine cleanup.

