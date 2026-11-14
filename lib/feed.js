import { decodeEntities, plainText } from './util.js';

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function attr(block, re) {
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : '';
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/.test(a)) ?? links.find((a) => !/rel=/.test(a)) ?? links[0];
  return pick ? attr(pick, /href=["']([^"']+)["']/) : '';
}

function findImage(block, html) {
  return (
    attr(block, /<media:(?:content|thumbnail)[^>]*\burl=["']([^"']+)["']/i) ||
    attr(block, /<enclosure[^>]*\burl=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i) ||
    attr(decodeEntities(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')), /<img[^>]*\bsrc=["'](https?:[^"']+)["']/i)
  );
}

// Minimal RSS 2.0 / Atom parser: enough for the title, link, date, summary and image.
export function parseFeed(xml) {
  const atom = /<feed[\s>]/.test(xml) && !/<rss[\s>]/.test(xml);
  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/g : /<item[\s>][\s\S]*?<\/item>/g) ?? [];
  return blocks.map((b) => {
    const rich = tag(b, 'content:encoded') || tag(b, 'content') || '';
    const desc = tag(b, 'description') || tag(b, 'summary') || rich;
    const rawDate = plainText(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const date = rawDate ? new Date(rawDate) : null;
    return {
      title: plainText(tag(b, 'title')),
      url: (atom ? atomLink(b) : plainText(tag(b, 'link'))) || plainText(tag(b, 'guid')),
      date: date && !Number.isNaN(date.getTime()) ? date : null,
      summary: plainText(desc),
      image: findImage(b, desc + rich),
    };
  });
}
