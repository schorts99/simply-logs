# Simply Logs

<img src="public/icon.svg" width="88" alt="Simply Logs: a cat with terminal log lines" />

A local-first Electron app for Windows, Linux, and macOS. Follow deployment activity, inspect build logs, and check public application health with a small cat companion. The operating system provides real window controls; there is no window-style preview switch.

On Windows, the File/Edit/View menu bar is hidden, including when pressing Alt; its keyboard shortcuts remain available. macOS and Linux keep their native menus.

## Run locally

Use Node.js 26.x and npm. The included `.nvmrc` selects Node 26 for nvm users. No environment file, hosted backend, or provider token is required for URL-only monitoring. Installed apps use Electron's bundled runtime; end users do not need Node.js.

```sh
npm ci
npm run dev
```

Create a project, then add an application:

- **Public URL health checks:** enter a real public HTTPS URL. Checks run every 15 seconds, one at a time per application.
- **Provider account:** enter a Vercel or Netlify personal access token and discover your applications, or supply a project/site ID. Deployment status syncs every 30 seconds. Vercel also retrieves up to 1,000 recent build events per poll. Vercel teams are supported; account discovery follows pagination.

Netlify's public REST API does not expose readable build logs; view those in the Netlify dashboard. Vercel build-log access depends on token permissions. Failed requests are shown explicitly; they never become successful deployments. This app does **not** invent runtime traffic or provide complete provider runtime-log ingestion. Health-check latency and failure percentages describe the checks themselves, not your application's request throughput.

Projects and environment selection scope the log viewer, counters, exports, and manual actions. Background monitoring watches all applications in the selected project. Switching projects discards the previous project's in-memory log buffer. The buffer holds up to 1,000 entries; export JSON using the toolbar to keep a record.

**Pause** stops polling and ignores in-flight observations. Resume collects fresh state. Space toggles monitoring unless focus is in a control or dialog. Alerts are deduplicated by application and monitor type; recovery requires a fresh healthy observation after the configured recovery window, not silence. The footer sound switch and alert settings share one setting, including cat sounds.

Monitoring and desktop alerts run only while the app is open. Closing the last window quits on Windows/Linux; macOS follows its native application lifecycle. Monitoring is suspended when no window exists.

## Credentials and privacy

Tokens stay in the Electron main process. When the OS keychain is available, Electron `safeStorage` encrypts them before they are written to the application's private data directory. Linux `basic_text` storage is explicitly rejected. If no secure keychain is available, tokens remain **session-only**, the app displays a warning, and you must reconnect after restarting. On Linux, enable a Secret Service/keyring or supported KWallet backend for persistent credentials.

Renderer storage contains project configuration and credential identifiers, never new plaintext tokens. Legacy plaintext tokens are migrated into the credential vault; old sample applications are removed. Storage errors are reported rather than replaced with sample data. OS notification permissions are managed in system settings.

The renderer is sandboxed, has no Node.js access, cannot make production network requests, and uses a narrow, sender-validated IPC bridge. There is no HTTP proxy or listening production server. Outbound requests require public HTTPS destinations, reject private/reserved IPs and custom ports, pin validated DNS addresses, revalidate redirects, limit response size, and time out. Private/local development services and self-signed HTTPS are deliberately unsupported.

Application data normally lives under `%APPDATA%/Simply Logs` (Windows), `~/Library/Application Support/Simply Logs` (macOS), or `~/.config/Simply Logs` (Linux). Do not delete these directories to update the app.

## Build and install

```sh
npm run check        # strict TypeScript checks, regression tests, production build
npm run start        # open the built desktop app
npm run pack         # create an unpacked application for the current OS
npm run dist         # create installers for the current OS under release/
```

| Platform | Installable artifacts |
| --- | --- |
| Windows | NSIS `.exe` installer |
| Linux | `.AppImage` and `.deb` |
| macOS | `.dmg` and `.zip`, Intel and Apple Silicon builds |

Build native installers on their corresponding operating systems. To request both macOS architectures, run `npm run dist -- --mac --arm64 --x64` on macOS. The included GitHub Actions workflow checks all three platforms, runs desktop smoke tests, and uploads installer artifacts. It does not publish releases or upload application data.

Local/CI artifacts are **unsigned by default**. Configure Electron Builder code signing and Apple notarization with your own developer certificates before public distribution; unsigned builds may be blocked or warned about by Windows/macOS. Signing credentials must only be supplied as protected CI secrets, never committed.

Linux requires the standard Electron/Chromium desktop libraries, including NSS, GTK, and ALSA. AppImage may additionally require FUSE; use its `--appimage-extract-and-run` option when FUSE is unavailable, or install the `.deb` instead.

## Tests

```sh
npm test
npm run build
npm run test:desktop
# Headless Linux:
xvfb-run -a npm run test:desktop
```

Desktop tests use an isolated temporary profile and mocked provider responses. They cover onboarding, project/environment isolation, sandbox/CSP boundaries, credential handling, pause/resume, and shared sound settings. They do not require a real provider account. In restricted CI environments where Chromium cannot initialize its OS sandbox, set `SIMPLY_LOGS_NO_SANDBOX=1` **for the smoke test only**; production app settings retain sandboxing.

`npm run dev` bundles the main process and preload, then runs Vite on loopback and launches Electron. Renderer changes reload automatically. Restart the command after changing main-process or preload code. Opening Vite in a browser is UI preview only.
