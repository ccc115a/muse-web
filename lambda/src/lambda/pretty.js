// Pretty printer：最少括號 + redex 高亮 HTML
import { escapeHtml } from '../ui_escape.js';

export function pretty(node) {
  return pp(node, 0);
}

// precedence：Abs=1, App=2, Atom=3
function pp(node, ctx) {
  if (node.type === 'Var') return node.name;
  if (node.type === 'Abs') {
    // 合併連續 λ：λx.λy.M 印成 λx y. M
    const params = [node.param];
    let body = node.body;
    while (body.type === 'Abs') { params.push(body.param); body = body.body; }
    const s = `λ${params.join(' ')}. ${pp(body, 1)}`;
    return ctx > 1 ? `(${s})` : s;
  }
  // App：左結合 f a b
  const parts = [];
  let cur = node;
  while (cur.type === 'App') { parts.unshift(cur.arg); cur = cur.fn; }
  parts.unshift(cur);
  const s = parts.map((p, i) => {
    if (i === 0) return pp(p, 2);
    return pp(p, 3);
  }).join(' ');
  return ctx >= 3 ? `(${s})` : s;
}

/**
 * 轉 HTML，highlightPath 指向 redex 在原 AST 的路徑。
 * path 元素：'fn' | 'arg' | 'body'。空陣列 = 整顆高亮。
 */
export function toHtml(node, highlightPath = null) {
  return html(node, 0, highlightPath, []);
}

function wrap(s, hot) {
  if (!hot) return escapeHtml(s);
  return `<span class="redex">${escapeHtml(s)}</span>`;
}

function html(node, ctx, hl, cur) {
  const hot = hl !== null && pathsEqual(hl, cur);
  if (node.type === 'Var') return hot ? `<span class="redex">${escapeHtml(node.name)}</span>` : escapeHtml(node.name);
  if (node.type === 'Abs') {
    const params = [node.param];
    let body = node.body;
    let bodyPath = [...cur, 'body'];
    // 注意合併列印時 path 會失準：只在單層時精確高亮，多層退回整顆
    const merged = body.type === 'Abs';
    if (hot) {
      return `<span class="redex">${escapeHtml(pretty(node))}</span>`;
    }
    if (merged) {
      // 逐層遞迴但共用同一個 bodyPath 前綴會有偏差；簡單起見：若 hl 在子樹內則整顆 lambda 不拆
      if (hl !== null && isPrefix(cur, hl)) {
        // hl 深入子樹：遞迴展開第一層，highlight 往下傳
        const inner = html(body, 1, hl, bodyPath);
        const head = `λ${node.param}. `;
        const s = ctx > 1 ? `(${head}${stripTags(inner)})` : `${head}${stripTags(inner)}`;
        // 為了正確高亮子 redex，改用完整遞迴渲染
        return renderAbsChain(node, ctx, hl, cur);
      }
      return escapeHtml(pretty(node));
    }
    const inner = html(body, 1, hl, bodyPath);
    const s = `λ${escapeHtml(node.param)}. ${inner}`;
    return ctx > 1 ? `(${s})` : s;
  }
  // App
  if (hot) return `<span class="redex">${escapeHtml(pretty(node))}</span>`;
  const parts = [];
  let cur2 = node;
  const args = [];
  while (cur2.type === 'App') { args.unshift({ node: cur2.arg, path: null }); cur2 = cur2.fn; }
  // 重建 path：fn 路徑是 cur+['fn']*k，arg 是對應層
  // 用遞迴方式渲染以保持 path 精確
  return renderApp(node, ctx, hl, cur);
}

function renderAbsChain(node, ctx, hl, cur) {
  const params = [];
  let body = node;
  const chain = [];
  while (body.type === 'Abs') { chain.push(body); body = body.body; }
  // bodyPath 逐層
  let innerHtml;
  {
    let path = [...cur];
    for (const _ of chain) path = [...path, 'body'];
    // 注意 Abs 結構是巢狀：body 的 path 需要逐層累加，這裡簡化：直接遞迴
    innerHtml = htmlNestedAbs(node, hl, cur);
  }
  void params; void body;
  return ctx > 1 ? `(${innerHtml})` : innerHtml;
}

function htmlNestedAbs(node, hl, cur) {
  if (node.type !== 'Abs') return html(node, 1, hl, cur);
  const hot = hl !== null && pathsEqual(hl, cur);
  if (hot) return `<span class="redex">${escapeHtml(pretty(node))}</span>`;
  const inner = htmlNestedAbs(node.body, hl, [...cur, 'body']);
  return `λ${escapeHtml(node.param)}. ${inner}`;
}

function renderApp(node, ctx, hl, cur) {
  // 拆成 fn 鏈
  const spine = [];
  let c = node;
  while (c.type === 'App') { spine.unshift(c.arg); c = c.fn; }
  const head = c;
  // 計算每段 path：從頂層 node 往下：node.fn.fn...fn=head
  const depth = spine.length;
  let headPath = [...cur];
  for (let i = 0; i < depth; i++) headPath = [...headPath, 'fn'];
  const headHtml = html(head, 2, hl, headPath);
  // args 的 path：第 i 個 arg 的路徑 = cur + fn*(depth-1-i) + arg
  const argHtmls = spine.map((a, i) => {
    let p = [...cur];
    for (let k = 0; k < depth - 1 - i; k++) p = [...p, 'fn'];
    p = [...p, 'arg'];
    return html(a, 3, hl, p);
  });
  const s = [headHtml, ...argHtmls].join(' ');
  return ctx >= 3 ? `(${s})` : s;
}

function pathsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}
function isPrefix(pre, full) {
  if (pre.length > full.length) return false;
  return pre.every((x, i) => x === full[i]);
}
function stripTags(s) { return s.replace(/<[^>]*>/g, ''); }
