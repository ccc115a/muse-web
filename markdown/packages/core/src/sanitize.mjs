// 同構消毒：瀏覽器用 window，Node 用 jsdom
import createDOMPurify from 'dompurify';

let _purify = null;
let _jsdomWindow = null;

async function getPurify() {
  if (_purify) return _purify;
  if (typeof window !== 'undefined' && window.document) {
    _purify = createDOMPurify(window);
    return _purify;
  }
  const { JSDOM } = await import('jsdom');
  if (!_jsdomWindow) _jsdomWindow = new JSDOM('').window;
  _purify = createDOMPurify(_jsdomWindow);
  return _purify;
}

export async function sanitizeHtml(dirty) {
  const DOMPurify = await getPurify();
  return DOMPurify.sanitize(dirty ?? '', {
    ADD_ATTR: ['class', 'id', 'checked', 'disabled', 'target', 'rel', 'aria-hidden'],
    ADD_TAGS: ['input'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
  });
}

/** 同步版（僅瀏覽器已有 window 時；Node 請用 sanitizeHtml async） */
export function sanitizeHtmlSync(dirty, windowRef) {
  const w = windowRef ?? (typeof window !== 'undefined' ? window : null);
  if (!w) throw new Error('sanitizeHtmlSync 需要 window，Node 請用 await sanitizeHtml()');
  return createDOMPurify(w).sanitize(dirty ?? '', {
    ADD_ATTR: ['class', 'id', 'checked', 'disabled', 'target', 'rel'],
    ADD_TAGS: ['input'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  });
}
