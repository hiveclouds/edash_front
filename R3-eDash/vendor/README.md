# vendor/ — third-party libraries, bundled locally

Chart.js, Leaflet, and PapaParse used to be loaded straight from
`cdnjs.cloudflare.com` in `index.html`. That is what caused the
"Activity Trend" chart (and any other chart on this dashboard) to
sometimes get stuck on **"Chart is taking longer than usual to
load"**: if the connection to the CDN was slow, blocked by a
firewall/proxy, or the machine was simply offline while testing,
`Chart` never became defined — no amount of waiting or retrying
fixes that, because the file never arrives. This had nothing to do
with the data being dummy or real; it was purely about where the
JavaScript library itself was being fetched from.

The fix: these three libraries are now copied into this folder and
loaded from the same origin as the dashboard itself
(`vendor/chartjs/chart.umd.min.js`, `vendor/leaflet/leaflet.js` +
`leaflet.css` + `images/`, `vendor/papaparse/papaparse.min.js`), so
they always load — no external network call required, whether you
open the app with a local static server or, later, from the real
production backend.

## Versions vendored

| Library    | Version | Source                                             |
|------------|---------|-----------------------------------------------------|
| Chart.js   | 4.4.4   | npm `chart.js@4.4.4` → `dist/chart.umd.js` (minified with terser) |
| Leaflet    | 1.9.4   | npm `leaflet@1.9.4` → `dist/leaflet.js` (minified) + `dist/leaflet.css` + `dist/images/*` |
| PapaParse  | 5.4.1   | npm `papaparse@5.4.1` → `papaparse.min.js`          |

## Updating a version later

1. `npm install <package>@<version>` in a scratch folder (not inside this repo).
2. Copy the built/minified file(s) over the ones in this folder, keeping the same filenames/paths so `index.html` doesn't need to change.
3. For Leaflet specifically, also copy `dist/images/*.png` — `leaflet.css` references them by relative path for the default marker icons.
4. Reload the dashboard and confirm charts/maps still render before committing.

## Note on Font Awesome

`index.html` and `pages/login.html` still load Font Awesome icons
from `cdnjs.cloudflare.com`. That is a lower-risk dependency (icons
simply don't render if it's blocked — nothing gets stuck or breaks),
so it hasn't been vendored here. If icon glyphs ever go missing in
the same way, the fix is the same idea: download the Font Awesome
package and serve `css/all.min.css` + `webfonts/` from this project
instead of the CDN.
