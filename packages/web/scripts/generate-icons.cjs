// Renders static/icons/icon.svg to the PNG sizes the web app manifest and iOS need.
// Run from the repo root: node packages/web/scripts/generate-icons.cjs (uses the api package's sharp).
const path = require('path');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../../api')] }));

const dir = path.join(__dirname, '../static/icons');
const svg = path.join(dir, 'icon.svg');
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };

(async () => {
	for (const [name, size] of Object.entries(sizes)) {
		await sharp(svg, { density: 300 }).resize(size, size).png().toFile(path.join(dir, name));
		console.log('wrote', name);
	}
})();
