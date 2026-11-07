// Yuque "代办" scraper for the desktop todo widget.
// Fetches the public doc page, resolves the API payload, and turns the lake HTML
// into items: one item per Heading 1 (falling back to plain paragraph blocks),
// with links and Yuque cards collected as cards under that item.

export const DOC_URL = 'https://pkuschool.yuque.com/ggicnw/hxnoxy/hdocbvbfqcppgrif';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const VOID_TAGS = new Set([
  'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'col', 'area', 'base', 'embed', 'param', 'track', 'wbr',
]);

const ZERO_WIDTH = /[\u200b\u200c\u200d\ufeff]/g;

function decodeEntities(input) {
  return String(input)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '');
}

function plainText(html) {
  return decodeEntities(stripTags(html))
    .replace(ZERO_WIDTH, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(attrSource, name) {
  const found = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(attrSource);
  return found ? decodeEntities(found[1]) : '';
}

function looksLikeUrl(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/^(https?:)?\/\//i.test(value)) return true;
  if (/^www\./i.test(value)) return true;
  return !/\s/.test(value) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const SITE_NAMES = [
  ['bilibili.com', '哔哩哔哩'],
  ['b23.tv', '哔哩哔哩'],
  ['yuque.com', '语雀'],
  ['zhihu.com', '知乎'],
  ['github.com', 'GitHub'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['juejin.cn', '掘金'],
  ['weixin.qq.com', '微信公众号'],
  ['docs.qq.com', '腾讯文档'],
  ['feishu.cn', '飞书'],
  ['notion.so', 'Notion'],
  ['douban.com', '豆瓣'],
  ['xiaohongshu.com', '小红书'],
  ['weibo.com', '微博'],
];

function siteName(url) {
  const host = hostOf(url);
  const hit = SITE_NAMES.find(([domain]) => host === domain || host.endsWith('.' + domain));
  return hit ? hit[1] : host;
}

function clamp(text, limit) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > limit ? value.slice(0, limit - 1).trimEnd() + '…' : value;
}

// Split the lake body into top-level elements, keeping each element's inner HTML.
function splitTopLevel(html) {
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<[^>]+>/g;
  const blocks = [];
  let depth = 0;
  let openTag = null;
  let openStart = 0;
  let innerStart = 0;
  let match;

  while ((match = tagPattern.exec(html)) !== null) {
    const token = match[0];
    if (token.startsWith('<!--') || token.startsWith('<!')) continue;

    const closing = /^<\//.test(token);
    const nameMatch = /^<\/?\s*([a-zA-Z][\w:-]*)/.exec(token);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const selfClosing = /\/>$/.test(token);

    if (closing) {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && openTag) {
        blocks.push({
          tag: openTag,
          raw: html.slice(openStart, tagPattern.lastIndex),
          inner: html.slice(innerStart, match.index),
        });
        openTag = null;
      }
      continue;
    }

    if (VOID_TAGS.has(name) || selfClosing) {
      if (depth === 0) blocks.push({ tag: name, raw: token, inner: token });
      continue;
    }

    if (depth === 0) {
      openTag = name;
      openStart = match.index;
      innerStart = tagPattern.lastIndex;
    }
    depth += 1;
  }

  return blocks;
}

function readYuqueCard(attrSource) {
  const value = attr(attrSource, 'value');
  if (!value.startsWith('data:')) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(value.slice(5)));
    const detail = payload.detail || {};
    const url = detail.url || payload.url || '';
    if (!url) return null;
    return {
      label: clamp(detail.title || '', 80),
      url,
      site: siteName(url),
      note: clamp(detail.belong || '', 60),
    };
  } catch {
    return null;
  }
}

function describeBlock(block) {
  const inner = block.inner || '';
  const links = [];
  const linkPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(inner)) !== null) {
    const href = attr(match[1], 'href');
    if (!/^https?:\/\//i.test(href)) continue;
    links.push({ url: href, label: plainText(match[2]) });
  }

  const cards = [];
  const cardPattern = /<card\b([^>]*)>/gi;
  while ((match = cardPattern.exec(block.raw || '')) !== null) {
    const name = attr(match[1], 'name');
    if (name !== 'yuque') continue;
    const card = readYuqueCard(match[1]);
    if (card) cards.push(card);
  }

  const headingMatch = /^h([1-6])$/.exec(block.tag || '');
  const text = plainText(inner);

  return {
    tag: block.tag,
    heading: headingMatch ? Number(headingMatch[1]) : null,
    text,
    links,
    cards,
    empty: !text && links.length === 0 && cards.length === 0,
  };
}

function makeCard(link, itemTitle) {
  const label = !looksLikeUrl(link.label) && link.label ? link.label : itemTitle;
  const url = link.url;
  return {
    label: clamp(label || siteName(url) || url, 90),
    url,
    site: siteName(url),
    note: '',
  };
}

// 语雀文档里常见的“1 / 2 / 3”或“1. / （2）”只是分隔事项用的序号，不是事项名。
const INDEX_ONLY = /^\s*(?:[0-9]{1,3}\s*[.、,，)）．·]?|[（(]\s*[0-9]{1,3}\s*[)）]|[①-⑳])\s*$/;
// 只有「1. 」「1、」「（2）」「①」这种明确是序号的才去掉；"2026.11 计划" 这类不会被误伤。
const LEADING_INDEX =
  /^\s*(?:(?:[1-9]|[1-9][0-9])\s*(?:[、)）．·]|\.\s+)\s*|(?:[（(]\s*(?:[1-9]|[1-9][0-9])\s*[)）])\s*|[①-⑳]\s*)/;

function cleanTitle(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripLeadingIndex(text) {
  return cleanTitle(text).replace(LEADING_INDEX, '').trim() || cleanTitle(text);
}

function buildItems(blocks) {
  const items = [];
  let current = null;
  let awaitingTitle = false;
  const hasHeadings = blocks.some((block) => block.heading === 1 && block.text);

  const pushItem = (title) => {
    const item = { title: clamp(title || '未命名待办', 120) || '未命名待办', cards: [] };
    items.push(item);
    current = item;
    return item;
  };

  const addCard = (card) => {
    if (!card || !card.url || !current) return;
    if (current.cards.some((existing) => existing.url === card.url)) return;
    current.cards.push(card);
  };

  const startFrom = (block, title) => {
    pushItem(title);
    for (const link of block.links) addCard(makeCard(link, current.title));
    for (const card of block.cards) addCard({ ...card, label: card.label || current.title });
  };

  for (const block of blocks) {
    if (block.empty) continue;

    if (hasHeadings) {
      if (block.heading === 1) {
        const label = cleanTitle(block.text);
        if (!label || INDEX_ONLY.test(label)) {
          // 纯序号标题：只是分隔符，事项名在它下面的第一段文字里。
          awaitingTitle = true;
          current = null;
          continue;
        }
        awaitingTitle = false;
        startFrom(block, stripLeadingIndex(label));
        continue;
      }

      if (awaitingTitle) {
        const title =
          cleanTitle(block.text) ||
          (block.cards[0] && block.cards[0].label) ||
          (block.links[0] && block.links[0].label);
        if (!title) continue;
        awaitingTitle = false;
        startFrom(block, stripLeadingIndex(title));
        continue;
      }

      if (!current) continue; // 第一个标题之前的内容
      for (const link of block.links) addCard(makeCard(link, current.title));
      for (const card of block.cards) addCard({ ...card, label: card.label || current.title });
      continue;
    }

    // No Heading 1 in this document: every text block starts an item and any
    // link-only block or card block belongs to the item above it.
    if (block.text) {
      if (INDEX_ONLY.test(cleanTitle(block.text))) {
        current = null;
        awaitingTitle = true;
        continue;
      }
      let title = cleanTitle(block.text);
      for (const link of block.links) {
        if (looksLikeUrl(link.label)) title = title.split(link.label).join(' ');
      }
      title = stripLeadingIndex(title.replace(/\s+/g, ' '));
      awaitingTitle = false;
      startFrom(block, title || cleanTitle(block.text));
      continue;
    }

    if (awaitingTitle) {
      const title = (block.cards[0] && block.cards[0].label) || (block.links[0] && block.links[0].label);
      if (title) {
        awaitingTitle = false;
        startFrom(block, stripLeadingIndex(title));
        continue;
      }
    }

    if (!current) continue;
    for (const link of block.links) addCard(makeCard(link, current.title));
    for (const card of block.cards) addCard({ ...card, label: card.label || current.title });
  }

  return items;
}

export function parseDocument(html) {
  const blocks = splitTopLevel(html).map(describeBlock);
  return buildItems(blocks);
}

export async function fetchDocumentContent(pageUrl = DOC_URL) {
  const page = await fetch(pageUrl, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
  });
  if (!page.ok) throw new Error(`语雀页面返回 ${page.status}`);
  const pageHtml = await page.text();

  const payloadMatch = pageHtml.match(/window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\("([^"]+)"\)\)/);
  if (!payloadMatch) throw new Error('未找到语雀 appData（文档可能已取消公开）');
  const appData = JSON.parse(decodeURIComponent(payloadMatch[1]));
  if (!appData.doc) throw new Error('语雀 appData 中没有文档信息（可能需要登录）');

  const doc = appData.doc;
  const bookId = doc.book_id || (appData.book && appData.book.id);
  const origin = new URL(pageUrl).origin;
  const apiUrl = `${origin}/api/docs/${doc.id}?book_id=${bookId}`;
  const response = await fetch(apiUrl, {
    headers: { 'user-agent': UA, accept: 'application/json', referer: pageUrl },
  });
  if (!response.ok) throw new Error(`语雀文档接口返回 ${response.status}`);
  const payload = await response.json();
  const data = payload.data || {};

  return {
    title: data.title || doc.title || '待办',
    html: data.content || '',
    updatedAt: data.content_updated_at || data.updated_at || doc.content_updated_at || null,
  };
}

export async function scrapeTodos(pageUrl = DOC_URL) {
  const doc = await fetchDocumentContent(pageUrl);
  return {
    doc: { title: doc.title, url: pageUrl, updatedAt: doc.updatedAt },
    items: parseDocument(doc.html),
    fetchedAt: new Date().toISOString(),
  };
}
