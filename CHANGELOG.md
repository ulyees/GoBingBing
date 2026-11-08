# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-11-08

### Added

- Popup probes the **source** domains of every enabled rule when it opens and
  shows each rule's latency. The replacement target is deliberately never
  probed.
- Detection can be disabled, and its timeout can be fixed (2 / 4 / 8 / 12 s) or
  set to auto, which follows the last successful latency between 1.5 and 8 s.
- Each rule is rendered as source icon → arrow → target icon. The arrow changes
  colour and line style with the probe result (green solid, amber dashed,
  red dashed), so an unreachable source and its replacement are visible at a
  glance.
- Site icons: cached bytes, cached URL, the site's own favicon, DuckDuckGo's
  icon proxy, then a coloured first letter. Successfully fetched icon bytes are
  persisted and reappear on later popup opens.
- Settings page: source probe controls, a one-click "authorise the sites in my
  rules" button, and a GitHub link.
- Unit tests for probe host expansion, timeout resolution, and probe settings.
- README, privacy notice, contribution guide, changelog, MIT licence, CI.

### Changed

- Renamed the extension from SearchFerry to **GoBingBing**.
- New visual design for the popup and options page, including dark mode.
- Settings export is now named gobingbing-settings.json.
- Default Google rule still targets cn.bing.com; the second rule moves
  cn.bing.com to www.bing.com.

### Fixed

- Default rules are copied before editing, so changing a rule in the options
  page cannot mutate the shared default constants.
- Invalid host patterns are rejected before a probe is attempted.

## [1.1.0]

### Added

- Optional pre-flight HEAD check before navigating to a rule-managed site
  (off by default, because a slow but working Google can be misclassified).
- Migration of the untouched Google default rule from www.bing.com to
  cn.bing.com.

### Changed

- Google failures now fail over to cn.bing.com; cn.bing.com failures fail
  over to www.bing.com.

## [1.0.0]

### Added

- Initial Manifest V3 extension.
- Automatic failover driven by webNavigation.onErrorOccurred, with a
  chrome-error:// fallback for browsers that do not emit an error event.
- Search-query migration (Google q to Bing, image verticals, Baidu/Sogou
  parameters), Google /url unwrapping, per-tab redirect chains, loop
  protection, manual switching, notifications, badge, and event log.
- Editable rules, import/export, preview, dark mode, and Node unit tests.
