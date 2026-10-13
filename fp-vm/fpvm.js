#!/usr/bin/env node
'use strict';
/*
 * fpvm.js  —  執行 LBC 中間碼 (.fbc) 的 JS 虛擬機 (FP VM)
 * （由 lispvm.js 分支出來；之後的 VM 工作都在此檔，lispvm.js 凍結保留）
 * 用法:  node fpvm.js program.fbc
 * 指令集與格式請見 lispc.js 檔頭註解。
 */
const fs = require('fs');

/* ───────────── 執行期資料型別 ───────────── */
class Sym { constructor(n) { this.name = n; } }
const symtab = new Map();
const intern = n => { let s = symtab.get(n); if (!s) symtab.set(n, s = new Sym(n)); return s; };
class Pair { constructor(car, cdr) { this.car = car; this.cdr = cdr; } }   // 空串列 = null
class Arr { constructor(items) { this.items = items; } }          // persistent array (全拷貝)
const VOID = { void: true };
class Closure { constructor(fn, env) { this.fn = fn; this.env = env; } }
class Thrown { constructor(value) { this.value = value; } }   // (error ...) 與 THROW 的例外負載
class Env {
  constructor(parent) { this.vars = new Map(); this.parent = parent; }
  lookup(name) { for (let e = this; e; e = e.parent) if (e.vars.has(name)) return e; return null; }
}

const fromDatum = d => {
  if (d === null || typeof d !== 'object') return d;
  if ('big' in d) return BigInt(d.big);
  if ('sym' in d) return intern(d.sym);
  if ('list' in d) { let r = null; for (let i = d.list.length - 1; i >= 0; i--) r = new Pair(fromDatum(d.list[i]), r); return r; }
  throw new Error('錯誤的常數: ' + JSON.stringify(d));
};
const arrayToList = a => { let r = null; for (let i = a.length - 1; i >= 0; i--) r = new Pair(a[i], r); return r; };
const listToArray = l => { const a = []; for (; l instanceof Pair; l = l.cdr) a.push(l.car); return a; };

function toStr(v, write) {
  if (v === null) return '()';
  if (v === true) return '#t';
  if (v === false) return '#f';
  if (v === VOID) return '';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return write ? JSON.stringify(v) : v;
  if (v instanceof Sym) return v.name;
  if (v instanceof Closure) return `#<procedure ${v.fn.name}>`;
  if (typeof v === 'function') return '#<primitive>';
  if (v instanceof Pair) {
    const parts = []; let p = v;
    for (; p instanceof Pair; p = p.cdr) parts.push(toStr(p.car, write));
    return '(' + parts.join(' ') + (p === null ? '' : ' . ' + toStr(p, write)) + ')';
  }
  if (v instanceof Arr) return '#[' + v.items.map(x => toStr(x, write)).join(', ') + ']';
  return String(v);
}
const numEq = (a, b) => {                // 跨 number/bigint 的數值相等
  if (typeof a === typeof b) return a === b;
  if (typeof a === 'bigint' && typeof b === 'number') return Number.isInteger(b) && a === BigInt(b);
  if (typeof a === 'number' && typeof b === 'bigint') return Number.isInteger(a) && BigInt(a) === b;
  return false;
};
const equal = (a, b) =>
  a instanceof Pair && b instanceof Pair ? equal(a.car, b.car) && equal(a.cdr, b.cdr)
  : a instanceof Arr && b instanceof Arr ? a.items.length === b.items.length && a.items.every((x, i) => equal(x, b.items[i]))
  : (typeof a === 'number' || typeof a === 'bigint') && (typeof b === 'number' || typeof b === 'bigint') ? numEq(a, b)
  : a === b;

/* ───────────── 內建函式 ───────────── */
const isBig = x => typeof x === 'bigint';
const num = (x, who) => { if (typeof x !== 'number' && !isBig(x)) throw new Error(`${who}: 需要數字，得到 ${toStr(x, true)}`); return x; };
const toBig = (x, who) => isBig(x) ? x : (Number.isInteger(x) ? BigInt(x) : (() => { throw new Error(`${who}: 需要整數，得到 ${toStr(x, true)}`); })());
const cmp = (name, f) => (...a) => {
  if (a.every(x => typeof x === 'string')) { for (let i = 0; i < a.length - 1; i++) if (!f(a[i], a[i + 1])) return false; return true; }
  const big = a.some(isBig), v = big ? a.map(x => toBig(x, name)) : a.map(x => num(x, name));
  for (let i = 0; i < v.length - 1; i++) if (!f(v[i], v[i + 1])) return false; return true;
};
const out = s => process.stdout.write(s);
class ExitSignal { constructor(code) { this.code = code; } }   // exit prim 用；CLI 轉 exitCode
let stdinLines = null;                                         // read-line 用（首調讀光，TTY 直接空）
const readStdinLines = () => {
  if (stdinLines) return stdinLines;
  if (process.stdin.isTTY) return (stdinLines = []);
  let data = '';
  try { data = fs.readFileSync(0, 'utf8'); } catch { data = ''; }
  const ls = data.split(/\r?\n/);
  if (ls.length && ls[ls.length - 1] === '') ls.pop();
  return (stdinLines = ls);
};
const toIdx = (x, who) => {                                 // Nat 索引 -> JS 整數 (負數/超大回 -1 判越界)
  if (typeof x === 'bigint') return (x >= 0n && x <= 9007199254740991n) ? Number(x) : -1;
  if (typeof x === 'number' && Number.isInteger(x)) return x;
  throw new Error(`${who}: 需要 Nat 索引，得到 ` + toStr(x, true));
};

const primitives = {
  '+': (...a) => a.some(isBig) ? a.map(x => toBig(x, '+')).reduce((x, y) => x + y, 0n)
                               : a.reduce((x, y) => x + num(y, '+'), 0),
  '*': (...a) => a.some(isBig) ? a.map(x => toBig(x, '*')).reduce((x, y) => x * y, 1n)
                               : a.reduce((x, y) => x * num(y, '*'), 1),
  '-': (...a) => {
    if (a.some(isBig)) { const b = a.map(x => toBig(x, '-')); return b.length === 1 ? -b[0] : b.slice(1).reduce((x, y) => x - y, b[0]); }
    return a.length === 1 ? -num(a[0], '-') : a.slice(1).reduce((x, y) => x - num(y, '-'), num(a[0], '-'));
  },
  '/': (...a) => {
    if (!a.some(isBig)) return a.length === 1 ? 1 / a[0] : a.slice(1).reduce((x, y) => { if (y === 0) throw new Error('/: 除以零'); return x / y; }, a[0]);
    const b = a.map(x => toBig(x, '/'));
    if (b.length === 1) return b[0] === 1n ? 1n : b[0] === -1n ? -1n : 1 / Number(b[0]);
    let acc = b[0], exact = true;                       // 整除鏈保持 bigint，否則回落 Number
    for (const y of b.slice(1)) {
      if (y === 0n) throw new Error('/: 除以零');
      if (exact && acc % y === 0n) acc = acc / y; else exact = false;
    }
    return exact ? acc : b.slice(1).reduce((x, y) => Number(x) / Number(y), Number(b[0]));
  },
  'quotient': (a, b) => isBig(a) || isBig(b) ? toBig(a, 'quotient') / toBig(b, 'quotient') : Math.trunc(a / b),
  'remainder': (a, b) => isBig(a) || isBig(b) ? toBig(a, 'remainder') % toBig(b, 'remainder') : a % b,
  'modulo': (a, b) => {
    if (isBig(a) || isBig(b)) { const x = toBig(a, 'modulo'), y = toBig(b, 'modulo'); return ((x % y) + y) % y; }
    return ((a % b) + b) % b;
  },
  '=': cmp('=', (a, b) => a === b), '<': cmp('<', (a, b) => a < b), '>': cmp('>', (a, b) => a > b),
  '<=': cmp('<=', (a, b) => a <= b), '>=': cmp('>=', (a, b) => a >= b),
  'abs': a => isBig(a) ? (a < 0n ? -a : a) : Math.abs(a),
  'min': (...a) => a.some(isBig) ? a.map(x => toBig(x, 'min')).reduce((x, y) => x < y ? x : y) : Math.min(...a.map(x => num(x, 'min'))),
  'max': (...a) => a.some(isBig) ? a.map(x => toBig(x, 'max')).reduce((x, y) => x > y ? x : y) : Math.max(...a.map(x => num(x, 'max'))),
  'zero?': a => isBig(a) ? a === 0n : a === 0,
  'even?': a => isBig(a) ? a % 2n === 0n : a % 2 === 0,
  'odd?': a => isBig(a) ? (a < 0n ? -a : a) % 2n === 1n : Math.abs(a % 2) === 1,
  'not': a => a === false,
  'eq?': (a, b) => a === b, 'eqv?': (a, b) => a === b, 'equal?': equal,
  'cons': (a, b) => new Pair(a, b),
  'car': p => { if (!(p instanceof Pair)) throw new Error('car: 不是 pair: ' + toStr(p, true)); return p.car; },
  'cdr': p => { if (!(p instanceof Pair)) throw new Error('cdr: 不是 pair: ' + toStr(p, true)); return p.cdr; },
  'cadr': p => p.cdr.car, 'cddr': p => p.cdr.cdr, 'caddr': p => p.cdr.cdr.car,
  'list': (...a) => arrayToList(a),
  'array': (...a) => new Arr(a),
  'array-empty': (...a) => {
    if (a.length !== 0) throw new Error(`array-empty: 參數個數錯誤 (需要 0，得到 ${a.length})`);
    return new Arr([]);
  },
  'array-push': (...a) => {
    if (a.length !== 2) throw new Error(`array-push: 參數個數錯誤 (需要 2，得到 ${a.length})`);
    if (!(a[0] instanceof Arr)) throw new Error('array-push: 需要 array，得到 ' + toStr(a[0], true));
    return new Arr([...a[0].items, a[1]]);
  },
  'array-get': (...a) => {
    if (a.length !== 2) throw new Error(`array-get: 參數個數錯誤 (需要 2，得到 ${a.length})`);
    if (!(a[0] instanceof Arr)) throw new Error('array-get: 需要 array，得到 ' + toStr(a[0], true));
    const k = toIdx(a[1], 'array-get');
    if (k < 0 || k >= a[0].items.length) throw new Error(`array-get: 索引超出範圍 (長度 ${a[0].items.length}，得到 ${toStr(a[1], true)})`);
    return a[0].items[k];
  },
  'array-set': (...a) => {
    if (a.length !== 3) throw new Error(`array-set: 參數個數錯誤 (需要 3，得到 ${a.length})`);
    if (!(a[0] instanceof Arr)) throw new Error('array-set: 需要 array，得到 ' + toStr(a[0], true));
    const k = toIdx(a[1], 'array-set');
    if (k < 0 || k >= a[0].items.length) throw new Error(`array-set: 索引超出範圍 (長度 ${a[0].items.length}，得到 ${toStr(a[1], true)})`);
    const items = a[0].items.slice(); items[k] = a[2]; return new Arr(items);
  },
  'array-size': (...a) => {
    if (a.length !== 1) throw new Error(`array-size: 參數個數錯誤 (需要 1，得到 ${a.length})`);
    if (!(a[0] instanceof Arr)) throw new Error('array-size: 需要 array，得到 ' + toStr(a[0], true));
    return a[0].items.length;
  },
  'array?': (...a) => {
    if (a.length !== 1) throw new Error(`array?: 參數個數錯誤 (需要 1，得到 ${a.length})`);
    return a[0] instanceof Arr;
  },
  'vector': (...a) => new Pair(intern('%vec'), arrayToList(a)),
  'hash-map': (...a) => {
    if (a.length % 2) throw new Error('hash-map: 需要偶數個參數');
    const ks = [], vs = [];                             // 去重 (後贏)，保持首次出現順序 (同 _assoc1)
    for (let i = 0; i < a.length; i += 2) {
      const j = ks.findIndex(k => equal(k, a[i]));
      if (j < 0) { ks.push(a[i]); vs.push(a[i + 1]); } else vs[j] = a[i + 1];
    }
    let es = null;
    for (let i = ks.length - 1; i >= 0; i--) es = new Pair(new Pair(ks[i], new Pair(vs[i], null)), es);
    return new Pair(intern('%map'), es);
  },
  'length': l => listToArray(l).length,
  'append': (...ls) => arrayToList(ls.flatMap(listToArray)),
  'reverse': l => arrayToList(listToArray(l).reverse()),
  'null?': a => a === null,
  'pair?': a => a instanceof Pair,
  'number?': a => typeof a === 'number' || isBig(a),
  'string?': a => typeof a === 'string',
  'symbol?': a => a instanceof Sym,
  'procedure?': a => a instanceof Closure || typeof a === 'function',
  'string-append': (...a) => a.map(x => toStr(x, false)).join(''),
  'string-length': s => {
    if (typeof s !== 'string') throw new Error('string-length: 需要字串，得到 ' + toStr(s, true));
    return [...s].length;
  },
  'string-ref': (s, i) => {
    if (typeof s !== 'string') throw new Error('string-ref: 需要字串，得到 ' + toStr(s, true));
    const cs = [...s], k = toIdx(i, 'string-ref');
    if (k < 0 || k >= cs.length) throw new Error(`string-ref: 索引超出範圍 (長度 ${cs.length}，得到 ${toStr(i, true)})`);
    return BigInt(cs[k].codePointAt(0));
  },
  'substring': (s, b, e) => {
    if (typeof s !== 'string') throw new Error('substring: 需要字串，得到 ' + toStr(s, true));
    const cs = [...s], x = toIdx(b, 'substring'), y = toIdx(e, 'substring');
    if (x < 0 || y < 0 || x > y || y > cs.length) throw new Error(`substring: 範圍錯誤 (長度 ${cs.length}，得到 ${toStr(b, true)} ${toStr(e, true)})`);
    return cs.slice(x, y).join('');
  },
  'char->nat': c => {
    if (typeof c !== 'bigint' && !(typeof c === 'number' && Number.isInteger(c))) throw new Error('char->nat: 需要 Char，得到 ' + toStr(c, true));
    return c;
  },
  'nat->char': c => {
    const v = toBig(c, 'nat->char');
    if (v < 0n || v > 0x10FFFFn || (v >= 0xD800n && v <= 0xDFFFn)) throw new Error('nat->char: 不是有效碼位，得到 ' + toStr(c, true));
    return v;
  },
  'bit-and': (a, b) => toBig(a, 'bit-and') & toBig(b, 'bit-and'),
  'bit-or': (a, b) => toBig(a, 'bit-or') | toBig(b, 'bit-or'),
  'bit-xor': (a, b) => toBig(a, 'bit-xor') ^ toBig(b, 'bit-xor'),
  'read-line': () => { const ls = readStdinLines(); return ls.length ? ls.shift() : null; },
  'get-args': () => arrayToList(process.argv.slice(3)),
  'exit': c => {
    const code = c === undefined ? 0 : toBig(c, 'exit');
    throw new ExitSignal(Number(code));
  },
  'symbol->string': s => { if (!(s instanceof Sym)) throw new Error('symbol->string: 需要 symbol，得到 ' + toStr(s, true)); return s.name; },
  'number->string': n => String(n),
  'display': a => { out(toStr(a, false)); return VOID; },
  'write': a => { out(toStr(a, true)); return VOID; },
  'newline': () => { out('\n'); return VOID; },
  'error': (...a) => { throw new Thrown(a.map(x => toStr(x, false)).join(' ')); },
};

/* ───────────── 載入中間碼 ───────────── */
function load(text) {
  const funcs = new Map(); let cur = null;
  text.split('\n').forEach((raw, ln) => {
    const line = raw.trim();
    if (!line || line[0] === ';') return;
    if (line.startsWith('.func')) {
      const parts = line.split(/\s+/);
      let params = parts.slice(2), rest = null;
      const di = params.indexOf('.');
      if (di >= 0) { rest = params[di + 1]; params = params.slice(0, di); }
      cur = { name: parts[1], params, rest, code: [], labels: new Map() };
      funcs.set(cur.name, cur); return;
    }
    if (!cur) throw new Error(`第 ${ln + 1} 行: 指令不在 .func 內`);
    if (/^[A-Za-z0-9_]+:$/.test(line)) { cur.labels.set(line.slice(0, -1), cur.code.length); return; }
    const sp = line.indexOf(' ');
    const op = sp < 0 ? line : line.slice(0, sp);
    let arg = sp < 0 ? null : line.slice(sp + 1).trim();
    if (op === 'CONST') arg = fromDatum(JSON.parse(arg));
    else if (op === 'CALL' || op === 'TAILCALL') arg = Number(arg);
    cur.code.push([op, arg]);
  });
  for (const f of funcs.values()) {              // 解析標籤與函式參照
    for (const ins of f.code) {
      if (ins[0] === 'JMP' || ins[0] === 'JF' || ins[0] === 'TRY') {
        const t = f.labels.get(ins[1]);
        if (t === undefined) throw new Error(`函式 ${f.name}: 找不到標籤 ${ins[1]}`);
        ins[1] = t;
      } else if (ins[0] === 'CLOSURE') {
        const t = funcs.get(ins[1]);
        if (!t) throw new Error(`找不到函式 ${ins[1]}`);
        ins[1] = t;
      }
    }
  }
  if (!funcs.has('main')) throw new Error('缺少 main 函式');
  return funcs;
}

/* ───────────── 虛擬機 ───────────── */
function run(funcs) {
  const global = new Env(null);
  for (const [k, v] of Object.entries(primitives)) global.vars.set(k, v);

  const stack = [];
  const frames = [];                              // 呼叫堆疊 (放在 heap，不吃 JS 堆疊)
  const handlers = [];                            // 例外處理器堆疊 {code,pc,stackLen,framesLen,env}
  let code = funcs.get('main').code, pc = 0, env = global;

  const uncaughtMsg = v => typeof v === 'string' ? v : '未攔截的例外: ' + toStr(v, true);
  const doThrow = payload => {                    // unwind 到最近處理器；無則丟出 JS Error
    const h = handlers.pop();
    if (!h) throw new Error(uncaughtMsg(payload));
    stack.length = h.stackLen; frames.length = h.framesLen;
    code = h.code; pc = h.pc; env = h.env;
    stack.push(payload);
  };
  const doCall = (f, args, tail) => {             // 共用呼叫邏輯 (CALL / APPLY 家族)
    if (f instanceof Closure) {
      const fn = f.fn, ne = new Env(f.env);
      const np = fn.params.length;
      if (fn.rest === null ? args.length !== np : args.length < np) {
        doThrow(`${fn.name}: 參數個數錯誤 (需要 ${np}${fn.rest ? '+' : ''}，得到 ${args.length})`);
        return;
      }
      for (let i = 0; i < np; i++) ne.vars.set(fn.params[i], args[i]);
      if (fn.rest !== null) ne.vars.set(fn.rest, arrayToList(args.slice(np)));
      if (!tail) frames.push({ code, pc, env });  // 尾呼叫: 直接取代目前框架
      code = fn.code; pc = 0; env = ne;
    } else if (typeof f === 'function') {
      let r;
      try { r = f(...args); }
      catch (e) { if (e instanceof ExitSignal) throw e; doThrow(e instanceof Thrown ? e.value : String((e && e.message) || e)); return; }
      stack.push(r);
      if (tail) {                                 // 等同 RET
        if (frames.length === 0) { code = null; return; }
        ({ code, pc, env } = frames.pop());
      }
    } else doThrow(f === VOID ? '不是可呼叫的物件 (前一個呼叫回傳了空值？)' : '不是可呼叫的物件: ' + toStr(f, true));
  };

  for (;;) {
    const [op, arg] = code[pc++];
    switch (op) {
      case 'CONST': stack.push(arg); break;
      case 'VOID': stack.push(VOID); break;
      case 'LOAD': {
        const e = env.lookup(arg);
        if (!e) { doThrow('未定義的變數: ' + arg); break; }
        stack.push(e.vars.get(arg)); break;
      }
      case 'DEF': env.vars.set(arg, stack.pop()); stack.push(VOID); break;
      case 'SET': {
        const e = env.lookup(arg);
        if (!e) { doThrow('set!: 未定義的變數: ' + arg); break; }
        e.vars.set(arg, stack.pop()); stack.push(VOID); break;
      }
      case 'POP': stack.pop(); break;
      case 'JMP': pc = arg; break;
      case 'JF': if (stack.pop() === false) pc = arg; break;
      case 'CLOSURE': stack.push(new Closure(arg, env)); break;

      case 'CALL':
      case 'TAILCALL': {
        const args = stack.splice(stack.length - arg, arg);
        const f = stack.pop();
        doCall(f, args, op === 'TAILCALL');
        if (code === null) return stack.pop();    // 頂層尾呼叫 primitive
        break;
      }
      case 'APPLY':
      case 'TAILAPPLY': {
        const lst = stack.pop(), f = stack.pop();
        let p = lst;
        for (; p instanceof Pair; p = p.cdr);
        if (p !== null) { doThrow('apply: 第二個參數必須是 proper list'); break; }
        doCall(f, listToArray(lst), op === 'TAILAPPLY');
        if (code === null) return stack.pop();
        break;
      }
      case 'TRY': handlers.push({ code, pc: arg, stackLen: stack.length, framesLen: frames.length, env }); break;
      case 'UNTRY':
        if (!handlers.length) { doThrow('例外處理器堆疊錯誤 (UNTRY 不平衡)'); break; }
        handlers.pop(); break;
      case 'THROW': doThrow(stack.pop()); break;
      case 'RET':
        if (frames.length === 0) return stack.pop();
        ({ code, pc, env } = frames.pop());
        break;
      case 'HALT': return stack.length ? stack.pop() : VOID;
      default: throw new Error('未知的指令: ' + op);
    }
  }
}

function execute(text) { return run(load(text)); }
module.exports = { load, run, execute, toStr };

/* ───────────── CLI ───────────── */
if (require.main === module) {
  if (process.argv.length < 3) { console.error('用法: node fpvm.js program.fbc'); process.exit(1); }
  try { execute(fs.readFileSync(process.argv[2], 'utf8')); }
  catch (e) {
    if (e instanceof ExitSignal) { process.exitCode = e.code; return; }
    console.error('執行錯誤: ' + e.message); process.exit(1);
  }
}
