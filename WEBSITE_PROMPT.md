# Simply Logs website creation prompt

Use the following prompt to build the Simply Logs product and download website.

---

Create a polished, responsive marketing website for **Simply Logs**, a local-first
desktop application for Windows, macOS, and Linux. The website should feel like a
natural extension of the desktop app, explain its capabilities accurately, and
help visitors download the right installer.

Build the website, not another desktop application or a hosted logging service.
Use React, TypeScript, Tailwind CSS, and Lucide icons with Vite. Keep it suitable
for static hosting, including Vercel. If working inside the desktop repository,
keep the website in its own `website/` directory without changing the Electron
app, its entry points, or its build configuration.

## Visual identity

- Aim for calm, practical developer tooling with a little personality. Avoid a
  generic enterprise dashboard, oversized gradients, glass-heavy panels, or
  excessive animation.
- Use near-black and neutral surfaces in dark mode: `#0a0a0a`, `#171717`,
  `#262626`, and subtle neutral borders. Use white and soft neutral-gray surfaces
  in light mode.
- Use indigo for primary actions and selected controls: `#6366f1`, `#4f46e5`,
  and `#818cf8`. Use emerald for healthy states, amber for warnings, and rose for
  errors. Never communicate status through color alone.
- Use the system sans-serif font stack for headings and body text. Use
  `ui-monospace, 'Cascadia Code', SFMono-Regular, Menlo, Monaco, Consolas, monospace`
  for log lines, timestamps, labels, badges, and technical metadata.
- Use thin borders, restrained shadows, rounded cards, compact pills, generous
  section spacing, and clear hierarchy. Marketing text should remain comfortable
  to read; do not copy the desktop app's tiny text sizes onto body copy.
- Retain the cat identity. Reuse the Simply Logs cat-and-terminal logo from
  `public/icon.svg` and the pixel-cat artwork when available. Do not replace the
  brand with a generic terminal icon. Keep the companion subtle rather than
  making the entire website cartoonish.
- Default to the visitor's system theme, offer a working light/dark toggle, and
  remember the selection locally. Respect reduced-motion preferences.

When the desktop source is available, use these as visual references:

- `src/index.css`: typography, focus styles, pixel art, and reduced motion.
- `modules/projects/presentation/ProjectSidebar.tsx`: project cards and environment pills.
- `modules/projects/presentation/CreateProjectModal.tsx`: project creation and editing.
- `modules/monitoring/presentation/LogStreamViewer.tsx`: log rows, filters, HTTP method and status badges.
- `modules/monitoring/presentation/LogDetailModal.tsx`: full log inspection and JSON copying.
- `modules/desktop/presentation/StatusBar.tsx`: compact monospace status treatment.
- `modules/companion/presentation/PixelCat.tsx`: companion appearance.

Adapt these patterns for the web; do not copy desktop-only fixed heights or
`overflow: hidden` behavior that would prevent normal page scrolling.

## Page structure and suggested copy

1. **Header:** logo and Simply Logs wordmark, links to Features, Downloads, and
   FAQ, a theme toggle, and a primary Download button that navigates to Downloads.
   Collapse navigation accessibly on small screens.
2. **Hero:** headline: **"Your logs. One calm place."** Supporting text:
   "Catch up on recent Vercel and Netlify runtime logs, follow new output, and
   check application health from your desktop. With a small cat keeping you company."
   Include a prominent download CTA, a secondary "See how it works" anchor, and
   a quiet "Windows / macOS / Linux" compatibility label.
3. **Product preview:** a refined, believable desktop-style log panel with a
   project sidebar, environment pills, timestamped log lines, severity badges,
   HTTP method/status badges, source filters, and a small pixel cat. Include an
   `OPTIONS` preflight and a `POST` request to the same endpoint as separate demo
   events, so their method badges explain why similar-looking requests are not
   duplicates. Label the panel **"Illustrative preview"**.
   Sample events must be visibly demo data, never presented as real traffic or
   measured product performance. If filters or pause controls are shown as
   interactive, make them work on the local sample data. If a log-details dialog
   is included, keep its copy/close controls visible with long IDs and large
   payloads, scroll its body, and support backdrop clicks, Escape, and an explicit
   close button. Interior clicks and text selection must not dismiss it. Do not
   require a token or call provider APIs from the website.
4. **Features:** concise cards for past-hour and live Vercel/Netlify runtime logs;
   deployment status and Vercel build logs; public HTTPS health checks; editable
   projects and environment scopes; searchable HTTP methods and log filtering;
   locally saved history and JSON export; reusable provider tokens; desktop
   alerts and the cat companion.
5. **How it works:** three steps: download and launch; add a project and connect
   a provider account or public URL; review recent history and follow new activity.
   Explain that additional applications can reuse a saved token from the same
   provider rather than requiring another token to be created or entered.
6. **Privacy and boundaries:** explain local-first storage, OS-backed credential
   encryption when available, session-only tokens when it is not, and direct
   provider API/stream access without a Simply Logs hosted logging backend.
   Distinguish encrypted credentials from locally saved logs, which are not
   encrypted and may contain sensitive application output.
7. **Downloads:** clear platform cards, explicit architecture/package choices,
   and actual installer links configured through environment variables as
   specified below. Repeat a download CTA near the end of the page.
8. **FAQ:** explain URL-only versus provider-account mode, supported providers,
   past-hour history versus saved history and live streaming, provider limits,
   token reuse, project editing, whether the app must stay open, and
   installation/signing caveats.
9. **Footer:** the Simply Logs name, a short product description, and useful
   in-page links. Do not invent social profiles, legal pages, or contact details.

## Installer links: environment-driven, independent of GitHub

There are **no published releases yet**. Installers may eventually be hosted on
GitHub, object storage, a CDN, or another HTTPS host. Do not hardcode a GitHub
release URL, guess filenames or versions, query GitHub Releases, or assume files
are available just because the product supports a platform.

Use the following public, build-time environment variables:

```dotenv
# Public HTTPS download URLs. Leave empty until the corresponding asset exists.
VITE_DOWNLOAD_WINDOWS_X64_URL=
VITE_DOWNLOAD_MACOS_ARM64_URL=
VITE_DOWNLOAD_MACOS_X64_URL=
VITE_DOWNLOAD_LINUX_X64_APPIMAGE_URL=
VITE_DOWNLOAD_LINUX_X64_DEB_URL=
```

| Variable | Download label |
| --- | --- |
| `VITE_DOWNLOAD_WINDOWS_X64_URL` | Windows - x64 installer (.exe) |
| `VITE_DOWNLOAD_MACOS_ARM64_URL` | macOS - Apple Silicon (.dmg) |
| `VITE_DOWNLOAD_MACOS_X64_URL` | macOS - Intel (.dmg) |
| `VITE_DOWNLOAD_LINUX_X64_APPIMAGE_URL` | Linux - x64 AppImage |
| `VITE_DOWNLOAD_LINUX_X64_DEB_URL` | Linux - x64 Debian/Ubuntu (.deb) |

Requirements:

- Read and normalize these values in one small, typed download configuration.
  Trim whitespace, permit only absolute HTTPS URLs without embedded credentials,
  and handle missing or invalid values without crashing.
- Render configured downloads as ordinary accessible links to those exact URLs.
  Preserve query parameters. Do not depend on the HTML `download` attribute
  working across origins. No proxy or download backend is needed.
- For missing or invalid values, show the package as **"Not available yet"**,
  with no active download link. Never use `#`, a dummy URL, a local file path, or
  an unrelated installer as a fallback.
- If no URLs are configured, keep the Downloads section visible and explain:
  **"Installers are not available yet. Download links will appear here when
  builds are published."**
- The hero/header CTA should always lead to the Downloads section. Optional OS
  detection may highlight the relevant card, but must not automatically download,
  hide other platforms, or assume a CPU architecture.
- Include a matching `.env.example` and concise hosting instructions. Explain
  that Vite embeds these values during the build, so changing them requires a
  rebuild/redeploy. All `VITE_` values are public: never put provider tokens,
  storage credentials, or other secrets in them.
- Do not create a release, publish installers, or upload files as part of this
  website task.

## Accurate product claims

- Simply Logs is a desktop application, not a browser-based log collector.
- Vercel account connections support deployment status, recent build logs,
  past-hour runtime history, and live runtime logs, including serverless and edge
  output. Initial history is capped at 1,000 runtime requests for the selected
  environment and can include previous deployments. Console messages are grouped
  per request, with individual messages and metadata retained in details/export.
- Netlify account connections support deployment status, past-hour Function/Edge
  Function history, and live runtime logs. History covers the deployment selected
  on connection, not earlier deployments within that hour, and is capped at 1,000
  log lines across sources. Up to 10 Functions per application are monitored,
  chosen alphabetically; additional Functions produce a warning. Edge Functions
  use a separate stream. Netlify build logs remain in its dashboard.
- Historical access and live logging depend on token permissions, provider
  retention, plan access, and query limits. Do not promise that every account
  can retrieve every log from the past hour or recover provider-expired output.
- Runtime entries arrive continuously as providers send them. Deployment selection
  refreshes roughly every 30 seconds; failed history queries and streams warn and
  retry automatically. Partial Netlify source failures do not stop working feeds.
  Do not describe live runtime logs as being fetched only every 30 seconds.
- Vercel production follows the active production deployment, including
  promotions/rollbacks; preview follows the latest ready preview deployment.
  Netlify production follows the published deployment, including rollbacks;
  preview follows the latest ready deploy preview or branch deploy.
  Local development runtime logs are not supported.
- Historical backfill and live streaming are separate capabilities, not
  guaranteed complete ingestion or permanent cloud retention. Reconnection,
  deployment changes, and provider limits can leave gaps. Deduplication is
  best-effort, particularly for Netlify lines without stable cross-transport IDs.
- Logs show HTTP method badges when method metadata is available, distinguishing
  preflight `OPTIONS` from the actual request. Methods are searchable regardless
  of case and included in copied text/JSON exports. Do not invent a method for
  build messages or other logs that lack one.
- Projects can be edited through **Edit current project** in the project selector
  or the sidebar pencil button. Name, description, color, and tags are editable;
  descriptions and tags can be cleared. Editing does not recreate the project,
  remove applications/logs, or reset monitoring/filter selections.
- Saved tokens can be reused by other applications using the same provider,
  including applications in different projects. **Access token** lists each saved
  credential once, labeled with an application that uses it. Team IDs and
  application settings remain independent. Saved token values stay in the main
  process; choosing one does not reveal it to the renderer. Changing/deleting an
  application or project preserves credentials still used elsewhere; the last
  reference's removal deletes its token. Session-only tokens are reusable only
  until the app exits and must be re-entered after restarting.
- Public URL mode performs health checks every 15 seconds; it does not retrieve
  application logs and requires no provider token.
- Health-check latency and failure rates describe probes, not overall application
  throughput or request performance.
- Monitoring runs only while the app is open with a window, and stops when paused.
  The newest 1,000 log entries across projects, including runtime output, are saved
  locally and restored after project switches or app restarts. Historical and
  restored logs do not trigger fresh alerts or inflate live throughput. Users can
  copy filtered log text or export JSON for a longer-term record.
- Saved log history is not encrypted. Clearing logs removes the selected project's
  saved entries; deleting an application/project removes its saved logs. Clearing
  local history does not delete provider history, and a future app restart may
  backfill recent provider logs again. Storage failures are reported, not hidden.
- Do not claim pricing, an open-source license, code signing, automatic updates,
  customer counts, uptime guarantees, or integrations that have not been verified.
- Explain calmly that unsigned installers may trigger OS warnings. Do not claim
  notarization or tell visitors to disable security protections.

## Quality and delivery

Make the page work from small phones through wide desktop screens, with semantic
landmarks, keyboard navigation, visible focus states, accessible controls, readable
contrast, descriptive link labels, and no horizontal page overflow. Keep decoration
lightweight and use the existing SVG assets instead of introducing large media or
external font dependencies. Include a descriptive page title, meta description,
and local favicon. Do not add analytics, sign-up forms, authentication, or a backend.

Deliver the complete website source, reusable sections where useful, `.env.example`,
and short setup/deployment instructions. Do not just return a mockup or a plan.
Validate the production build and the repository's existing checks when available.
Test empty, partially configured, fully configured, malformed, and non-HTTPS
download values; verify exact link destinations, package labels, theme switching,
mobile navigation, and any interactive preview controls.
