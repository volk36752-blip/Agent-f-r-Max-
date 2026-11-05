// Plugin „Schlagzeilen“: aktuelle Nachrichten der Tagesschau (ohne Anmeldung).

const FEEDS = [
  'https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml',
  'https://www.tagesschau.de/xml/rss2/',
];

let cache = { at: 0, items: null };

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRss(xml) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[0];
    const pick = (tag) => decode((new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block) || [])[1]);
    const title = pick('title');
    if (!title) continue;
    const date = Date.parse(pick('pubDate'));
    items.push({ title, link: pick('link'), text: pick('description').slice(0, 300), dateMs: Number.isFinite(date) ? date : null });
  }
  return items;
}

async function headlines() {
  if (cache.items && Date.now() - cache.at < 15 * 60000) return cache.items;
  let lastErr;
  for (const url of (process.env.NEWS_FEED_URL ? [process.env.NEWS_FEED_URL] : FEEDS)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Assistent/0.3' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseRss(await res.text());
      if (items.length) {
        cache = { at: Date.now(), items };
        return items;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Die Schlagzeilen sind gerade nicht erreichbar${lastErr ? ` (${lastErr.message})` : ''}.`);
}

export default {
  id: 'schlagzeilen',
  name: 'Schlagzeilen',
  description: 'Aktuelle Nachrichten der Tagesschau – als Widget auf der Startseite und für Fragen wie „Was gibt’s Neues?“.',
  icon: 'news',
  color: 'teal',
  examples: ['Was gibt’s Neues?', 'Gibt es Nachrichten zum Wetter?'],
  tools: [
    {
      name: 'news_headlines',
      title: 'Schlagzeilen',
      short: 'Aktuelle Schlagzeilen (optional zu einem Thema).',
      description: 'Holt die aktuellen Schlagzeilen der Tagesschau. Optional nach einem Thema filtern.',
      input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Thema (optional)' }, limit: { type: 'integer', minimum: 1, maximum: 15 } }, required: [], additionalProperties: false },
      readOnly: true,
      async run(args) {
        let items = await headlines();
        if (args.topic) {
          const q = args.topic.toLowerCase();
          items = items.filter((i) => `${i.title} ${i.text}`.toLowerCase().includes(q));
        }
        return { quelle: 'tagesschau.de', schlagzeilen: items.slice(0, args.limit || 8).map((i) => ({ titel: i.title, kurz: i.text, link: i.link })) };
      },
    },
  ],
  widget: {
    title: 'Schlagzeilen',
    async load(ctx, { big = false } = {}) {
      const items = await headlines();
      return { items: items.slice(0, big ? 12 : 6).map((i) => ({ title: i.title, link: i.link, dateMs: i.dateMs, text: big ? i.text : undefined })) };
    },
  },
};
