// 生成一张演示用 24 位 BMP 渐变图（零依赖），用于附件功能验收
import fs from 'node:fs'

const W = 360
const H = 220
const rowSize = Math.ceil((W * 3) / 4) * 4
const pixelBytes = rowSize * H
const fileSize = 54 + pixelBytes

const buf = Buffer.alloc(fileSize)
buf.write('BM', 0)
buf.writeUInt32LE(fileSize, 2)
buf.writeUInt32LE(54, 10)
buf.writeUInt32LE(40, 14)
buf.writeInt32LE(W, 18)
buf.writeInt32LE(H, 22)
buf.writeUInt16LE(1, 26)
buf.writeUInt16LE(24, 28)
buf.writeUInt32LE(pixelBytes, 34)

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = 54 + y * rowSize + x * 3
    const fy = y / H
    const fx = x / W
    // 天蓝→紫的竖向渐变 + 一轮"月亮"和几颗"星"
    let r = Math.round(90 + 90 * fx)
    let g = Math.round(150 - 40 * fy)
    let b = Math.round(230 - 60 * fy)
    const mx = W * 0.72
    const my = H * 0.3
    const d = Math.hypot(x - mx, y - my)
    if (d < 34) { r = 255; g = 244; b = 214 }
    else if (d < 36) { r = 255; g = 236; b = 170 }
    const star = (x * 7 + y * 13) % 97
    if (star === 1 && y < H * 0.55) { r = 255; g = 255; b = 230 }
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r
  }
}

fs.writeFileSync(new URL('./sample-image.bmp', import.meta.url), buf)
console.log('sample-image.bmp written:', fileSize, 'bytes')
