const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function makePng(width, height, r, g, b, a = 255) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function writeChunk(type, data) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([lenBuf, typeAndData, crcBuf]);
  }

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = 1 + width * 4;
  const rawData = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowLen;
    rawData[offset] = 0;
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 4;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    header,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', compressed),
    writeChunk('IEND', Buffer.alloc(0))
  ]);
}

const assetsDir = path.join(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

fs.writeFileSync(path.join(assetsDir, 'icon.png'), makePng(512, 512, 16, 185, 129));
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), makePng(512, 512, 16, 185, 129));
fs.writeFileSync(path.join(assetsDir, 'splash-icon.png'), makePng(512, 512, 15, 23, 42));
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), makePng(128, 128, 16, 185, 129));

console.log('Successfully generated clean PNG assets!');
