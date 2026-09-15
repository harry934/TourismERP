const fs = require('fs');
const path = require('path');

const distFile = path.join(__dirname, '..', 'web', 'dist', 'index.html');
const outFile = path.join(__dirname, '..', 'src', 'Index.html');

if (!fs.existsSync(distFile)) {
  throw new Error('web/dist/index.html is missing. Run npm --prefix web run build first.');
}

let html = fs.readFileSync(distFile, 'utf8');
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, function (full, attrs, body) {
  const safeBody = body.replace(/<\/script/gi, '<\\/script');
  return '<script' + attrs + '>' + safeBody + '</script>';
});

if (!/<base\s/i.test(html)) {
  html = html.replace('<head>', '<head>\n  <base target="_top">');
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log('Wrote', outFile, '(' + html.length + ' bytes)');
