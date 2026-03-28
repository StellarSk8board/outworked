#!/usr/bin/env node
// Regenerate build/icon.ico from build/icon.png.
// Requires: npm install  (png-to-ico is in devDependencies)
//
// Usage: npm run generate-ico
//
// Produces a multi-resolution ICO with sizes:
//   16×16  24×24  32×32  48×48  64×64  128×128  256×256
// These cover all standard Windows taskbar, Start menu, and
// file-explorer icon display contexts.

const pngToIco = require("png-to-ico");
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "build", "icon.png");
const dst = path.join(__dirname, "..", "build", "icon.ico");

if (!fs.existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

pngToIco(src)
  .then((buf) => {
    fs.writeFileSync(dst, buf);
    console.log(`Generated ${dst} (${(buf.length / 1024).toFixed(1)} KB)`);
  })
  .catch((err) => {
    console.error("Failed to generate icon.ico:", err.message);
    process.exit(1);
  });
