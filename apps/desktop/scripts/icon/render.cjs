// Renders build/icon.svg to a 1024×1024 PNG with Chromium (via Electron), so
// gradients and shadows match what the SVG shows in a browser.
// Usage: electron scripts/icon/render.cjs <in.svg> <out.png>
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');

const [input, output] = process.argv.slice(-2);
app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const svg = readFileSync(input, 'utf8');
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="1024" height="1024" style="display:block">
  </body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(output, image.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG());
  app.exit(0);
});
