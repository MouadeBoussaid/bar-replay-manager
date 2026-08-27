// Generate app icons from a single source PNG.
//   node scripts/make-icons.mjs [path-to-source.png]
// Writes: build/icon.ico, build/icon.png (256), resources/icon.png (256),
//         src/renderer/src/assets/icon.png (256, bundled into the title bar).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Jimp } from 'jimp'
import pngToIcoMod from 'png-to-ico'

const pngToIco = pngToIcoMod.default ?? pngToIcoMod
const root = resolve(fileURLToPath(import.meta.url), '../..')

const src =
  process.argv[2] ??
  'C:/Users/mouad/projects/66db72b254c9b267644377f7_favicon (2024).png'

if (!existsSync(src)) {
  console.error(`Source icon not found: ${src}`)
  process.exit(1)
}

const ensure = (p) => {
  const d = dirname(p)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return p
}

const base = await Jimp.read(src)

// Upscale (nearest-neighbour keeps a tiny pixel-art source crisp).
async function pngAt(size) {
  const img = base.clone().resize({ w: size, h: size, mode: 'nearestNeighbor' })
  return img.getBuffer('image/png')
}

const sizes = [256, 128, 64, 48, 32, 16]
const buffers = await Promise.all(sizes.map(pngAt))

const png256 = buffers[0]
writeFileSync(ensure(join(root, 'build/icon.png')), png256)
writeFileSync(ensure(join(root, 'resources/icon.png')), png256)
writeFileSync(ensure(join(root, 'src/renderer/src/assets/icon.png')), png256)

const ico = await pngToIco(buffers)
writeFileSync(ensure(join(root, 'build/icon.ico')), ico)

console.log(
  'wrote build/icon.ico, build/icon.png, resources/icon.png, src/renderer/src/assets/icon.png'
)
