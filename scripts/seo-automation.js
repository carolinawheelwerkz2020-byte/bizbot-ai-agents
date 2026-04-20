import fs from 'fs';
import path from 'path';

const indexPath = path.resolve('index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// 1. Update Title
const newTitle = "Carolina Wheel Werkz | Wheel Repair & Powder Coating Raleigh";
if (html.includes('<title>')) {
  html = html.replace(/<title>.*?<\/title>/, `<title>${newTitle}</title>`);
} else {
  html = html.replace('</head>', `  <title>${newTitle}</title>\n  </head>`);
}

// 2. Update Description
const description = "Premium alloy wheel repair, powder coating, and rim straightening in Raleigh, Wake Forest, and North Carolina. Fast turnaround and professional finish.";
const metaDesc = `<meta name="description" content="${description}">`;
if (html.includes('<meta name="description"')) {
  html = html.replace(/<meta name="description".*?>/, metaDesc);
} else {
  html = html.replace('</head>', `  ${metaDesc}\n  </head>`);
}

// 3. Inject Local Business Schema (Idempotent)
const schema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Carolina Wheel Werkz",
  "image": "https://carolinawheelwerkz.com/logo.png",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "3015 Stony Brook Dr",
    "addressLocality": "Raleigh",
    "addressRegion": "NC",
    "postalCode": "27604",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 35.8235,
    "longitude": -78.5831
  },
  "url": "https://carolinawheelwerkz.com",
  "telephone": "+19195550199",
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "08:00",
      "closes": "17:00"
    }
  ]
};

const schemaMarkerStart = '<!-- BIZBOT_SCHEMA_START -->';
const schemaMarkerEnd = '<!-- BIZBOT_SCHEMA_END -->';
const schemaScript = `\n    ${schemaMarkerStart}\n    <script type="application/ld+json">\n    ${JSON.stringify(schema, null, 2)}\n    </script>\n    ${schemaMarkerEnd}\n  </head>`;

if (html.includes(schemaMarkerStart)) {
  const regex = new RegExp(`${schemaMarkerStart}[\\s\\S]*?${schemaMarkerEnd}\\s*<\/head>`, 'g');
  html = html.replace(regex, schemaScript);
} else {
  html = html.replace('</head>', schemaScript);
}

fs.writeFileSync(indexPath, html);
console.log("SEO Metadata and Schema updated in index.html");
