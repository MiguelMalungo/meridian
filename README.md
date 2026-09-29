# MERIDIAN · Flight Atlas

**Live:** https://miguelmalungo.github.io/meridian/

A cinematic travel atlas:
- **The globe:** a textured Earth whose day/night line follows the real sun, amber lights for about 7,300 cities, and 120 destinations you can select.
- **Your trips:** the ones you've added are drawn as flight arcs from your home airport.
- **Destination page:** each destination has a cinematic still, a Wikipedia photo and summary, flight time, time offset, exchange rate and a 7-day forecast.

## Two ways to run it

**Live site (GitHub Pages).** This serves the `docs/` folder as a static site.
Each visitor's trips are saved in their own browser, and they start with demo
trips. The site shows the stills committed in `docs/media/`.

**Locally:**

```bash
node server.mjs
```

Then open http://localhost:4317. You need Node 18 or newer, and there is
nothing to install. Trips are saved to `data/state.json`. If `.env` is set up
(see `.env.example`), the server can also render new stills.

## Rendering stills

With the server running and `.env` configured:

```bash
node scripts/render-stills.mjs          # renders every destination without a still
node scripts/optimize-media.mjs         # shrinks new stills to web JPEGs
git add docs/media && git commit -m "Add stills" && git push
```

Each render shows its price and waits for you to confirm it. The full records
(prompts, request ids) stay in the private `data/renders.json`. Only the image
files and a plain list of them are published.

## Controls

- **Drag** the globe to turn it, and **scroll** to zoom. **Click** any light to open that destination.
- **Home**: the logo, the Home button or the **H** key takes you back to the atlas, facing your home airport.
- Press **← / →** to step through destinations, and **Esc** to close one.
- **Your manifest** lists your trips. **Explore** lists all 120 destinations, sorted by distance, with search.
- **Departing** changes your home airport. Arcs, distances and time offsets all follow it.

## Data

- Weather: Open-Meteo
- Exchange rates: Frankfurter / ECB
- Summaries and photos: Wikipedia
- Earth textures: three.js examples
- City lights: Natural Earth populated places
- Coastlines: world-atlas

## Files

```
server.mjs              local server: static files, trip storage, render proxy (the key stays server-side)
docs/                   the site (published to GitHub Pages)
docs/logo.svg           the Meridian mark
docs/js/globe.js        Earth, sun position, city lights, beacons, arcs, post-processing
docs/js/main.js         atlas list, destination page, labels, split-flap board, static mode
docs/js/cities.js       the 120 destinations
docs/media/             published stills and their list (index.json)
scripts/                batch rendering and image optimisation
data/                   local only: trips and the render log (not committed)
.env                    local only: render API settings (not committed)
```
