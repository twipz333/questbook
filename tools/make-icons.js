// Renders build/icon.png + tray.png with Electron (run: xvfb-run electron tools/make-icons.js --no-sandbox)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
const SWORD = '<path d="m11 19-6-6" /> <path d="m5 21-2-2" /> <path d="m8 16-4 4" /> <path d="M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5" />';
function svg(size, tray) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  ${tray ? '' : '<rect x="2" y="2" width="60" height="60" rx="14" fill="#0E0D14"/><rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#4A4360"/>'}
  <g transform="rotate(45 32 32)"><rect x="${tray?10:15}" y="${tray?10:15}" width="${tray?44:34}" height="${tray?44:34}" rx="5" fill="url(#g)"/></g>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2C766"/><stop offset="1" stop-color="#C9922F"/></linearGradient></defs>
  <g transform="translate(${tray?16:19} ${tray?16:19}) scale(${tray?1.34:1.08})" fill="none" stroke="#1A1408" stroke-width="${tray?2.6:2.4}" stroke-linecap="round" stroke-linejoin="round">${SWORD}</g>
  </svg>`;
}
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'build');
  for (const [name, size, tray] of [['icon.png', 256, false], ['icon-64.png', 64, false], ['icon-48.png', 48, false], ['icon-32.png', 32, false], ['icon-16.png', 16, false], ['tray.png', 32, true], ['tray-16.png', 16, true]]) {
    const w = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
    const tmp = path.join(require('os').tmpdir(), 'qb-icon-' + name + '.html');
    fs.writeFileSync(tmp, '<html><body style="margin:0;background:transparent">' + svg(size, tray) + '</body></html>');
    await w.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 300));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    fs.writeFileSync(path.join(out, name), img.resize({ width: size, height: size }).toPNG());
    w.destroy();
  }
  app.quit();
});
