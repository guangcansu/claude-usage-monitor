# Claude Usage Monitor

Claude Usage Monitor is a local, unpacked Chrome extension that presents a compact view of Claude usage limits. It is an experimental adapter for Claude's private consumer interface, not an official Claude integration.

## Install and refresh

1. In Chrome, open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the absolute path to your own cloned `claude-usage-monitor` directory (the folder containing `manifest.json`).
5. Pin **Claude Usage Monitor** from Chrome's Extensions menu.
6. Sign in at [https://claude.ai](https://claude.ai).
7. Open the extension and click **Refresh**.

The extension refreshes on startup, when installed, and through a Chrome alarm scheduled every two minutes. Chrome alarms are best-effort: a suspended browser, sleeping device, or Chrome scheduling delay can make the displayed data older than two minutes. Click **Refresh** when you need a new attempt.

## Reading the popup and badge

The popup shows current-session, weekly, and, when available, usage-credit information. The toolbar badge represents the rounded percentage remaining in the current session:

- Gray: at least 20% remaining.
- Orange: 5% through 19% remaining.
- Red: under 5% remaining.
- `?`: usage is unavailable or unsupported.
- Blank: there is no current-session value, or the extension is signed out or showing Demo mode.

After a refresh failure, the popup may show **Stale** and retain the most recent successful values. Those values are historical; the status and update time make that explicit rather than treating them as live data.

**Demo mode** is for previewing the popup. It displays a fixed, locally generated sample and a persistent `Demo data` label. Demo mode stores only its enabled setting locally and never changes the live badge or sends demo values to the service worker.

## Privacy and permissions

The manifest requests exactly these permissions:

- `storage` — saves the normalized usage state and the Demo-mode setting locally in Chrome.
- `alarms` — schedules the best-effort two-minute refresh.
- `https://claude.ai/*` — permits requests to Claude and the usage-page fallback only on Claude's site.

The extension does not request or use the cookies API, history, downloads, tabs, or broad `<all_urls>` access. It uses no external server, analytics, telemetry, remote script, or third-party dependency. It does not retain raw Claude responses; it saves only the normalized usage fields needed by the popup and badge.

## Troubleshooting

| Popup state | Meaning | What to do |
| --- | --- | --- |
| **Sign in** | Claude did not accept the current browser session. | Sign in again at [https://claude.ai](https://claude.ai), then click **Refresh**. |
| **Unavailable** / usage shape changed | Claude returned an unsupported page or response shape. | The private interface may have changed. Wait for an allow-listed adapter update, then reload the unpacked extension on `chrome://extensions`. |
| **Refresh failed** | A request failed because of connectivity or a non-auth HTTP error. | Check your connection, confirm Claude loads normally, and click **Refresh** again. Stale values, if shown, are the last successful values. |
| **Partial data** | At least one recognized metric is unavailable or malformed. | Refresh once more; if it persists, compare the popup with Claude's Usage page and report which metric is absent. |

After installing an adapter update, return to `chrome://extensions` and press the extension's reload button before testing it again.

## Important limitation

Claude's consumer usage interface is private and may change without notice. This extension can therefore become unsupported even when Chrome and your sign-in session are healthy. Do not treat a displayed value as confirmed live collection until it has been compared with Claude's own Usage page. This repository does not claim live collection works without that comparison.
