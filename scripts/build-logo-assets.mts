/**
 * Derives the app's logo variants and icons from `assets/logo_original.png`.
 *
 * Committed as a script rather than done once by hand so the derivation is reviewable and
 * repeatable: when the logo is redrawn, this regenerates every variant instead of leaving
 * someone to guess which crop and which recolour produced the favicon.
 *
 * Run with `npm run build:logo`. The outputs are committed — this is not a build step, and
 * nothing at runtime depends on it.
 *
 * Two problems it solves, both from the source being a wide wordmark on transparency:
 *
 * 1. **Dark mode.** "he" and the tagline are dark indigo (#2b1661). On the dark theme's
 *    near-black background they vanish and the wordmark reads "FP LP". The dark variant
 *    lightens only those pixels, leaving the cyan-to-purple gradient untouched.
 * 2. **The favicon.** At 32px a 3:1 wordmark is an illegible smear. The icon is cropped to
 *    the "FP" monogram, which is the strongest element and carries the brand gradient.
 */
import { mkdir } from 'node:fs/promises'

import sharp from 'sharp'

const SOURCE = 'assets/logo_original.png'

/**
 * Anything whose brightest channel falls below this is the indigo ink, not the gradient.
 *
 * Brightest channel (HSV value), deliberately not luma. Luma weights green heavily, so the
 * brand's vivid purple (#991ce1) scores 69 — *below* the indigo it is meant to be
 * distinguished from — and a luma threshold bleaches the gradient while leaving only the
 * cyan. By brightest channel the two separate cleanly: the indigo peaks at 97, every
 * gradient colour at 225 or above.
 */
const DARK_INK_VALUE = 150

/** What that ink becomes in dark mode. Matches `--foreground` in globals.css. */
const DARK_MODE_INK = [237, 237, 237] as const

await mkdir('public', { recursive: true })

/**
 * Trims the source's transparent margin so every derived asset is framed by its ink
 * rather than by whatever whitespace the export happened to include.
 */
const full = await sharp(SOURCE).trim().png().toBuffer()
const fullMeta = await sharp(full).metadata()
const fullWidth = fullMeta.width ?? 0
const fullHeight = fullMeta.height ?? 0
console.log(`[logo] trimmed source: ${fullWidth}x${fullHeight}`)

/**
 * The wordmark without the baked-in "MANAGE YOUR FANTASY LEAGUE" tagline.
 *
 * The tagline sits at 93% of the height and is set very small. At the sizes the app
 * actually uses — 280px on the landing hero, 72px in the nav — it renders as illegible
 * speckle that reads as a compression artifact, and on the landing page it competes with
 * the real tagline in text directly beneath it. Cropping at 90% keeps the swoosh, which
 * ends at 77%, and drops only the type.
 */
const trimmed = await sharp(full)
  .extract({ left: 0, top: 0, width: fullWidth, height: Math.round(fullHeight * 0.9) })
  .trim()
  .png()
  .toBuffer()

const { width = 0, height = 0 } = await sharp(trimmed).metadata()
console.log(`[logo] wordmark: ${width}x${height} (ratio ${(width / height).toFixed(4)})`)

// --- The light-mode wordmark -------------------------------------------------
await sharp(trimmed)
  .resize({ width: 1040, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: true })
  .toFile('public/logo.png')

// --- The dark-mode wordmark --------------------------------------------------
/**
 * Recolours dark ink and leaves everything else alone.
 *
 * Per-pixel rather than a filter because the two must be told apart by *colour*: a blanket
 * invert or brightness lift would wreck the gradient, which is the recognisable part.
 */
const { data, info } = await sharp(trimmed).ensureAlpha().raw().toBuffer({
  resolveWithObject: true,
})

for (let i = 0; i < data.length; i += info.channels) {
  if (data[i + 3] < 8) continue // fully transparent; leave it
  const value = Math.max(data[i], data[i + 1], data[i + 2])
  if (value < DARK_INK_VALUE) {
    data[i] = DARK_MODE_INK[0]
    data[i + 1] = DARK_MODE_INK[1]
    data[i + 2] = DARK_MODE_INK[2]
  }
}

await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
  .resize({ width: 1040, withoutEnlargement: true })
  .png({ compressionLevel: 9, palette: true })
  .toFile('public/logo-dark.png')

// --- The icons ---------------------------------------------------------------
/**
 * The "FP" monogram, squared and padded.
 *
 * Fractions of the trimmed source rather than fixed pixels, so a re-exported logo at a
 * different resolution still crops to the same letters.
 *
 * `0.375` is where the indigo "he" begins — measured, not guessed. The letters are italic
 * and nearly touch, so there is no transparent gutter to detect: the only one in the whole
 * wordmark is at 49.8%, between "FPhe" and "LP".
 *
 * `0.70` of the height is likewise measured, by ink density per row within that crop. The
 * letterforms end at 69%; 70–77% is the tail of the swoosh, which survives a taller crop as
 * a stray diagonal speck in the corner, and the tagline sits at 93% where it is unreadable
 * at any icon size.
 */
const cropped = await sharp(trimmed)
  .extract({
    left: 0,
    top: 0,
    width: Math.round(width * 0.375),
    height: Math.round(height * 0.7),
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

/**
 * Erases the swoosh's leading tip from the bottom-right corner.
 *
 * No rectangular crop can remove it: the swoosh enters at x 281-331 in the rows below the
 * letters, which is directly beneath the P's bowl, so cutting it out by width would clip
 * the P. In those rows the letter stems stop at x≈244, well clear of this corner — that
 * gap is what makes the erase safe, and it is why the bounds are what they are rather than
 * round numbers.
 */
const cutX = Math.round(cropped.info.width * 0.68)
const cutY = Math.round(cropped.info.height * 0.88)
for (let y = cutY; y < cropped.info.height; y++) {
  for (let x = cutX; x < cropped.info.width; x++) {
    cropped.data[(y * cropped.info.width + x) * cropped.info.channels + 3] = 0
  }
}

const monogram = await sharp(cropped.data, {
  raw: {
    width: cropped.info.width,
    height: cropped.info.height,
    channels: cropped.info.channels,
  },
})
  .png()
  .toBuffer()
  .then((b) => sharp(b).trim().toBuffer())

async function icon(size: number, file: string) {
  // A tenth of the canvas as breathing room. Without it the mark runs edge to edge and
  // reads as clipped once a launcher rounds the corners.
  const pad = Math.round(size * 0.1)
  const inner = size - pad * 2

  const fitted = await sharp(monogram)
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer()

  await sharp(fitted)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    // Transparent renders as black in most tab bars, and iOS composites touch icons on
    // black regardless — so both get an explicit white plate rather than a dark surprise.
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png({ compressionLevel: 9 })
    .toFile(file)

  console.log(`[logo] wrote ${file} (${size}x${size})`)
}

await icon(512, 'src/app/icon.png')
await icon(180, 'src/app/apple-icon.png')

// --- The link preview card ---------------------------------------------------
/**
 * The Open Graph card, at `src/app/opengraph-image.png`.
 *
 * Next picks that filename up by convention and emits `og:image` with its type and
 * dimensions; `opengraph-image.alt.txt` beside it supplies the alt text. Generated here
 * rather than by an `opengraph-image.tsx` using `ImageResponse`, so the card stays a
 * committed artefact derived from the same source as every other image in the project —
 * this script is the single place the logo is cropped and recoloured, and a runtime
 * renderer would be a second one, with a font to load and a build step that can fail.
 *
 * 1200x630 is the size every consumer crops from: Facebook and WhatsApp use it as-is,
 * and Twitter's `summary_large_image` letterboxes to 2:1 inside it. Nothing is placed
 * within ~100px of an edge for that reason.
 *
 * **Light plate, deliberately.** A preview card is composited onto whatever background
 * the chat app uses, so it cannot follow a colour scheme — and the dark wordmark variant
 * on a light card would be the "FP LP" failure described at the top of this file, in the
 * one image seen by people who have never used the app. `#fbfbfc` is `--background`
 * light, matching the manifest's `background_color`.
 */
const CARD = { width: 1200, height: 630 }

/**
 * The landing page's gradient wash, flattened to an image.
 *
 * Same three brand stops as the `radial-gradient` in `src/app/page.tsx`, so the card and
 * the page a click later look like one thing. Drawn as an SVG because sharp rasterises it
 * directly; there is no CSS here to reuse.
 *
 * The opacities are **higher than the page's 0.12**, deliberately and not by much. That
 * value is tuned for a full viewport sitting behind body text; a card is met at thumbnail
 * size in a chat list, where the same wash disappears and leaves a white rectangle. These
 * were raised until the tint registered small and then pulled back until the wordmark was
 * still the only saturated thing on it — the rule in CLAUDE.md that the palette stays
 * neutral so the mark carries the colour. An earlier pass at 0.30/0.22/0.12 broke it: the
 * corners went pink and competed with the logo.
 */
const wash = Buffer.from(
  `<svg width="${CARD.width}" height="${CARD.height}" xmlns="http://www.w3.org/2000/svg">
     <defs>
       <radialGradient id="w" cx="50%" cy="0%" r="75%">
         <stop offset="0%" stop-color="#0399ec" stop-opacity="0.18" />
         <stop offset="35%" stop-color="#2762e1" stop-opacity="0.13" />
         <stop offset="70%" stop-color="#991ce1" stop-opacity="0.07" />
         <stop offset="100%" stop-color="#991ce1" stop-opacity="0" />
       </radialGradient>
     </defs>
     <rect width="100%" height="100%" fill="url(#w)" />
   </svg>`,
)

// 760px leaves the wordmark large enough to read in a phone-sized preview while keeping
// the margin above; the height follows the wordmark's own ratio rather than a guess.
const cardLogoWidth = 760
const cardLogoHeight = Math.round((cardLogoWidth * height) / width)

const cardLogo = await sharp(trimmed)
  .resize({ width: cardLogoWidth, withoutEnlargement: true })
  .png()
  .toBuffer()

await sharp({
  create: {
    width: CARD.width,
    height: CARD.height,
    channels: 4,
    background: { r: 0xfb, g: 0xfb, b: 0xfc, alpha: 1 },
  },
})
  .composite([
    { input: wash, top: 0, left: 0 },
    {
      input: cardLogo,
      top: Math.round((CARD.height - cardLogoHeight) / 2),
      left: Math.round((CARD.width - cardLogoWidth) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile('src/app/opengraph-image.png')

console.log(`[logo] wrote src/app/opengraph-image.png (${CARD.width}x${CARD.height})`)

console.log('[logo] done')
