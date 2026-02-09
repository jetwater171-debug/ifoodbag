const fs = require('fs');
const path = require('path');

const pages = ['index','quiz','dados','endereco','processando','checkout','orderbump','pix','sucesso','admin','admin-tracking','admin-utmfy','admin-pages','admin-leads'];
const root = process.cwd();

function extractBody(html) {
  const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return { attrs: '', inner: '' };
  const attrs = bodyMatch[1] || '';
  let inner = bodyMatch[2] || '';
  inner = inner.replace(/<script[\s\S]*?<\/script>/gi, '');
  return { attrs: attrs.trim(), inner: inner.trim() };
}

function ensureDataPage(attrs, page) {
  if (/data-page\s*=/.test(attrs)) return attrs;
  const pageMap = {
    index: 'home',
    quiz: 'quiz',
    dados: 'personal',
    endereco: 'cep',
    processando: 'processing',
    checkout: 'checkout',
    orderbump: 'orderbump',
    pix: 'pix',
    sucesso: 'success',
    admin: 'admin',
    'admin-tracking': 'admin',
    'admin-utmfy': 'admin',
    'admin-pages': 'admin',
    'admin-leads': 'admin'
  };
  const dataPage = pageMap[page] || page;
  return (attrs ? attrs + ' ' : '') + `data-page="${dataPage}"`;
}

function writePageComponent(name, innerHtml) {
  const componentName = name.replace(/(^|-)\w/g, (m) => m.replace('-', '').toUpperCase()) + 'Page';
  const content = `import React from 'react';\n\nconst html = ${JSON.stringify(innerHtml)};\n\nexport default function ${componentName}() {\n  return <div className=\"page-root\" dangerouslySetInnerHTML={{ __html: html }} />;\n}\n`;
  fs.writeFileSync(path.join(root, 'src', 'pages', `${name}.tsx`), content, 'utf8');
  return componentName;
}

function writeEntry(name) {
  const entry = `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport '/style.css';\nimport '/script.js';\nimport Page from '../pages/${name}';\n\nconst root = document.getElementById('root');\nif (root) {\n  createRoot(root).render(<Page />);\n}\n`;
  fs.writeFileSync(path.join(root, 'src', 'entries', `${name}.tsx`), entry, 'utf8');
}

function updateHtml(name, attrs) {
  const htmlPath = path.join(root, `${name}.html`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : '<head></head>';
  const safeAttrs = ensureDataPage(attrs, name);
  const body = `<body ${safeAttrs}>\n  <div id=\"root\"></div>\n  <script type=\"module\" src=\"/src/entries/${name}.tsx\"></script>\n</body>`;
  const doc = `<!DOCTYPE html>\n<html lang=\"pt-BR\">\n${head}\n${body}\n</html>\n`;
  fs.writeFileSync(htmlPath, doc, 'utf8');
}

fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
fs.mkdirSync(path.join(root, 'src', 'entries'), { recursive: true });

pages.forEach((name) => {
  const htmlPath = path.join(root, `${name}.html`);
  if (!fs.existsSync(htmlPath)) return;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const { attrs, inner } = extractBody(html);
  writePageComponent(name, inner);
  writeEntry(name);
  updateHtml(name, attrs);
});