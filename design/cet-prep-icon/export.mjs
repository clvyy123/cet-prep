import sharp from "sharp";
import path from "path";

const SRC = "E:/词炬/design/cet-prep-icon";
const variants = ["icon", "icon-mono", "icon-reverse"];
const sizes = [1024, 512, 192, 96, 48];

for (const v of variants) {
  const svg = path.join(SRC, `${v}.svg`);
  for (const s of sizes) {
    const suffix = s === 1024 ? "" : `-${s}`;
    await sharp(svg, { density: 300 })
      .resize(s, s)
      .png()
      .toFile(path.join(SRC, `${v}${suffix}.png`));
  }
  console.log(`${v}: done`);
}
console.log("ALL DONE");
