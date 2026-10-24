import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('build', { recursive: true });
const image = size => sharp('public/icon.svg').resize(size, size).png().toBuffer();
const png = await image(1024);
await writeFile('build/icon.png', png);
await writeFile('public/icon.png', png);

const icoImage = await image(256);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(icoImage.length, 14);
icoHeader.writeUInt32LE(22, 18);
await writeFile('build/icon.ico', Buffer.concat([icoHeader, icoImage]));

const chunks = await Promise.all(
  [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
    .map(async ([type, size]) => {
      const data = await image(size);
      const header = Buffer.alloc(8);
      header.write(type, 0);
      header.writeUInt32BE(data.length + 8, 4);
      return Buffer.concat([header, data]);
    }),
);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await writeFile('build/icon.icns', Buffer.concat([icnsHeader, ...chunks]));
