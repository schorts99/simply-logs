# Changelog

All notable changes to Simply Logs are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-29

### Added

- **Runtime error spike alerts.** For applications connected through a Vercel or Netlify account, Simply Logs alerts when live runtime, Function or Edge logs show 5xx responses or error-level output at or above a per-minute rate (3, 5, 10 or 25; default 5). Isolated errors and loaded history never alert. A spike recovers when a request succeeds after the recovery window. Can be turned off in alert settings.
- **Health check failure threshold.** Choose how many failed health checks in a row trigger an alert: 1, 2, 3 or 5.
- **Mute an application for an hour** from its alert toast. Muted applications appear in alert settings with the time remaining and an **Unmute** button.
- **Click an alert to open its logs.** Toasts, Recent Notifications entries and desktop banners focus the window and select that application, switching projects if needed.
- Alerts show the application's environment and provider, such as "production · Vercel", including in desktop banners.
- Recovery alerts report how long the incident lasted and how many failures it included, such as "Down for 2m 15s · 9 failed checks".

### Changed

- **Health checks now alert after 2 consecutive failures by default** instead of on the first one, so a single failed 15-second check no longer triggers an alert. Set the threshold to 1 in alert settings to restore the previous behavior. Failed deployments still alert immediately.
- Up to three toasts stack instead of each new one replacing the last. Error toasts stay on screen for 12 seconds.
- Toasts show how long ago the alert was raised instead of always reading "Just now".

### Fixed

- The arrow in select inputs sat against the right border. It now has the same spacing as the text on the left.
- Desktop end-to-end tests intermittently failed at startup because they replaced IPC handlers before the app had registered its own.

## [1.0.0]

- Initial release.

[1.1.0]: https://github.com/schorts99/simply-logs/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/schorts99/simply-logs/releases/tag/v1.0.0
