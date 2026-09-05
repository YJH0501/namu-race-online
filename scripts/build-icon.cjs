// Build-time conversion of our existing vector icon, not generated artwork.
const path = require('node:path');
const sharp = require(process.env.NAMU_RACE_SHARP_PATH || 'sharp');
const assets = path.join(__dirname, '..', 'src', 'assets');
sharp(path.join(assets, 'icon.svg')).resize(1024, 1024).png()
  .toFile(path.join(assets, 'icon.png')).then(() => console.log('Leaf icon: 1024 × 1024 PNG'));
