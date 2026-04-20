import fs from 'fs';
import path from 'path';

const domain = "https://carolinawheelwerkz.com";
const routes = [
  "/",
  "/wheel-repair-raleigh",
  "/wheel-repair-wake-forest",
  "/wheel-repair-cary",
  "/wheel-repair-durham",
  "/wheel-repair-apex",
  "/powder-coating-raleigh"
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map(route => `
  <url>
    <loc>${domain}${route}</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('')}
</urlset>`;

const outputPath = path.resolve('public/sitemap.xml');
fs.writeFileSync(outputPath, sitemap);
console.log("Sitemap generated at public/sitemap.xml");
