import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pngToIco from 'png-to-ico';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'assets', 'logo.png');
const outputPath = path.join(root, 'assets', 'logo.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const resample = (source, size) => {
  const output = new PNG({ width: size, height: size });
  const scaleX = source.width / size;
  const scaleY = source.height / size;

  for (let y = 0; y < size; y++) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const weightY = sourceY - y0;

    for (let x = 0; x < size; x++) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const weightX = sourceX - x0;
      const target = (size * y + x) << 2;

      for (let channel = 0; channel < 4; channel++) {
        const topLeft = source.data[(source.width * y0 + x0) * 4 + channel];
        const topRight = source.data[(source.width * y0 + x1) * 4 + channel];
        const bottomLeft = source.data[(source.width * y1 + x0) * 4 + channel];
        const bottomRight = source.data[(source.width * y1 + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * weightX;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
        output.data[target + channel] = Math.round(top + (bottom - top) * weightY);
      }
    }
  }
  return output;
};

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const frames = SIZES.map(size =>
  PNG.sync.write(size === source.width ? source : resample(source, size))
);

fs.writeFileSync(outputPath, await pngToIco(frames));
process.stdout.write(`Built assets/logo.ico (${SIZES.join(', ')}px)\n`);
