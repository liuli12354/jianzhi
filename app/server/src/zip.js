// 极简 store-only ZIP 生成器（零依赖）：条目不压缩，仅存储。
// 要点：CRC32 查表；通用标志 bit11 置位声明 UTF-8 文件名；不写目录占位条目（标准解压器均接受）。
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 生成 ZIP 文件。
 * 兼容性处理：按条目路径自动补显式目录条目（以 / 结尾、零长度）——
 * 部分解压器（如 Windows 资源管理器旧版）依赖目录条目还原空目录与排序。
 * @param {{ path: string, data: Buffer }[]} entries 条目（path 用 `/` 分隔，不得以 / 开头）
 * @returns {Buffer}
 */
export function buildZip(input) {
  const seenDirs = new Set()
  const entries = []
  for (const { path: p, data } of input) {
    const clean = String(p).replace(/\\/g, '/')
    const parts = clean.split('/')
    // 依次补目录条目（最后一段是文件名，跳过）
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/') + '/'
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir)
        entries.push({ path: dir, data: Buffer.alloc(0), isDir: true })
      }
    }
    entries.push({ path: clean, data, isDir: false })
  }

  const chunks = []
  const central = []
  let offset = 0

  for (const { path: p, data } of entries) {
    const nameBuf = Buffer.from(p, 'utf8')
    const crc = crc32(data)
    const size = data.length

    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)   // local file header 签名
    lfh.writeUInt16LE(20, 4)           // 解压所需版本
    lfh.writeUInt16LE(0x0800, 6)       // 标志：bit11 UTF-8 文件名
    lfh.writeUInt16LE(0, 8)            // 压缩方法：store
    lfh.writeUInt16LE(0, 10)           // 修改时间
    lfh.writeUInt16LE(0x21, 12)        // 修改日期（1980-01-01）
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(size, 18)        // 压缩后大小
    lfh.writeUInt32LE(size, 22)        // 原始大小
    lfh.writeUInt16LE(nameBuf.length, 26)
    lfh.writeUInt16LE(0, 28)           // 额外字段长度
    chunks.push(lfh, nameBuf, data)

    central.push({ nameBuf, crc, size, offset })
    offset += 30 + nameBuf.length + size
  }

  const cdStart = offset
  let cdSize = 0
  for (const e of central) {
    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)   // central directory 签名
    cdh.writeUInt16LE(20, 4)           // 压缩方版本
    cdh.writeUInt16LE(20, 6)           // 解压所需版本
    cdh.writeUInt16LE(0x0800, 8)       // 标志：bit11 UTF-8
    cdh.writeUInt16LE(0, 10)           // 压缩方法：store
    cdh.writeUInt16LE(0, 12)           // 修改时间
    cdh.writeUInt16LE(0x21, 14)        // 修改日期
    cdh.writeUInt32LE(e.crc, 16)
    cdh.writeUInt32LE(e.size, 20)
    cdh.writeUInt32LE(e.size, 24)
    cdh.writeUInt16LE(e.nameBuf.length, 28)
    // 30-41：额外字段/注释/磁盘号/内部属性 = 0
    cdh.writeUInt32LE(0, 38)           // 外部属性
    cdh.writeUInt32LE(e.offset, 42)    // 本地头偏移
    chunks.push(cdh, e.nameBuf)
    cdSize += 46 + e.nameBuf.length
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)    // EOCD 签名
  // 4-7：磁盘号 = 0
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)            // 注释长度
  chunks.push(eocd)

  return Buffer.concat(chunks)
}
