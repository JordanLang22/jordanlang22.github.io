// Turns a photo into a 1-bit Atkinson dither, the kind of portrait a photocopied file would hold.
// Usage: node scripts/make-portrait.mjs <source-image>
import sharp from 'sharp';

const WIDTH = 360;
const HEIGHT = 450;
const source = process.argv[2];
if (!source) throw new Error('Pass the source image path.');

const { data, info } = await sharp(source)
  .extract({ left: 250, top: 50, width: 620, height: 775 })
  .resize(WIDTH, HEIGHT)
  .grayscale()
  .normalise()
  .linear(1.15, -12)
  .raw()
  .toBuffer({ resolveWithObject: true });

const pixels = Float32Array.from(data);
const NEIGHBOURS = [
  [1, 0],
  [2, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [0, 2],
];
for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    const index = y * info.width + x;
    const value = pixels[index] ?? 0;
    const output = value < 128 ? 0 : 255;
    const error = (value - output) / 8;
    pixels[index] = output;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < info.width && ny < info.height) {
        const neighbour = ny * info.width + nx;
        pixels[neighbour] = (pixels[neighbour] ?? 0) + error;
      }
    }
  }
}

await sharp(Buffer.from(Uint8Array.from(pixels)), {
  raw: { width: info.width, height: info.height, channels: 1 },
})
  .png({ palette: true, colours: 2, compressionLevel: 9 })
  .toFile('public/portrait.png');
