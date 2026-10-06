/**
 * 极简 ZIP 打包（STORE 不压缩），纯前端生成归档包，不引第三方依赖。
 * 文件名走 UTF-8（通用位置标志第 11 位），中文在系统解压工具里不乱码。
 */

export interface ZipEntry {
  path: string
  content: string
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 取固定基准日期对应的 DOS 时间，避免不同机器打出来的包不稳定。 */
function dosDateTime(date = new Date()): { time: number; day: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) << 0)
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

export function buildZip(entries: ZipEntry[]): Blob {
  const { time, day } = dosDateTime()
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const dataBytes = encoder.encode(entry.content)
    const crc = crc32(dataBytes)

    const local = new ArrayBuffer(30 + nameBytes.length)
    const lv = new DataView(local)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20)
    u16(lv, 6, 0x0800) // UTF-8 文件名标志
    u16(lv, 8, 0) // STORE
    u16(lv, 10, time)
    u16(lv, 12, day)
    u32(lv, 14, crc)
    u32(lv, 18, dataBytes.length)
    u32(lv, 22, dataBytes.length)
    u16(lv, 26, nameBytes.length)
    u16(lv, 28, 0)
    new Uint8Array(local, 30).set(nameBytes)

    const central = new ArrayBuffer(46 + nameBytes.length)
    const cv = new DataView(central)
    u32(cv, 0, 0x02014b50)
    u16(cv, 4, 20)
    u16(cv, 6, 20)
    u16(cv, 8, 0x0800)
    u16(cv, 10, 0)
    u16(cv, 12, time)
    u16(cv, 14, day)
    u32(cv, 16, crc)
    u32(cv, 20, dataBytes.length)
    u32(cv, 24, dataBytes.length)
    u16(cv, 28, nameBytes.length)
    u16(cv, 30, 0) // extra field length
    u16(cv, 32, 0) // comment length
    u16(cv, 34, 0) // disk number start
    u16(cv, 36, 0) // internal file attributes
    u32(cv, 38, 0) // external file attributes
    u32(cv, 42, offset) // relative offset of local header
    new Uint8Array(central, 46).set(nameBytes)

    const localBytes = new Uint8Array(local)
    chunks.push(localBytes, dataBytes)
    centrals.push(new Uint8Array(central))
    offset += localBytes.length + dataBytes.length
  }

  let centralSize = 0
  for (const part of centrals) {
    chunks.push(part)
    centralSize += part.length
  }

  const eocd = new ArrayBuffer(22)
  const ev = new DataView(eocd)
  u32(ev, 0, 0x06054b50)
  u16(ev, 4, 0)
  u16(ev, 6, 0)
  u16(ev, 8, entries.length)
  u16(ev, 10, entries.length)
  u32(ev, 12, centralSize)
  u32(ev, 16, offset)
  u16(ev, 20, 0)
  chunks.push(new Uint8Array(eocd))

  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}
