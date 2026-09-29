# MERIDIAN · Flight Atlas

A cinematic travel atlas with these features:
- **The globe:** a textured Earth whose day/night line follows the real sun, amber lights for about 7,300 cities, and 120 destinations you can select.
- **Your trips:** the ones you've added are drawn as flight arcs from your home airport.
- **Destination page:** open any destination for a Wikipedia summary and photo, flight time, time offset, exchange rate and a 7-day forecast.
- **Optional Higgsfield renders:** cinematic stills and drone flyovers.

**Live:** https://miguelmalungo.github.io/meridian/

## Two ways to run it

**Live site (GitHub Pages).** This serves the `docs/` folder as a static site.
Each visitor's trips are saved in their own browser, and they start with demo
trips. Higgsfield rendering is switched off here so your API key is never
exposed, but any renders you commit to `docs/media/` are shown.

**Locally, with renders enabled:**

```bash
node server.mjs
```

Then open http://localhost:4317. You need Node 18 or newer, and there is
nothing to install. Trips are saved to `data/state.json`, and the Higgsfield
proxy is enabled.

To put your renders on the live site, commit `docs/media/` (images and
`index.json`) and push.

## Higgsfield (optional)

The key goes in `.env` in this folder. The file is hidden in Finder, so press
**Cmd + Shift + .** to show it, then add the key and restart the server:

```
HF_CREDENTIALS=KEY_ID:KEY_SECRET
```

Every render shows its price first, and nothing is charged until you press
**Confirm**. Prices when this was built, from Higgsfield's free `/estimate` endpoint:

| Render | Model | Price |
| --- | --- | --- |
| Cinematic still, 1080p | `higgsfield-ai/soul/v2/standard` | ≈ $0.006 |
| 5-second flyover, 720p | `kling-video/v3.0-turbo/image-to-video` | ≈ $0.31 |

Stills for all 120 destinations come to about $0.72 in total, and it's a
one-time cost: finished renders are saved to `docs/media/` and reused. Without a
key, every destination still gets a free Wikipedia photo.

## Controls

- **Drag** the globe to turn it, and **scroll** to zoom. **Click** any light to open that destination.
- Press **← / →** to step through destinations, and **Esc** to return to the atlas.
- **Your manifest** lists your trips. **Explore** lists all 120 destinations, sorted by distance, with search.
- **Departing** changes your home airport. Arcs, distances and time offsets all follow it.

## Data

- Weather: Open-Meteo (one request covers all destinations; cached for 30 min)
- Exchange rates: Frankfurter / ECB
- Summaries and photos: Wikipedia
- Earth textures: three.js examples
- City lights: Natural Earth populated places
- Coastlines: world-atlas

None of these need a key.

## Files

```
server.mjs         local server: static files, trip storage, Higgsfield proxy (the key stays server-side)
docs/              the site (published to GitHub Pages)
docs/js/globe.js   Earth, sun position, city lights, beacons, arcs, post-processing
docs/js/main.js    atlas list, destination page, labels, split-flap board, renders, static mode
docs/js/cities.js  the 120 destinations
docs/media/        saved Higgsfield renders
data/state.json    your trips on the local server (not committed)
.env               Higgsfield key (not committed)
```
