// Gera os ícones do site e da app móvel a partir de um só desenho (o escudo com o visto).
// Corre com `npm run icons` (pasta frontend/) e usa o Chromium do Playwright para passar o
// SVG a PNG. Os ficheiros gerados vão para o repositório: só é preciso correr isto ao mudar
// o desenho.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BLUE = '#2563eb'
const BLUE_DARK = '#1d4ed8'

// O escudo e o visto, numa grelha de 1024 × 1024, centrados.
const SHIELD =
  'M512 176 L772 274 C772 274 782 520 742 628 C698 748 604 820 512 862 ' +
  'C420 820 326 748 282 628 C242 520 252 274 252 274 Z'
const CHECK = 'M392 520 L480 608 L640 440'

/** O desenho, com o escudo a ocupar `scale` do tamanho e o fundo pedido. */
function svg({ background = 'none', radius = 0, scale = 1, shield = '#fff', check = BLUE, cutout = false }) {
  const t = (1 - scale) * 512
  const gradient =
    background === 'gradient'
      ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${BLUE_DARK}"/>
         </linearGradient></defs>`
      : ''
  const fill = background === 'gradient' ? 'url(#bg)' : background
  const rect = background === 'none' ? '' : `<rect width="1024" height="1024" rx="${radius}" fill="${fill}"/>`
  // No ícone monocromático do Android, o visto é um recorte (transparente) no escudo.
  const mark = cutout
    ? `<mask id="m"><rect width="1024" height="1024" fill="#fff"/>
         <path d="${CHECK}" stroke="#000" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask>
       <path d="${SHIELD}" fill="${shield}" mask="url(#m)"/>`
    : `<path d="${SHIELD}" fill="${shield}"/>
       <path d="${CHECK}" stroke="${check}" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${gradient}${rect}
    <g transform="translate(${t} ${t}) scale(${scale})">${mark}</g></svg>`
}

// Cada ficheiro: o desenho e o tamanho em píxeis (sem tamanho, guarda-se o SVG).
const outputs = [
  // Site: favicon em SVG (cantos redondos) e o ícone do ecrã inicial do iPhone.
  ['frontend/public/favicon.svg', svg({ background: BLUE, radius: 224 })],
  ['frontend/public/apple-touch-icon.png', svg({ background: 'gradient' }), 180],
  // App: o iOS e o Android arredondam os cantos sozinhos, por isso o ícone é quadrado e sem
  // transparência.
  ['mobile/assets/icon.png', svg({ background: 'gradient' }), 1024],
  ['mobile/assets/favicon.png', svg({ background: BLUE, radius: 224 }), 48],
  // Ícone adaptativo do Android: o sistema recorta-o (círculo, quadrado…) e só garante o
  // centro (66 %), por isso o escudo é mais pequeno.
  ['mobile/assets/android-icon-foreground.png', svg({ scale: 0.72 }), 1024],
  ['mobile/assets/android-icon-background.png', svg({ background: BLUE }), 1024],
  ['mobile/assets/android-icon-monochrome.png', svg({ scale: 0.72, cutout: true }), 1024],
  // Ecrã de arranque: o escudo sozinho, sobre a cor de fundo do app.json.
  ['mobile/assets/splash-icon.png', svg({ scale: 0.9, shield: BLUE, check: '#fff' }), 1024],
]

// Como nos E2E (playwright.config.ts): PW_CHROMIUM_PATH aponta para um Chromium já instalado.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
const page = await browser.newPage()
for (const [path, image, size] of outputs) {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  if (!size) {
    await writeFile(file, image.replace(/\s*\n\s*/g, ' ') + '\n')
  } else {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${image}`,
    )
    await page.screenshot({ path: file, omitBackground: true })
  }
  console.log(`${path}${size ? ` (${size}px)` : ''}`)
}
await browser.close()
