"use client";

// ─── HTML email iframe ────────────────────────────────────────────────────────

function upgradeHttpUrls(html: string): string {
  return html
    .replace(/(<img[^>]+\bsrc\s*=\s*["'])http:\/\//gi, "$1https://")
    .replace(/(<[^>]+\bbackground(?:-image)?\s*=\s*["'])http:\/\//gi, "$1https://")
    .replace(/url\(\s*["']?http:\/\//gi, "url(https://");
}

const BASE_STYLES = `
<base target="_blank">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src * data: blob:; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none';">
<style>
  img{max-width:100%!important;height:auto}
  table{max-width:100%!important}
  body{word-wrap:break-word;overflow-wrap:break-word;font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}
</style>`;

function buildSrcDoc(raw: string): string {
  const upgraded = upgradeHttpUrls(raw);
  const inject = BASE_STYLES;

  if (/<html\b/i.test(upgraded)) {
    const result = upgraded.replace(/(<head[^>]*>)/i, `$1\n${inject}`);
    if (result !== upgraded) return result;
  }

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${inject}
<style>
  body{font-family:Inter,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;
       margin:0;padding:16px;color:#333}
  a{color:#1a73e8}
</style>
</head><body>${upgraded}</body></html>`;
}

export function EmailHtmlFrame({ html, minHeight = 530 }: { html: string; minHeight?: number }) {
  return (
    <iframe
      srcDoc={buildSrcDoc(html)}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      className="w-full border-0 block"
      style={{ height: minHeight }}
      title="Email content"
    />
  );
}
