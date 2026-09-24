// build-demo.mjs — bundle dist/ into one self-contained HTML running the demo estate.
// usage: cd dashboard && npm run build && node ../scripts/build-demo.mjs > ../beacon-demo.html
import fs from "fs";
import path from "path";
const dist = path.resolve("dist");
let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const asset = (p) => fs.readFileSync(path.join(dist, p));
const dataUri = (p, mime) => `data:${mime};base64,${asset(p).toString("base64")}`;
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/, (_, p) => `<style>${asset(p).toString("utf8")}</style>`);
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/, (_, p) => {
  let js = asset(p).toString("utf8");
  for (const img of ["nxzen-wordmark.png", "nxzen-mark.png", "favicon.png"]) js = js.split(`./${img}`).join(dataUri(img, "image/png"));
  return `<script type="module">${js}</script>`;
});
html = html.replace('href="./favicon.png"', `href="${dataUri("favicon.png", "image/png")}"`);
html = html.replace("<head>", `<head>\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n<script>window.__BEACON_CONFIG__={brand:"Beacon",tagline:"Every fitting. Every test. On record.",demo:true};</script>`);
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1.0" />', "");
process.stdout.write(html);
