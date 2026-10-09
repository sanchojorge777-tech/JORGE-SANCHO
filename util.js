export const $ = (sel, root = document) => root.querySelector(sel);

/** Tiny DOM builder. Text is always inserted as text, never as HTML. */
export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
  del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid() {
  const a = new Uint8Array(9);
  (self.crypto || window.crypto).getRandomValues(a);
  return 'p' + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export function randomPin() {
  const a = new Uint32Array(1);
  (self.crypto || window.crypto).getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

export const fmtPin = (pin) => String(pin).replace(/(\d{3})(\d{3})/, '$1 $2');

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
