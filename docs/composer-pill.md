# Composer pill and screenshots

Created: 2026-10-04. Last updated: 2026-10-05.

## Button contract

Paseo composer pills display an icon and a non-empty label. Omitting `label` displays `title`. The title also supplies the accessible label, tooltip, and sheet title. See the [Paseo composer pill reference](https://paseo.sh/docs/plugins/reference#composer-pills) and [button descriptor](https://paseo.sh/docs/plugins/reference#button-descriptor), checked on 2026-10-04.

Every pill state uses the monochrome Be concise logo. The enabled label is the combined rejected and flagged count. The popup lists each decision count, and its 30-minute chart colors only rejected and flagged decisions. The title is a short summary, such as `Be concise · 5 rejected or flagged`, so the mobile sheet title fits. Agents in the same workspace share the polled label, icon, and title.

| State | Label |
| --- | --- |
| Enforcing rules | One count, for example `11` |
| Workspace enforcement bypassed | `Off` |
| Connecting | `…` |
| Read failed | `!` |

The pill counts `deny`, `block`, `ask`, and `flag`. Allowed, rewritten, bypassed, and error counts stay in the popup.

## Screenshots

The [README gallery](../README.md#screenshots) uses scenario headings and PNG links, following the [Shared Browser example](https://github.com/omercnet/paseo-plugins/tree/d7b3e654f364b5be72edf6fd1d914a3750b53082/paseo-shared-browser#screenshots). The promo banners come first. The connection and empty states come last.

Every gallery image in [images/](images/) is 1920×1080 (16:9). `github-banner.png` is the README header and the repository's social preview. It is 2560×1280 (1280×640 rendered at 2×) and under 1 MB, which meets GitHub's [social preview requirements](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview), checked on 2026-10-05. GitHub has no API for this image: upload it under **Settings** > **Social preview** > **Edit**. Captures were taken on 2026-10-04 from the Paseo 0.11.0-beta.3 web app in light mode, served by a separate test daemon with this plugin installed from the repository and be-concise 0.8.2. Sample hook records, a sample Git project, and an imported sample Claude Code session supplied the data. No prompt was sent to an agent.

- **Banners** (`composer-on`, `activity-desktop`, `configuration-light`, `playground`, `compact`): a 960×540 HTML layout rendered at 2× around tight crops of 1440×900 captures at 2× pixel density. Each capture card ends 56 pixels above the bottom edge at 1×. The narrow-screen banner shows two 390×844 captures beside the headline. The playground banner outlines the `decision` field of the hook response. Each banner shows the logo and "Be Concise" above the headline, the repository name with the GitHub mark at the bottom left, and a faint copy of the logo behind the screenshots. Colors, logo, and the Geist font come from the [be-concise theme](https://github.com/yannelli/be-concise/blob/main/plugins/concise/web/public/theme.css): charcoal `#18191D` background, cream `#FAF7F2` text, and orange `#FF4A24` accents.
- **Plain captures** (`composer-off`, `activity-filtered`, `composer-connecting`, `composer-unavailable`, `activity-empty`): 1280×720 viewports at 1.5× pixel density.
- **States**: Off was set through the project's `softFail` setting. Connecting was captured while the plugin process was paused. Unavailable was captured with be-concise removed from the test home. Empty was captured with no hook records.

The test daemon reported the host name `devbox`. Native mobile apps and the desktop app were not checked.
