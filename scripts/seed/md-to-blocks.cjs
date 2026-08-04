// Converts a markdown string into Strapi's "blocks" (rich editor) JSON structure.
//
// Strapi blocks are an array of nodes:
//   { type: 'heading', level, children: [...] }
//   { type: 'paragraph', children: [...] }
//   { type: 'list', format: 'ordered'|'unordered', children: [ {type:'list-item', children:[...]} ] }
//   { type: 'quote', children: [...] }
//   { type: 'code', children: [ {type:'text', text} ] }
//   inline: { type:'text', text, bold?, italic?, underline?, strikethrough?, code? }
//           { type:'link', url, children: [textNodes] }
//
// Notes:
//   - Markdown horizontal rules (`---`) have no equivalent block and are dropped.
//   - Inline/standalone images are reduced to their alt text (media lives in the
//     dedicated `image`/`thumbnail`/`video` fields, not inside content).

const { marked } = require('marked');

marked.use({ gfm: true, breaks: false });

function textNode(text, marks = {}) {
  return { type: 'text', text: text ?? '', ...marks };
}

function ensureChildren(children) {
  return children && children.length ? children : [textNode('')];
}

/** Map an array of marked inline tokens to Strapi inline children, carrying marks. */
function inlineChildren(tokens, marks = {}) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text':
      case 'escape':
        if (t.tokens && t.tokens.length) out.push(...inlineChildren(t.tokens, marks));
        else out.push(textNode(t.text, marks));
        break;
      case 'strong':
        out.push(...inlineChildren(t.tokens, { ...marks, bold: true }));
        break;
      case 'em':
        out.push(...inlineChildren(t.tokens, { ...marks, italic: true }));
        break;
      case 'del':
        out.push(...inlineChildren(t.tokens, { ...marks, strikethrough: true }));
        break;
      case 'codespan':
        out.push(textNode(t.text, { ...marks, code: true }));
        break;
      case 'br':
        out.push(textNode('\n', marks));
        break;
      case 'link':
        out.push({
          type: 'link',
          url: t.href,
          children: ensureChildren(inlineChildren(t.tokens, marks)),
        });
        break;
      case 'image':
        if (t.text) out.push(textNode(t.text, marks));
        break;
      default:
        if (t.tokens && t.tokens.length) out.push(...inlineChildren(t.tokens, marks));
        else if (t.text != null) out.push(textNode(t.text, marks));
    }
  }
  return out;
}

function listToNode(listToken) {
  const format = listToken.ordered ? 'ordered' : 'unordered';
  const children = [];
  for (const item of listToken.items || []) {
    const inline = [];
    const nestedLists = [];
    for (const it of item.tokens || []) {
      if (it.type === 'list') nestedLists.push(it);
      else if (it.type === 'text' || it.type === 'paragraph')
        inline.push(...inlineChildren(it.tokens || [textNode(it.text)]));
      else if (it.tokens) inline.push(...inlineChildren(it.tokens));
    }
    // A list-item may only contain inline nodes (text/link).
    children.push({ type: 'list-item', children: ensureChildren(inline) });
    // Nested lists live as siblings inside the parent list's children.
    for (const nl of nestedLists) children.push(listToNode(nl));
  }
  return { type: 'list', format, children: children.length ? children : [{ type: 'list-item', children: [textNode('')] }] };
}

function blockquoteChildren(tokens) {
  const out = [];
  const paras = (tokens || []).filter((t) => t.type === 'paragraph' || t.type === 'text');
  paras.forEach((p, i) => {
    if (i > 0) out.push(textNode('\n'));
    out.push(...inlineChildren(p.tokens || [textNode(p.text)]));
  });
  return out;
}

function blockNodes(tokens) {
  const nodes = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'heading':
        nodes.push({
          type: 'heading',
          level: Math.min(6, Math.max(1, t.depth || 1)),
          children: ensureChildren(inlineChildren(t.tokens)),
        });
        break;
      case 'paragraph':
        nodes.push({ type: 'paragraph', children: ensureChildren(inlineChildren(t.tokens)) });
        break;
      case 'text':
        nodes.push({
          type: 'paragraph',
          children: ensureChildren(inlineChildren(t.tokens || [textNode(t.text)])),
        });
        break;
      case 'list':
        nodes.push(listToNode(t));
        break;
      case 'blockquote':
        nodes.push({ type: 'quote', children: ensureChildren(blockquoteChildren(t.tokens)) });
        break;
      case 'code':
        nodes.push({ type: 'code', children: [textNode(t.text || '')] });
        break;
      case 'hr':
      case 'space':
        break; // no divider block in Strapi blocks — drop
      case 'html': {
        const stripped = String(t.text || '').replace(/<[^>]*>/g, '').trim();
        if (stripped) nodes.push({ type: 'paragraph', children: [textNode(stripped)] });
        break;
      }
      default:
        if (t.tokens && t.tokens.length) nodes.push(...blockNodes(t.tokens));
    }
  }
  return nodes;
}

/** Convert a markdown string to a Strapi blocks array. Always returns ≥1 block. */
function mdToBlocks(md) {
  const text = String(md ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [{ type: 'paragraph', children: [textNode('')] }];
  const tokens = marked.lexer(text);
  const nodes = blockNodes(tokens);
  return nodes.length ? nodes : [{ type: 'paragraph', children: [textNode('')] }];
}

module.exports = { mdToBlocks };
