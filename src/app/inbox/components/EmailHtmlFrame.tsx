"use client";

import { useState, useEffect, useRef } from "react";

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
  body{word-wrap:break-word;overflow-wrap:break-word}
</style>`;

const HEIGHT_SCRIPT = `<script>
(function(){
  function h(){
    var s=Math.max(
      document.body?document.body.scrollHeight:0,
      document.documentElement?document.documentElement.scrollHeight:0
    );
    if(s>0)window.parent.postMessage({__cpEmailH:s},'*');
  }
  window.addEventListener('load',function(){
    h();
    var imgs=document.querySelectorAll('img'),n=imgs.length;
    if(!n)return;
    imgs.forEach(function(i){
      if(i.complete){if(!--n)h();}
      else{
        i.addEventListener('load',function(){if(!--n)h();},{once:true});
        i.addEventListener('error',function(){if(!--n)h();},{once:true});
      }
    });
  });
  setTimeout(h,800);
})();
<\/script>`;

function buildSrcDoc(raw: string): string {
  const upgraded = upgradeHttpUrls(raw);
  const inject = BASE_STYLES + HEIGHT_SCRIPT;

  if (/<html\b/i.test(upgraded)) {
    const result = upgraded.replace(/(<head[^>]*>)/i, `$1\n${inject}`);
    if (result !== upgraded) return result;
  }

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${inject}
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;
       margin:0;padding:16px;color:#333}
  a{color:#1a73e8}
</style>
</head><body>${upgraded}</body></html>`;
}

export function EmailHtmlFrame({ html, minHeight = 530 }: { html: string; minHeight?: number }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const MIN_EMAIL_FRAME_HEIGHT = minHeight;
  const [height, setHeight] = useState(MIN_EMAIL_FRAME_HEIGHT);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const h = e.data?.__cpEmailH;
      if (typeof h === "number" && h > 0) setHeight(h);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcDoc(html)}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      className="w-full border-0 block"
      style={{ height: Math.max(height, MIN_EMAIL_FRAME_HEIGHT) }}
      title="Email content"
    />
  );
}
