/** 生成 PWA 图标：192 / 512 / maskable-512 / apple-touch-180（MD3 主题色 + 音符） */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve('public/icons')
fs.mkdirSync(OUT, { recursive: true })

const BG = '#141218' // theme-color（MD3 dark surface）
const FG = '#D0BCFF' // MD3 dark primary（与 favicon 同款音符）
// favicon 的 24 单元音符路径
const NOTE = 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z'

function svg(size, glyphScale) {
  const g = 24 * glyphScale // 音符在画布上的边长
  const off = (size - g) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${off},${off}) scale(${g / 24})">
    <path d="${NOTE}" fill="${FG}"/>
  </g>
</svg>`
}

const jobs = [
  ['pwa-192.png', 192, 0.62],
  ['pwa-512.png', 512, 0.62],
  ['pwa-maskable-512.png', 512, 0.46], // maskable 安全区：内容 ≤ 中心 60%
  ['apple-touch-icon.png', 180, 0.62],
]

for (const [name, size, scale] of jobs) {
  await sharp(Buffer.from(svg(size, scale))).png().toFile(path.join(OUT, name))
  console.log('generated', name)
}
