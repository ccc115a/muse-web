#!/usr/bin/env node
'use strict';
/*
 * vm2wasm.js  —  LBC v1 中間碼 (.fbc)  ->  WebAssembly (.wasm)
 *
 * 用法:
  *   node vm2wasm.js prog.fbc [-o prog.wasm] [--run] [-- 程式參數...]
  *   node vm2wasm.js prog.wasm [-- 程式參數...]    直接執行 wasm
 *   node vm2wasm.js prog.wasm                   直接執行 wasm
 *
 * 需要支援 WebAssembly tail-call 的 Node.js (v20+)。不依賴任何 npm 套件，
 * .wasm 二進位檔是由本檔內建的小型組譯器直接產生的。
 *
 * ═════════════════════════════ 設計 ═════════════════════════════
 * 【值的表示】 所有 Lisp 值都是一個 i32:
 *    - 最低位 = 1 : 小整數 (31-bit)，值 = v >> 1
 *    - 最低位 = 0 : 指向線性記憶體物件的指標 (4 byte 對齊)，物件第一個 word 是 tag
 *        FLOAT   [1][pad][f64]            (非小整數的數字)
 *        STRING  [2][len][utf8 bytes...]
 *        SYMBOL  [3][字串物件指標]           (編譯期 intern，eq? 可用指標比較)
 *        PAIR    [4][car][cdr]
 *        CLOSURE [5][函式表索引][env]
 *        PRIM    [6][內建函式編號]
 *      固定位址的單例: NIL=8  VOID=16  TRUE=24  FALSE=32
 *
 * 【記憶體配置】
 *    0..63        保留 (NIL/VOID/TRUE/FALSE 在 8,16,24,32)
 *    64..1087     ARGBUF  呼叫引數緩衝區 (最多 256 個引數)
 *    1088..       GLOBALS 全域變數表: 每個變數名稱一個 slot (0 = 未定義)
 *    之後         靜態資料 (字串/符號/常數/內建函式物件) -> 再來是 heap (bump allocator，無 GC)
 *
 * 【環境】 區域環境 = [parent][bindings]，binding = [name_id][value][next]；
 *    env = 0 代表全域環境 (直接用 GLOBALS 表)。變數名稱在編譯期轉為 name_id，
  *    LOAD/DEF/SET 在執行期沿著環境鏈查找，語意與 fpvm.js 完全相同。
 *
 * 【函式】 每個 .func 編譯成一個 wasm 函式 (env:i32, argc:i32) -> i32，放在 funcref table。
 *    - 堆疊機的運算元堆疊在編譯期靜態對應到 wasm local (s0, s1, ...)；
 *    - 跳躍用「loop + br_table」的基本區塊分派；
 *    - CALL 以 call_indirect 實作，TAILCALL 以 return_call(_indirect) 實作 -> 真正的尾呼叫最佳化；
 *    - 引數經由 ARGBUF 傳遞，被呼叫者進入時立即綁定到新環境。
 *
 * 【Runtime】 alloc / 環境操作 / closure / call 分派 全部是 wasm 函式 (本檔產生)；
 *    只有內建函式 (+ car display ...) 與錯誤回報由宿主 JS 提供 (import "env")。
 */
const fs = require('fs');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

class ExitSignal { constructor(code) { this.code = code; } }   // exit prim 用 (直通 primWrap)
let stdinLinesWasm = null;
const readStdinLines = () => {
  if (stdinLinesWasm) return stdinLinesWasm;
  if (process.stdin.isTTY) return (stdinLinesWasm = []);
  let data = '';
  try { data = fs.readFileSync(0, 'utf8'); } catch { data = ''; }
  const ls = data.split(/\r?\n/);
  if (ls.length && ls[ls.length - 1] === '') ls.pop();
  return (stdinLinesWasm = ls);
};

/* ───────────── 常數 ───────────── */
const TAG = { FLOAT: 1, STR: 2, SYM: 3, PAIR: 4, CLOSURE: 5, PRIM: 6, NIL: 7, VOID: 8, TRUE: 9, FALSE: 10, BIG: 11, ARR: 12 };
const NIL = 8, VOID = 16, TRUE = 24, FALSE = 32;
const ARGBUF = 64, ARGMAX = 256, GBASE = ARGBUF + 4 * ARGMAX;
const HS_N = 64;                             // 例外處理器堆疊深度 (每項 {env, pc} 8 bytes)
const HS_BYTES = HS_N * 8;
const MAX_PAGES = 30000;                       // ~1.9GB，避免位址超過 2^31

const PRIM_NAMES = ['+', '*', '-', '/', 'quotient', 'remainder', 'modulo', '=', '<', '>', '<=', '>=',
  'abs', 'min', 'max', 'zero?', 'even?', 'odd?', 'not', 'eq?', 'eqv?', 'equal?',
  'cons', 'car', 'cdr', 'cadr', 'cddr', 'caddr', 'list', 'length', 'append', 'reverse',
  'null?', 'pair?', 'number?', 'string?', 'symbol?', 'procedure?',
  'string-append', 'string-length', 'number->string', 'display', 'write', 'newline', 'error',
  'vector', 'hash-map',
  'array', 'array-push', 'array-get', 'array-set', 'array-size', 'array?', 'array-empty',
  'symbol->string',
  'string-ref', 'substring', 'char->nat', 'nat->char',
  'bit-and', 'bit-or', 'bit-xor',
  'read-line', 'get-args', 'exit'];

/* ───────────── wasm 二進位組譯小工具 ───────────── */
const uleb = n => { n = BigInt(n); const o = []; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const sleb = n => {
  n = BigInt(n); const o = [];
  for (;;) {
    const b = Number(n & 0x7fn); n >>= 7n;
    if ((n === 0n && !(b & 0x40)) || (n === -1n && (b & 0x40))) { o.push(b); return o; }
    o.push(b | 0x80);
  }
};
const fl = a => a.flat(Infinity);
const vec = items => [...uleb(items.length), ...fl(items)];
const bytesOfStr = s => [...Buffer.from(s, 'utf8')];
const name = s => { const b = bytesOfStr(s); return [...uleb(b.length), ...b]; };
const section = (id, body) => [id, ...uleb(body.length), ...body];

// 以「折疊式」寫法產生指令 (運算元在前，操作碼在後)
const c = n => [0x41, ...sleb(n)];                        // i32.const
const lg = i => [0x20, ...uleb(i)];                       // local.get
const ls = (i, v) => [...fl(v), 0x21, ...uleb(i)];        // local.set
const gg = i => [0x23, ...uleb(i)];                       // global.get
const gs = (i, v) => [...fl(v), 0x24, ...uleb(i)];        // global.set
const ld = (a, off = 0) => [...fl(a), 0x28, 2, ...uleb(off)];            // i32.load
const st = (a, v, off = 0) => [...fl(a), ...fl(v), 0x36, 2, ...uleb(off)]; // i32.store
const bin = op => (a, b) => [...fl(a), ...fl(b), op];
const eq = bin(0x46), ne = bin(0x47), lts = bin(0x48), ltu = bin(0x49), gts = bin(0x4a), gtu = bin(0x4b), leS = bin(0x4c), geS = bin(0x4e);
const or = bin(0x72), add = bin(0x6a), sub = bin(0x6b), mul = bin(0x6c), divS = bin(0x6d), remS = bin(0x6f), and = bin(0x71), shl = bin(0x74), shrS = bin(0x75), shru = bin(0x76);
const eqz = a => [...fl(a), 0x45];
const call = (f, ...args) => [...fl(args), 0x10, ...uleb(f)];
const UNREACH = [0x00];
const ret = v => [...fl(v), 0x0f];
const if_ = (cond, th, el) => [...fl(cond), 0x04, 0x40, ...fl(th), ...(el ? [0x05, ...fl(el)] : []), 0x0b];
const block = (...b) => [0x02, 0x40, ...fl(b), 0x0b];
const loop = (...b) => [0x03, 0x40, ...fl(b), 0x0b];
const br = d => [0x0c, ...uleb(d)];
const brIf = (cond, d) => [...fl(cond), 0x0d, ...uleb(d)];
const memSize = [0x3f, 0x00];
const memGrow = x => [...fl(x), 0x40, 0x00];
const callIndirect = (args, idx) => [...fl(args), ...fl(idx), 0x11, 0, 0];          // type 0, table 0
const retCallIndirect = (args, idx) => [...fl(args), ...fl(idx), 0x13, 0, 0];
const throwExc = v => [...fl(v), 0x08, ...uleb(0)];                 // throw tag0(exc)

/* 型別: 0 = (i32,i32)->i32   1 = (i32,i32,i32)->()   2 = (i32)->i32   3 = (i32)->() (例外 tag) */
const T_FN = 0, T_V3 = 1, T_1 = 2, T_TAG = 3;
/* 函式索引: 0,1 為 import；其後為 runtime helper；最後才是 LBC 函式 */
const F_PRIM = 0, F_ERR = 1, F_ALLOC = 2, F_ENVNEW = 3, F_ENVPUSH = 4, F_SLOT = 5, F_LOAD = 6,
  F_DEF = 7, F_SET = 8, F_MKCLOS = 9, F_CALL = 10, F_TAIL = 11, F_CONS = 12, F_REST = 13, F_FAST = 14,
  F_SPREAD = 15, F_FIRST = 16;
/* err(kind,a,b) 的種類 */
const E_UNBOUND = 1, E_ARITY = 2, E_NOTFN = 3, E_OOM = 5, E_SET_UNBOUND = 6, E_HSTK = 7, E_APPLY = 8;

/* ───────────── 以 wasm 寫成的 runtime ───────────── */
function buildRuntime() {
  const H = [];
  const gAddr = id => add(c(GBASE), shl(id, c(2)));      // 全域變數 slot 位址

  H[F_ALLOC] = { name: 'alloc', type: T_1, locals: 4, body: [               // 0:size 1:p 2:nh 3:cur 4:need
    ls(0, and(add(lg(0), c(3)), c(-4))),
    ls(1, gg(0)),
    ls(2, add(lg(1), lg(0))),
    ls(3, shl(memSize, c(16))),
    if_(gtu(lg(2), lg(3)), [
      ls(4, add(shru(sub(lg(2), lg(3)), c(16)), c(1))),
      if_(eq(memGrow(add(lg(4), shru(memSize, c(1)))), c(-1)), [
        if_(eq(memGrow(lg(4)), c(-1)), [call(F_ERR, c(E_OOM), c(0), c(0)), UNREACH]),
      ]),
    ]),
    gs(0, lg(2)),
    lg(1),
  ] };

  H[F_ENVNEW] = { name: 'env_new', type: T_1, locals: 1, body: [           // 0:parent 1:p
    ls(1, call(F_ALLOC, c(8))),
    st(lg(1), lg(0)),
    st(lg(1), c(0), 4),
    lg(1),
  ] };

  H[F_ENVPUSH] = { name: 'env_push', type: T_V3, locals: 1, body: [        // 0:env 1:id 2:val 3:cell
    ls(3, call(F_ALLOC, c(12))),
    st(lg(3), lg(1)),
    st(lg(3), lg(2), 4),
    st(lg(3), ld(lg(0), 4), 8),
    st(lg(0), lg(3), 4),
  ] };

  H[F_SLOT] = { name: 'slot', type: T_FN, locals: 1, body: [               // 0:env 1:id 2:cell  -> 變數 slot 位址或 0
    block(
      loop(
        brIf(eqz(lg(0)), 1),
        ls(2, ld(lg(0), 4)),
        block(
          loop(
            brIf(eqz(lg(2)), 1),
            if_(eq(ld(lg(2)), lg(1)), [ret(add(lg(2), c(4)))]),
            ls(2, ld(lg(2), 8)),
            br(0),
          ),
        ),
        ls(0, ld(lg(0))),
        br(0),
      ),
    ),
    ls(2, gAddr(lg(1))),
    if_(eqz(ld(lg(2))), [ret(c(0))]),
    lg(2),
  ] };

  H[F_LOAD] = { name: 'load', type: T_FN, locals: 1, body: [                // 0:env 1:id 2:slot
    ls(2, call(F_SLOT, lg(0), lg(1))),
    if_(eqz(lg(2)), [call(F_ERR, c(E_UNBOUND), lg(1), c(0)), UNREACH]),
    ld(lg(2)),
  ] };

  H[F_DEF] = { name: 'def', type: T_V3, locals: 1, body: [                  // 0:env 1:id 2:val 3:cell
    if_(eqz(lg(0)), [st(gAddr(lg(1)), lg(2)), [0x0f]]),
    ls(3, ld(lg(0), 4)),
    block(
      loop(
        brIf(eqz(lg(3)), 1),
        if_(eq(ld(lg(3)), lg(1)), [st(lg(3), lg(2), 4), [0x0f]]),
        ls(3, ld(lg(3), 8)),
        br(0),
      ),
    ),
    call(F_ENVPUSH, lg(0), lg(1), lg(2)),
  ] };

  H[F_SET] = { name: 'set', type: T_V3, locals: 1, body: [                  // 0:env 1:id 2:val 3:slot
    ls(3, call(F_SLOT, lg(0), lg(1))),
    if_(eqz(lg(3)), [call(F_ERR, c(E_SET_UNBOUND), lg(1), c(0)), UNREACH]),
    st(lg(3), lg(2)),
  ] };

  const mkObj3 = (nm, tag) => ({ name: nm, type: T_FN, locals: 1, body: [  // 0:a 1:b 2:p
    ls(2, call(F_ALLOC, c(12))),
    st(lg(2), c(tag)),
    st(lg(2), lg(0), 4),
    st(lg(2), lg(1), 8),
    lg(2),
  ] });
  H[F_MKCLOS] = mkObj3('mkclosure', TAG.CLOSURE);                           // (func_table_idx, env)
  H[F_CONS] = mkObj3('cons', TAG.PAIR);

  const callBody = tail => [                                                 // 0:fn 1:argc 2:tag 3:fast結果
    if_(and(lg(0), c(1)), [call(F_ERR, c(E_NOTFN), lg(0), c(0)), UNREACH]),
    ls(2, ld(lg(0))),
    if_(eq(lg(2), c(TAG.CLOSURE)), [
      (tail ? retCallIndirect : callIndirect)([ld(lg(0), 8), lg(1)], ld(lg(0), 4)),
      ...(tail ? [] : [[0x0f]]),
    ]),
    if_(eq(lg(2), c(TAG.PRIM)), [
      ls(3, call(F_FAST, ld(lg(0), 4), lg(1))),
      if_(lg(3), [ret(lg(3))]),
      ret(call(F_PRIM, ld(lg(0), 4), lg(1))),
    ]),
    call(F_ERR, c(E_NOTFN), lg(0), c(0)),
    UNREACH,
  ];
  H[F_CALL] = { name: 'call', type: T_FN, locals: 2, body: callBody(false) };
  H[F_TAIL] = { name: 'tailcall', type: T_FN, locals: 2, body: callBody(true) };

  H[F_REST] = { name: 'rest_list', type: T_FN, locals: 2, body: [           // 0:from 1:argc 2:acc 3:i
    ls(2, c(NIL)),
    ls(3, lg(1)),
    block(
      loop(
        brIf(leS(lg(3), lg(0)), 1),
        ls(3, sub(lg(3), c(1))),
        ls(2, call(F_CONS, ld(add(c(ARGBUF), shl(lg(3), c(2)))), lg(2))),
        br(0),
      ),
    ),
    lg(2),
  ] };

  /* 小整數快速路徑: 兩個引數都是小整數時，直接在 wasm 內完成算術與比較，不進宿主 JS。
   * 回傳 0 表示不適用 (交給宿主處理，例如溢位、浮點、除以零、型別錯誤)。 */
  const pid = n => PRIM_NAMES.indexOf(n);
  const when = (id, ...body) => if_(eq(lg(0), c(pid(id))), body);
  const cmpOp = (id, f) => when(id, if_(f(lg(2), lg(3)), [ret(c(TRUE))]), ret(c(FALSE)));
  const setS = v => [ls(6, v), ls(7, c(1))];                                // s = 結果，ok = 1
  H[F_FAST] = { name: 'fastprim', type: T_FN, locals: 6, body: [          // 0:id 1:argc 2:a 3:b 4:x 5:y 6:s 7:ok
    if_(ne(lg(1), c(2)), [ret(c(0))]),
    ls(2, ld(c(ARGBUF))), ls(3, ld(c(ARGBUF + 4))),
    if_(eqz(and(and(lg(2), lg(3)), c(1))), [ret(c(0))]),                    // 兩者皆須為小整數
    cmpOp('=', eq), cmpOp('<', lts), cmpOp('>', gts), cmpOp('<=', leS), cmpOp('>=', geS),   // 已標記的整數大小順序不變
    ls(4, shrS(lg(2), c(1))), ls(5, shrS(lg(3), c(1))), ls(6, c(0)), ls(7, c(0)),
    when('+', setS(add(lg(4), lg(5)))),
    when('-', setS(sub(lg(4), lg(5)))),
    when('*', if_(ltu(add(lg(4), c(32767)), c(65535)), [if_(ltu(add(lg(5), c(32767)), c(65535)), [setS(mul(lg(4), lg(5)))])])),
    when('quotient', if_(lg(5), [setS(divS(lg(4), lg(5)))])),
    when('remainder', if_(lg(5), [setS(remS(lg(4), lg(5)))])),
    when('modulo', if_(lg(5), [setS(remS(add(remS(lg(4), lg(5)), lg(5)), lg(5)))])),
    // 結果必須落在 31-bit 小整數範圍內，否則交給宿主 (會轉成 float 物件)
    if_(and(lg(7), ltu(add(lg(6), c(0x40000000)), c(-2147483648))), [ret(or(shl(lg(6), c(1)), c(1)))]),
    c(0),
  ] };

  H[F_SPREAD] = { name: 'spread', type: T_1, locals: 2, body: [   // 0:list 1:i 2:p : list 攤平成 ARGBUF，回傳 argc
    ls(1, c(0)),
    ls(2, lg(0)),
    block(
      loop(
        brIf(eq(lg(2), c(NIL)), 1),
        if_(or(and(lg(2), c(1)), ne(ld(lg(2)), c(TAG.PAIR))),
          [call(F_ERR, c(E_APPLY), lg(2), c(0)), UNREACH]),
        if_(gtu(add(lg(1), c(1)), c(ARGMAX)),
          [call(F_ERR, c(E_APPLY), lg(2), c(0)), UNREACH]),
        st(add(c(ARGBUF), shl(lg(1), c(2))), ld(lg(2), 4)),
        ls(2, ld(lg(2), 8)),
        ls(1, add(lg(1), c(1))),
        br(0),
      ),
    ),
    lg(1),
  ] };
  return H;
}

/* ───────────── 讀取 LBC 文字 ───────────── */
function loadLBC(text) {
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
    if (op === 'CONST') arg = JSON.parse(arg);
    else if (op === 'CALL' || op === 'TAILCALL') arg = Number(arg);
    cur.code.push([op, arg]);
  });
  for (const f of funcs.values()) {
    for (const ins of f.code) {
      if (ins[0] === 'JMP' || ins[0] === 'JF' || ins[0] === 'TRY') {
        const t = f.labels.get(ins[1]);
        if (t === undefined) throw new Error(`函式 ${f.name}: 找不到標籤 ${ins[1]}`);
        ins[1] = t;
      } else if (ins[0] === 'CLOSURE' && !funcs.has(ins[1])) throw new Error(`找不到函式 ${ins[1]}`);
    }
  }
  if (!funcs.has('main')) throw new Error('缺少 main 函式');
  return funcs;
}

/* ───────────── 靜態資料區 ───────────── */
const align8 = n => (n + 7) & ~7;
class Static {
  constructor(top) {
    this.top = align8(top);
    this.buf = Buffer.alloc(Math.max(this.top + 4096, 1 << 14));
    this.strs = new Map(); this.syms = new Map(); this.flts = new Map();
  }
  ensure(n) { if (n > this.buf.length) { const nb = Buffer.alloc(Math.max(n, this.buf.length * 2)); this.buf.copy(nb); this.buf = nb; } }
  alloc(size) { const a = this.top; this.top += align8(size); this.ensure(this.top); return a; }
  w32(a, v) { this.ensure(a + 4); this.buf.writeInt32LE(v | 0, a); }
  str(s) {
    if (this.strs.has(s)) return this.strs.get(s);
    const b = Buffer.from(s, 'utf8'), a = this.alloc(8 + b.length);
    this.w32(a, TAG.STR); this.w32(a + 4, b.length); b.copy(this.buf, a + 8);
    this.strs.set(s, a); return a;
  }
  sym(n) {
    if (this.syms.has(n)) return this.syms.get(n);
    const sp = this.str(n), a = this.alloc(8);
    this.w32(a, TAG.SYM); this.w32(a + 4, sp);
    this.syms.set(n, a); return a;
  }
  float(x) {
    const k = Object.is(x, -0) ? '-0' : String(x);
    if (this.flts.has(k)) return this.flts.get(k);
    const a = this.alloc(16);
    this.w32(a, TAG.FLOAT); this.buf.writeDoubleLE(x, a + 8);
    this.flts.set(k, a); return a;
  }
  big(s) {                                        // 十進位字串載體 (host 端轉 BigInt 運算)
    const b = Buffer.from(s, 'utf8'), a = this.alloc(8 + b.length);
    this.w32(a, TAG.BIG); this.w32(a + 4, b.length); b.copy(this.buf, a + 8);
    return a;
  }
  pair(car, cdr) { const a = this.alloc(12); this.w32(a, TAG.PAIR); this.w32(a + 4, car); this.w32(a + 8, cdr); return a; }
  value(d) {                                    // JSON 常數 -> 值 (i32)
    if (typeof d === 'bigint') return this.big(String(d));
    if (typeof d === 'number') return Number.isInteger(d) && d >= -1073741824 && d <= 1073741823 ? ((d << 1) | 1) : this.float(d);
    if (typeof d === 'boolean') return d ? TRUE : FALSE;
    if (typeof d === 'string') return this.str(d);
    if (d === null) return NIL;
    if ('big' in d) return this.big(d.big);
    if ('sym' in d) return this.sym(d.sym);
    if ('list' in d) { let r = NIL; for (let i = d.list.length - 1; i >= 0; i--) r = this.pair(this.value(d.list[i]), r); return r; }
    throw new Error('錯誤的常數: ' + JSON.stringify(d));
  }
}

/* ───────────── 把一個 LBC 函式編譯成 wasm 函式 ───────────── */
const L_ENV = 0, L_ARGC = 1, L_CENV = 2, L_PC = 3, L_S = 4;     // local 配置: 運算元堆疊 slot 從 4 開始
const tryCatch = (tbody, hbody) => [0x06, 0x40, ...fl(tbody), 0x07, ...uleb(0), ...fl(hbody), 0x0b];

function genFunc(fn, fidx, ctx) {
  const code = fn.code, n = code.length, isMain = fn.name === 'main';

  // 1. 靜態分析每個指令的堆疊深度 (所有路徑必須一致)
  const depth = new Array(n).fill(undefined), work = [], targets = new Set(), catches = new Set();
  let maxd = 0;
  const visit = (pc, d) => {
    if (pc >= n) throw new Error(`函式 ${fn.name}: 執行流程跑到函式結尾而沒有 RET / HALT`);
    if (depth[pc] === undefined) { depth[pc] = d; work.push(pc); }
    else if (depth[pc] !== d) throw new Error(`函式 ${fn.name}: 位置 ${pc} 的堆疊深度不一致 (${depth[pc]} vs ${d})`);
  };
  visit(0, 0);
  while (work.length) {
    const pc = work.pop(), d = depth[pc], [op, arg] = code[pc];
    const need = k => { if (d < k) throw new Error(`函式 ${fn.name}: 位置 ${pc} (${op}) 堆疊不足`); };
    switch (op) {
      case 'CONST': case 'VOID': case 'LOAD': case 'CLOSURE': maxd = Math.max(maxd, d + 1); visit(pc + 1, d + 1); break;
      case 'DEF': case 'SET': need(1); visit(pc + 1, d); break;
      case 'POP': need(1); visit(pc + 1, d - 1); break;
      case 'JMP': targets.add(arg); visit(arg, d); break;
      case 'JF': need(1); targets.add(arg); visit(arg, d - 1); visit(pc + 1, d - 1); break;
      case 'CALL': need(arg + 1); if (arg > ARGMAX) throw new Error(`CALL ${arg}: 引數過多 (上限 ${ARGMAX})`); visit(pc + 1, d - arg); break;
      case 'TAILCALL': need(arg + 1); if (arg > ARGMAX) throw new Error(`TAILCALL ${arg}: 引數過多 (上限 ${ARGMAX})`); break;
      case 'APPLY': need(2); visit(pc + 1, d - 1); break;
      case 'TAILAPPLY': need(2); break;
      case 'TRY': targets.add(arg); catches.add(arg); visit(arg, d + 1); maxd = Math.max(maxd, d + 1); visit(pc + 1, d); break;
      case 'UNTRY': visit(pc + 1, d); break;
      case 'THROW': need(1); break;
      case 'RET': need(1); break;
      case 'HALT': break;
      default: throw new Error(`函式 ${fn.name}: 未知的指令 ${op}`);
    }
  }
  const L_EXC = L_S + maxd;                           // 例外值暫存 local (僅含 TRY 的函式使用)

  // 2. 基本區塊: 0 與所有跳躍目標
  const leaders = [...new Set([0, ...targets])].sort((a, b) => a - b);
  const nb = leaders.length, blockOf = new Map(leaders.map((pc, i) => [pc, i]));
  const hasJumps = targets.size > 0;

  // 3. 逐區塊產生程式碼
  const blocks = leaders.map((start, bi) => {
    const end = bi + 1 < nb ? leaders[bi + 1] : n, out = [];
    const toLoop = nb - 1 - bi;                             // 從此區塊 br 回分派迴圈的深度
    if (catches.has(start)) out.push(ls(L_S + depth[start] - 1, lg(L_EXC)));   // catch 入口: 例外值進 slot
    for (let pc = start; pc < end; pc++) {
      if (depth[pc] === undefined) continue;                // 不可達的指令
      const d = depth[pc], [op, arg] = code[pc];
      const S = i => lg(L_S + i), setS = (i, v) => ls(L_S + i, v);
      const hslot = add(c(ctx.hsBase), shl(gg(1), c(3)));    // 處理器堆疊頂位址
      switch (op) {
        case 'CONST': out.push(setS(d, c(ctx.st.value(arg)))); break;
        case 'VOID': out.push(setS(d, c(VOID))); break;
        case 'LOAD': out.push(setS(d, call(F_LOAD, lg(L_CENV), c(ctx.nameId(arg))))); break;
        case 'DEF': out.push(call(F_DEF, lg(L_CENV), c(ctx.nameId(arg)), S(d - 1)), setS(d - 1, c(VOID))); break;
        case 'SET': out.push(call(F_SET, lg(L_CENV), c(ctx.nameId(arg)), S(d - 1)), setS(d - 1, c(VOID))); break;
        case 'POP': break;
        case 'CLOSURE': out.push(setS(d, call(F_MKCLOS, c(ctx.funcIndex(arg)), lg(L_CENV)))); break;
        case 'CALL': case 'TAILCALL': {
          const base = d - arg - 1;
          for (let i = 0; i < arg; i++) out.push(st(c(ARGBUF + 4 * i), S(base + 1 + i)));
          if (op === 'CALL') out.push(setS(base, call(F_CALL, S(base), c(arg))));
          else out.push(S(base), c(arg), [0x12, ...uleb(F_TAIL)]);                // return_call
          break;
        }
        case 'APPLY': case 'TAILAPPLY': {
          const base = d - 2;
          if (op === 'APPLY') out.push(setS(base, call(F_CALL, S(base), call(F_SPREAD, S(base + 1)))));
          else out.push(S(base), call(F_SPREAD, S(base + 1)), [0x12, ...uleb(F_TAIL)]);   // return_call
          break;
        }
        case 'TRY':
          out.push(
            if_(gtu(add(gg(1), c(1)), c(HS_N)), [call(F_ERR, c(E_HSTK), c(0), c(0)), UNREACH]),
            st(hslot, lg(L_CENV)),
            st(hslot, c(blockOf.get(arg)), 4),
            gs(1, add(gg(1), c(1))),
          );
          break;
        case 'UNTRY':
          out.push(
            if_(eqz(gg(1)), [call(F_ERR, c(E_HSTK), c(0), c(0)), UNREACH]),
            gs(1, sub(gg(1), c(1))),
          );
          break;
        case 'THROW': out.push(throwExc(S(d - 1))); break;
        case 'RET': out.push(ret(S(d - 1))); break;
        case 'HALT': out.push(ret(d > 0 ? S(d - 1) : c(VOID))); break;
        case 'JMP': out.push(ls(L_PC, c(blockOf.get(arg))), br(toLoop)); break;
        case 'JF': out.push(ls(L_PC, c(blockOf.get(arg))), brIf(eq(S(d - 1), c(FALSE)), toLoop)); break;
      }
    }
    return out;
  });

  // 4. 函式前言: 建立環境並綁定參數
  const body = [];
  body.push(ls(L_CENV, isMain ? lg(L_ENV) : call(F_ENVNEW, lg(L_ENV))));
  if (!isMain) {
    const k = fn.params.length;
    body.push(if_(fn.rest === null ? ne(lg(L_ARGC), c(k)) : lts(lg(L_ARGC), c(k)),
      [call(F_ERR, c(E_ARITY), c(fidx), lg(L_ARGC)), UNREACH]));
    fn.params.forEach((p, i) => body.push(call(F_ENVPUSH, lg(L_CENV), c(ctx.nameId(p)), ld(c(ARGBUF + 4 * i)))));
    if (fn.rest !== null) body.push(call(F_ENVPUSH, lg(L_CENV), c(ctx.nameId(fn.rest)), call(F_REST, c(k), lg(L_ARGC))));
  }

  // 5. 區塊分派: loop { block{ ... block{ br_table } bb0 } ... bb(n-1) }
  //    含 TRY 的函式再包一層 loop + try/catch: 捕捉後查處理器堆疊，
  //    是自己的就回到分派迴圈，否則重丟給外層。
  //    注意: try 本身佔一個 label 深度，所以 handler 內 block=0、try=1、$again=2。
  const hasTry = code.some(([op]) => op === 'TRY');
  let dispatch;
  if (!hasJumps) dispatch = blocks[0];
  else {
    let cur = [...lg(L_PC), 0x0e, ...uleb(nb), ...fl(leaders.map((_, i) => uleb(i))), ...uleb(nb - 1)];
    for (let i = 0; i < nb; i++) cur = [...block(cur), ...fl(blocks[i])];
    dispatch = loop(cur);
  }
  if (!hasTry) body.push(dispatch);
  else {
    const topBefore = add(c(ctx.hsBase), shl(sub(gg(1), c(1)), c(3)));   // pop 前的頂項
    const topAfter = add(c(ctx.hsBase), shl(gg(1), c(3)));               // pop 後的頂項
    body.push(loop(tryCatch(dispatch, [
      ls(L_EXC, []),                                            // exc 進 local
      block(                                                    // 不符就跳出重丟
        brIf(eqz(gg(1)), 0),                                    // 無處理器
        brIf(ne(ld(topBefore), lg(L_CENV)), 0),                 // 不是這個框架的
        gs(1, sub(gg(1), c(1))),
        ls(L_PC, ld(topAfter, 4)),
        br(2),                                                 // 回到 $again 迴圈 (重進 try)
      ),
      throwExc(lg(L_EXC)),                                      // 等同 rethrow (同 payload 再丟)
    ])));
  }
  body.push(UNREACH);
  return { name: fn.name, type: T_FN, locals: 2 + maxd + 1, body };
}

/* ───────────── 組裝整個 wasm 模組 ───────────── */
function compile(lbcText) {
  const funcs = loadLBC(lbcText), flist = [...funcs.values()];

  // 名稱表: 先放內建函式，再放程式中出現的所有變數名稱
  const names = [...PRIM_NAMES], nameIds = new Map(names.map((n, i) => [n, i]));
  const nameId = n => { if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); } return nameIds.get(n); };
  for (const f of flist) {
    f.params.forEach(nameId); if (f.rest) nameId(f.rest);
    for (const [op, arg] of f.code) if (op === 'LOAD' || op === 'DEF' || op === 'SET') nameId(arg);
  }

  // 靜態資料: 單例、內建函式物件、(之後) 常數 (GLOBALS 後先留處理器堆疊區)
  const hsBase = align8(GBASE + 4 * names.length);
  const stt = new Static(hsBase + HS_BYTES);
  stt.w32(NIL, TAG.NIL); stt.w32(VOID, TAG.VOID); stt.w32(TRUE, TAG.TRUE); stt.w32(FALSE, TAG.FALSE);
  PRIM_NAMES.forEach((pn, i) => {
    const a = stt.alloc(8); stt.w32(a, TAG.PRIM); stt.w32(a + 4, i);
    stt.w32(GBASE + 4 * nameIds.get(pn), a);
  });
  const tagAddrs = {};                                  // 供 vector/hash-map 原生函式用的標籤符號
  for (const t of ['vec', 'map']) tagAddrs[t] = stt.sym('%' + t);

  const ctx = { st: stt, nameId, funcIndex: nm => flist.findIndex(f => f.name === nm), hsBase };
  const lbcFuncs = flist.map((f, i) => genFunc(f, i, ctx));
  const helpers = buildRuntime();
  const all = [...helpers.slice(F_ALLOC), ...lbcFuncs];             // 定義的函式 (索引從 F_ALLOC 起)
  const mainIdx = F_FIRST + flist.findIndex(f => f.name === 'main');

  // type / import / function / table / memory / tag / global / export / element / code / data
  // (tag section 必須放在 global 之前，否則驗證失敗)
  const types = section(1, vec([
    [0x60, ...vec([[0x7f], [0x7f]]), ...vec([[0x7f]])],
    [0x60, ...vec([[0x7f], [0x7f], [0x7f]]), ...vec([])],
    [0x60, ...vec([[0x7f]]), ...vec([[0x7f]])],
    [0x60, ...vec([[0x7f]]), ...vec([])],
  ]));
  const imports = section(2, vec([
    [...name('env'), ...name('prim'), 0x00, T_FN],
    [...name('env'), ...name('err'), 0x00, T_V3],
  ]));
  const funcSec = section(3, vec(all.map(f => [f.type])));
  const nTable = lbcFuncs.length;
  const table = section(4, vec([[0x70, 0x01, ...uleb(nTable), ...uleb(nTable)]]));
  const minPages = Math.ceil((stt.top + (1 << 20)) / 65536);
  const memory = section(5, vec([[0x01, ...uleb(minPages), ...uleb(Math.max(MAX_PAGES, minPages))]]));
  const globals = section(6, vec([[0x7f, 0x01, ...c(stt.top), 0x0b], [0x7f, 0x01, ...c(0), 0x0b]]));
  const tags = section(13, [...uleb(1), 0x00, T_TAG]);
  const exportsSec = section(7, vec([
    [...name('memory'), 0x02, 0x00],
    [...name('main'), 0x00, ...uleb(mainIdx)],
    [...name('alloc'), 0x00, ...uleb(F_ALLOC)],
    [...name('exntag'), 0x04, ...uleb(0)],
  ]));
  const elem = section(9, vec([[0x00, ...c(0), 0x0b, ...vec(lbcFuncs.map((_, i) => uleb(F_FIRST + i)))]]));
  const codeSec = section(10, vec(all.map(f => {
    const b = [...(f.locals ? [1, ...uleb(f.locals), 0x7f] : [0]), ...fl(f.body), 0x0b];
    return [...uleb(b.length), ...b];
  })));
  const data = section(11, vec([[0x00, ...c(0), 0x0b, ...uleb(stt.top), ...stt.buf.subarray(0, stt.top)]]));

  // 自訂區段: 函式名稱 (除錯用的標準 name section) 與 runtime 需要的中繼資料
  const fnNames = [[F_PRIM, 'prim'], [F_ERR, 'err'], ...all.map((f, i) => [F_ALLOC + i, f.name])];
  const nameSec = section(0, [...name('name'), 1, ...(() => { const b = vec(fnNames.map(([i, s]) => [...uleb(i), ...name(s)])); return [...uleb(b.length), ...b]; })()]);
  const meta = JSON.stringify({
    version: 1, names, prims: PRIM_NAMES.length, tags: tagAddrs,
    funcs: flist.map(f => ({ name: f.name, params: f.params.length, rest: f.rest !== null })),
  });
  const metaSec = section(0, [...name('lbc.meta'), ...Buffer.from(meta, 'utf8')]);

  const bytes = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...types, ...imports, ...funcSec, ...table, ...memory, ...tags, ...globals, ...exportsSec, ...elem,
    ...codeSec, ...data, ...nameSec, ...metaSec]);
  try { new WebAssembly.Module(bytes); }
  catch (e) { throw new Error('產生的 wasm 無法通過驗證 (需要支援 tail-call 的 Node.js v20+): ' + e.message); }
  return bytes;
}

/* ═══════════════════════ 執行端 (宿主 JS) ═══════════════════════
 * 只負責: 內建函式、錯誤訊息、輸出。所有資料都直接讀寫 wasm 線性記憶體。 */
function runBytes(bytes, progArgs = []) {
  const mod = new WebAssembly.Module(bytes);
  const sec = WebAssembly.Module.customSections(mod, 'lbc.meta');
  if (!sec.length) throw new Error('不是由 vm2wasm.js 產生的 wasm (缺少 lbc.meta)');
  const meta = JSON.parse(Buffer.from(sec[0]).toString('utf8'));

  let ex = null, exnTag = null, lastBuf = null, dv = null, u8 = null;
  const V = () => { if (ex.memory.buffer !== lastBuf) { lastBuf = ex.memory.buffer; dv = new DataView(lastBuf); u8 = new Uint8Array(lastBuf); } return dv; };
  const rd = a => V().getInt32(a, true);
  const wr = (a, v) => V().setInt32(a, v, true);
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* 輸出緩衝 */
  let outBuf = [], outLen = 0;
  const flush = () => { if (outBuf.length) { process.stdout.write(outBuf.join('')); outBuf = []; outLen = 0; } };
  const out = s => { outBuf.push(s); outLen += s.length; if (outLen > 65536) flush(); };

  /* 值存取 */
  const tagOf = v => (v & 1) ? 0 : rd(v);
  const isBigV = v => !(v & 1) && rd(v) === TAG.BIG;
  const isNumV = v => (v & 1) || rd(v) === TAG.FLOAT || rd(v) === TAG.BIG;
  const numVal = v => (v & 1) ? v >> 1 : V().getFloat64(v + 8, true);
  const toBig = (v, who) => {                           // 與 fpvm toBig 同語意 (錯誤訊息一致)
    if (v & 1) return BigInt(v >> 1);
    const t = rd(v);
    if (t === TAG.BIG) return BigInt(strOf(v));
    if (t === TAG.FLOAT) { const x = numVal(v); if (Number.isInteger(x)) return BigInt(x); }
    throw new Error(`${who}: 需要整數，得到 ${toStr(v, true)}`);
  };
  const toIdxV = (v, who) => {                            // 與 fpvm toIdx 同語意
    if (v & 1) return v >> 1;
    if (rd(v) === TAG.BIG) { const b = BigInt(strOf(v)); return (b >= 0n && b <= 9007199254740991n) ? Number(b) : -1; }
    if (rd(v) === TAG.FLOAT && Number.isInteger(numVal(v))) return numVal(v);
    throw new Error(`${who}: 需要 Nat 索引，得到 ${toStr(v, true)}`);
  };
  const mkNum = x => {
    if (Number.isInteger(x) && x >= -1073741824 && x <= 1073741823) return (x << 1) | 1;
    const p = ex.alloc(16); wr(p, TAG.FLOAT); V().setFloat64(p + 8, x, true); return p;
  };
  const strOf = v => { const len = rd(v + 4); V(); return dec.decode(u8.subarray(v + 8, v + 8 + len)); };
  const mkBig = x => { const b = enc.encode(String(x)), p = ex.alloc(8 + b.length); wr(p, TAG.BIG); wr(p + 4, b.length); V(); u8.set(b, p + 8); return p; };
  const mkStr = s => { const b = enc.encode(s), p = ex.alloc(8 + b.length); wr(p, TAG.STR); wr(p + 4, b.length); V(); u8.set(b, p + 8); return p; };
  const mkPair = (a, d) => { const p = ex.alloc(12); wr(p, TAG.PAIR); wr(p + 4, a); wr(p + 8, d); return p; };
  const isPair = v => !(v & 1) && rd(v) === TAG.PAIR;
  const isArr = v => !(v & 1) && rd(v) === TAG.ARR;
  const arrLen = v => rd(v + 4);
  const arrAt = (v, i) => rd(v + 8 + 4 * i);
  const mkArr = items => { const p = ex.alloc(8 + 4 * items.length); wr(p, TAG.ARR); wr(p + 4, items.length); V(); items.forEach((x, i) => wr(p + 8 + 4 * i, x)); return p; };
  const car = v => rd(v + 4), cdr = v => rd(v + 8);
  const bool = b => b ? TRUE : FALSE;
  const arrOf = l => { const a = []; for (; isPair(l); l = cdr(l)) a.push(car(l)); return a; };
  const listOf = a => { let r = NIL; for (let i = a.length - 1; i >= 0; i--) r = mkPair(a[i], r); return r; };

  function toStr(v, write) {
    if (v & 1) return String(v >> 1);
    switch (rd(v)) {
      case TAG.FLOAT: return String(numVal(v));
      case TAG.BIG: return strOf(v);
      case TAG.STR: { const s = strOf(v); return write ? JSON.stringify(s) : s; }
      case TAG.SYM: return strOf(rd(v + 4));
      case TAG.CLOSURE: return `#<procedure ${meta.funcs[rd(v + 4)].name}>`;
      case TAG.PRIM: return '#<primitive>';
      case TAG.NIL: return '()';
      case TAG.VOID: return '';
      case TAG.TRUE: return '#t';
      case TAG.FALSE: return '#f';
      case TAG.PAIR: {
        const parts = []; let p = v;
        for (; isPair(p); p = cdr(p)) parts.push(toStr(car(p), write));
        return '(' + parts.join(' ') + (p === NIL ? '' : ' . ' + toStr(p, write)) + ')';
      }
      case TAG.ARR: {
        const parts = []; for (let i = 0; i < arrLen(v); i++) parts.push(toStr(arrAt(v, i), write));
        return '#[' + parts.join(', ') + ']';
      }
    }
    return '#<unknown>';
  }
  const numEqV = (a, b) => {                          // 跨 smallint/float/bigint 的數值相等
    if (!isBigV(a) && !isBigV(b)) return numVal(a) === numVal(b);
    try { return toBig(a, '') === toBig(b, ''); } catch { return false; }
  };
  const eqv = (a, b) => {
    if (a === b) return true;
    if (isNumV(a) && isNumV(b)) return numEqV(a, b);
    return tagOf(a) === TAG.STR && tagOf(b) === TAG.STR && strOf(a) === strOf(b);
  };
  const equal = (a, b) => {
    if (isPair(a) && isPair(b)) return equal(car(a), car(b)) && equal(cdr(a), cdr(b));
    if (isArr(a) && isArr(b)) {
      if (arrLen(a) !== arrLen(b)) return false;
      for (let i = 0; i < arrLen(a); i++) if (!equal(arrAt(a, i), arrAt(b, i))) return false;
      return true;
    }
    return eqv(a, b);
  };

  /* 內建函式: 引數在 ARGBUF，A(i) 取第 i 個 */
  const A = i => rd(ARGBUF + 4 * i);
  const tagSym = which => {                             // meta.tags 記載 %vec/%map 符號物件位址
    if (!meta.tags || meta.tags[which] === undefined) throw new Error('vector/hash-map: 需要以新版 vm2wasm 重編');
    return meta.tags[which];
  };
  const argsOf = n => { const r = []; for (let i = 0; i < n; i++) r.push(A(i)); return r; };
  const num = (v, who) => { if (!isNumV(v) || isBigV(v)) throw new Error(`${who}: 需要數字，得到 ${toStr(v, true)}`); return numVal(v); };
  const req = (who, n, k) => { if (n < k) throw new Error(`${who}: 參數個數錯誤 (需要 ${k}，得到 ${n})`); };
  const nums = (who, n) => { const r = []; for (let i = 0; i < n; i++) r.push(num(A(i), who)); return r; };
  const cmp = (who, f) => n => {
    const vs = argsOf(n);
    if (vs.every(v => !(v & 1) && rd(v) === TAG.STR)) {
      for (let i = 0; i < vs.length - 1; i++) if (!f(strOf(vs[i]), strOf(vs[i + 1]))) return FALSE; return TRUE;
    }
    const B = vs.some(isBigV), v = B ? vs.map(x => toBig(x, who)) : vs.map(x => num(x, who));
    for (let i = 0; i < v.length - 1; i++) if (!f(v[i], v[i + 1])) return FALSE; return TRUE;
  };
  const pairOrErr = (who, v) => { if (!isPair(v)) throw new Error(`${who}: 不是 pair: ${toStr(v, true)}`); return v; };

  const impl = {
    '+': n => { const vs = argsOf(n); return vs.some(isBigV) ? mkBig(vs.map(x => toBig(x, '+')).reduce((x, y) => x + y, 0n)) : mkNum(nums('+', n).reduce((x, y) => x + y, 0)); },
    '*': n => { const vs = argsOf(n); return vs.some(isBigV) ? mkBig(vs.map(x => toBig(x, '*')).reduce((x, y) => x * y, 1n)) : mkNum(nums('*', n).reduce((x, y) => x * y, 1)); },
    '-': n => {
      req('-', n, 1); const vs = argsOf(n);
      if (vs.some(isBigV)) { const b = vs.map(x => toBig(x, '-')); return mkBig(n === 1 ? -b[0] : b.slice(1).reduce((x, y) => x - y, b[0])); }
      const a = nums('-', n); return mkNum(n === 1 ? -a[0] : a.slice(1).reduce((x, y) => x - y, a[0]));
    },
    '/': n => {
      req('/', n, 1); const vs = argsOf(n);
      if (vs.some(isBigV)) {
        const b = vs.map(x => toBig(x, '/'));
        if (b.length === 1) return b[0] === 1n ? mkBig(1n) : b[0] === -1n ? mkBig(-1n) : mkNum(1 / Number(b[0]));
        let acc = b[0], exact = true;
        for (const y of b.slice(1)) {
          if (y === 0n) throw new Error('/: 除以零');
          if (exact && acc % y === 0n) acc = acc / y; else exact = false;
        }
        return exact ? mkBig(acc) : mkNum(b.slice(1).reduce((x, y) => Number(x) / Number(y), Number(b[0])));
      }
      const a = nums('/', n);
      return mkNum(n === 1 ? 1 / a[0] : a.slice(1).reduce((x, y) => { if (y === 0) throw new Error('/: 除以零'); return x / y; }, a[0]));
    },
    'quotient': n => { req('quotient', n, 2); return isBigV(A(0)) || isBigV(A(1)) ? mkBig(toBig(A(0), 'quotient') / toBig(A(1), 'quotient')) : mkNum(Math.trunc(num(A(0), 'quotient') / num(A(1), 'quotient'))); },
    'remainder': n => { req('remainder', n, 2); return isBigV(A(0)) || isBigV(A(1)) ? mkBig(toBig(A(0), 'remainder') % toBig(A(1), 'remainder')) : mkNum(num(A(0), 'remainder') % num(A(1), 'remainder')); },
    'modulo': n => {
      req('modulo', n, 2);
      if (isBigV(A(0)) || isBigV(A(1))) { const a = toBig(A(0), 'modulo'), b = toBig(A(1), 'modulo'); return mkBig(((a % b) + b) % b); }
      const a = num(A(0), 'modulo'), b = num(A(1), 'modulo'); return mkNum(((a % b) + b) % b);
    },
    '=': cmp('=', (a, b) => a === b), '<': cmp('<', (a, b) => a < b), '>': cmp('>', (a, b) => a > b),
    '<=': cmp('<=', (a, b) => a <= b), '>=': cmp('>=', (a, b) => a >= b),
    'abs': n => { req('abs', n, 1); return isBigV(A(0)) ? mkBig(toBig(A(0), 'abs') < 0n ? -toBig(A(0), 'abs') : toBig(A(0), 'abs')) : mkNum(Math.abs(num(A(0), 'abs'))); },
    'min': n => { const vs = argsOf(n); return vs.some(isBigV) ? mkBig(vs.map(x => toBig(x, 'min')).reduce((x, y) => x < y ? x : y)) : mkNum(Math.min(...nums('min', n))); },
    'max': n => { const vs = argsOf(n); return vs.some(isBigV) ? mkBig(vs.map(x => toBig(x, 'max')).reduce((x, y) => x > y ? x : y)) : mkNum(Math.max(...nums('max', n))); },
    'zero?': n => { req('zero?', n, 1); return bool(isBigV(A(0)) ? toBig(A(0), 'zero?') === 0n : num(A(0), 'zero?') === 0); },
    'even?': n => { req('even?', n, 1); return bool(isBigV(A(0)) ? toBig(A(0), 'even?') % 2n === 0n : num(A(0), 'even?') % 2 === 0); },
    'odd?': n => { req('odd?', n, 1); return bool(isBigV(A(0)) ? (() => { const x = toBig(A(0), 'odd?'); return (x < 0n ? -x : x) % 2n === 1n; })() : Math.abs(num(A(0), 'odd?') % 2) === 1); },
    'not': n => { req('not', n, 1); return bool(A(0) === FALSE); },
    'eq?': n => { req('eq?', n, 2); return bool(eqv(A(0), A(1))); },
    'eqv?': n => { req('eqv?', n, 2); return bool(eqv(A(0), A(1))); },
    'equal?': n => { req('equal?', n, 2); return bool(equal(A(0), A(1))); },
    'cons': n => { req('cons', n, 2); return mkPair(A(0), A(1)); },
    'car': n => { req('car', n, 1); return car(pairOrErr('car', A(0))); },
    'cdr': n => { req('cdr', n, 1); return cdr(pairOrErr('cdr', A(0))); },
    'cadr': n => { req('cadr', n, 1); return car(pairOrErr('cadr', cdr(pairOrErr('cadr', A(0))))); },
    'cddr': n => { req('cddr', n, 1); return cdr(pairOrErr('cddr', cdr(pairOrErr('cddr', A(0))))); },
    'caddr': n => { req('caddr', n, 1); return car(pairOrErr('caddr', cdr(pairOrErr('caddr', cdr(pairOrErr('caddr', A(0))))))); },
    'list': n => { let r = NIL; for (let i = n - 1; i >= 0; i--) r = mkPair(A(i), r); return r; },
    'vector': n => { let r = NIL; for (let i = n - 1; i >= 0; i--) r = mkPair(A(i), r); return mkPair(tagSym('vec'), r); },
    'hash-map': n => {
      if (n % 2) throw new Error('hash-map: 需要偶數個參數');
      const ks = [], vs = [];
      for (let i = 0; i < n; i += 2) {
        const j = ks.findIndex(k => equal(k, A(i)));
        if (j < 0) { ks.push(A(i)); vs.push(A(i + 1)); } else vs[j] = A(i + 1);
      }
      let es = NIL;
      for (let i = ks.length - 1; i >= 0; i--) es = mkPair(mkPair(ks[i], mkPair(vs[i], NIL)), es);
      return mkPair(tagSym('map'), es);
    },
    'array': n => mkArr(argsOf(n)),
    'array-empty': n => {
      if (n !== 0) throw new Error(`array-empty: 參數個數錯誤 (需要 0，得到 ${n})`);
      return mkArr([]);
    },
    'array-push': n => {
      if (n !== 2) throw new Error(`array-push: 參數個數錯誤 (需要 2，得到 ${n})`);
      if (!isArr(A(0))) throw new Error('array-push: 需要 array，得到 ' + toStr(A(0), true));
      const items = []; for (let i = 0; i < arrLen(A(0)); i++) items.push(arrAt(A(0), i));
      items.push(A(1)); return mkArr(items);
    },
    'array-get': n => {
      if (n !== 2) throw new Error(`array-get: 參數個數錯誤 (需要 2，得到 ${n})`);
      if (!isArr(A(0))) throw new Error('array-get: 需要 array，得到 ' + toStr(A(0), true));
      const k = toIdxV(A(1), 'array-get');
      if (k < 0 || k >= arrLen(A(0))) throw new Error(`array-get: 索引超出範圍 (長度 ${arrLen(A(0))}，得到 ${toStr(A(1), true)})`);
      return arrAt(A(0), k);
    },
    'array-set': n => {
      if (n !== 3) throw new Error(`array-set: 參數個數錯誤 (需要 3，得到 ${n})`);
      if (!isArr(A(0))) throw new Error('array-set: 需要 array，得到 ' + toStr(A(0), true));
      const k = toIdxV(A(1), 'array-set');
      if (k < 0 || k >= arrLen(A(0))) throw new Error(`array-set: 索引超出範圍 (長度 ${arrLen(A(0))}，得到 ${toStr(A(1), true)})`);
      const items = []; for (let i = 0; i < arrLen(A(0)); i++) items.push(arrAt(A(0), i));
      items[k] = A(2); return mkArr(items);
    },
    'array-size': n => {
      if (n !== 1) throw new Error(`array-size: 參數個數錯誤 (需要 1，得到 ${n})`);
      if (!isArr(A(0))) throw new Error('array-size: 需要 array，得到 ' + toStr(A(0), true));
      return mkNum(arrLen(A(0)));
    },
    'array?': n => {
      if (n !== 1) throw new Error(`array?: 參數個數錯誤 (需要 1，得到 ${n})`);
      return bool(isArr(A(0)));
    },
    'length': n => { req('length', n, 1); return mkNum(arrOf(A(0)).length); },
    'append': n => { const all = []; for (let i = 0; i < n; i++) all.push(...arrOf(A(i))); return listOf(all); },
    'reverse': n => { req('reverse', n, 1); return listOf(arrOf(A(0)).reverse()); },
    'null?': n => { req('null?', n, 1); return bool(A(0) === NIL); },
    'pair?': n => { req('pair?', n, 1); return bool(isPair(A(0))); },
    'number?': n => { req('number?', n, 1); return bool(isNumV(A(0))); },
    'string?': n => { req('string?', n, 1); return bool(tagOf(A(0)) === TAG.STR); },
    'symbol?': n => { req('symbol?', n, 1); return bool(tagOf(A(0)) === TAG.SYM); },
    'procedure?': n => { req('procedure?', n, 1); const t = tagOf(A(0)); return bool(t === TAG.CLOSURE || t === TAG.PRIM); },
    'string-append': n => { let s = ''; for (let i = 0; i < n; i++) s += toStr(A(i), false); return mkStr(s); },
    'string-length': n => {
      req('string-length', n, 1);
      if (tagOf(A(0)) !== TAG.STR) throw new Error('string-length: 需要字串，得到 ' + toStr(A(0), true));
      return mkNum([...strOf(A(0))].length);
    },
    'string-ref': n => {
      if (n !== 2) throw new Error(`string-ref: 參數個數錯誤 (需要 2，得到 ${n})`);
      if (tagOf(A(0)) !== TAG.STR) throw new Error('string-ref: 需要字串，得到 ' + toStr(A(0), true));
      const cs = [...strOf(A(0))], k = toIdxV(A(1), 'string-ref');
      if (k < 0 || k >= cs.length) throw new Error(`string-ref: 索引超出範圍 (長度 ${cs.length}，得到 ${toStr(A(1), true)})`);
      return mkBig(BigInt(cs[k].codePointAt(0)));
    },
    'substring': n => {
      if (n !== 3) throw new Error(`substring: 參數個數錯誤 (需要 3，得到 ${n})`);
      if (tagOf(A(0)) !== TAG.STR) throw new Error('substring: 需要字串，得到 ' + toStr(A(0), true));
      const cs = [...strOf(A(0))], x = toIdxV(A(1), 'substring'), y = toIdxV(A(2), 'substring');
      if (x < 0 || y < 0 || x > y || y > cs.length) throw new Error(`substring: 範圍錯誤 (長度 ${cs.length}，得到 ${toStr(A(1), true)} ${toStr(A(2), true)})`);
      return mkStr(cs.slice(x, y).join(''));
    },
    'char->nat': n => {
      if (n !== 1) throw new Error(`char->nat: 參數個數錯誤 (需要 1，得到 ${n})`);
      const v = A(0);
      if (isBigV(v) || (v & 1) || (tagOf(v) === TAG.FLOAT && Number.isInteger(numVal(v)))) return v;
      throw new Error('char->nat: 需要 Char，得到 ' + toStr(v, true));
    },
    'nat->char': n => {
      if (n !== 1) throw new Error(`nat->char: 參數個數錯誤 (需要 1，得到 ${n})`);
      const v = toBig(A(0), 'nat->char');
      if (v < 0n || v > 0x10FFFFn || (v >= 0xD800n && v <= 0xDFFFn)) throw new Error('nat->char: 不是有效碼位，得到 ' + toStr(A(0), true));
      return mkBig(v);
    },
    'bit-and': n => {
      if (n !== 2) throw new Error(`bit-and: 參數個數錯誤 (需要 2，得到 ${n})`);
      return mkBig(toBig(A(0), 'bit-and') & toBig(A(1), 'bit-and'));
    },
    'bit-or': n => {
      if (n !== 2) throw new Error(`bit-or: 參數個數錯誤 (需要 2，得到 ${n})`);
      return mkBig(toBig(A(0), 'bit-or') | toBig(A(1), 'bit-or'));
    },
    'bit-xor': n => {
      if (n !== 2) throw new Error(`bit-xor: 參數個數錯誤 (需要 2，得到 ${n})`);
      return mkBig(toBig(A(0), 'bit-xor') ^ toBig(A(1), 'bit-xor'));
    },
    'symbol->string': n => {
      if (n !== 1) throw new Error(`symbol->string: 參數個數錯誤 (需要 1，得到 ${n})`);
      if (tagOf(A(0)) !== TAG.SYM) throw new Error('symbol->string: 需要 symbol，得到 ' + toStr(A(0), true));
      return mkStr(strOf(rd(A(0) + 4)));
    },
    'number->string': n => { req('number->string', n, 1); return mkStr(isBigV(A(0)) ? strOf(A(0)) : String(num(A(0), 'number->string'))); },
    'display': n => { req('display', n, 1); out(toStr(A(0), false)); return VOID; },
    'write': n => { req('write', n, 1); out(toStr(A(0), true)); return VOID; },
    'newline': () => { out('\n'); return VOID; },
    'error': n => { const a = []; for (let i = 0; i < n; i++) a.push(toStr(A(i), false)); throwLisp(mkStr(a.join(' '))); },
    'read-line': () => { const ls = readStdinLines(); return ls.length ? mkStr(ls.shift()) : NIL; },
    'get-args': () => listOf(progArgs.map(s => mkStr(s))),
    'exit': n => {
      const code = n === 0 ? 0 : Number(toBig(A(0), 'exit'));
      throw new ExitSignal(code);
    },
  };
  const prims = PRIM_NAMES.map(pn => impl[pn]);

  const failMsg = v => tagOf(v) === TAG.STR ? strOf(v) : '未攔截的例外: ' + toStr(v, true);
  const throwLisp = v => {
    if (exnTag) throw new WebAssembly.Exception(exnTag, [v]);
    throw new Error(failMsg(v));                    // 舊版 wasm 無 tag: 直接 abort
  };
  let inErr = false;                                // OOM 遞迴保護
  const hostErr = (kind, a, b) => {
    if (inErr) throw new Error('錯誤處理中再次出錯 (可能是記憶體不足)');
    inErr = true;
    let msg;
    switch (kind) {
      case E_UNBOUND: msg = '未定義的變數: ' + meta.names[a]; break;
      case E_SET_UNBOUND: msg = 'set!: 未定義的變數: ' + meta.names[a]; break;
      case E_ARITY: { const f = meta.funcs[a]; msg = `${f.name}: 參數個數錯誤 (需要 ${f.params}${f.rest ? '+' : ''}，得到 ${b})`; break; }
      case E_NOTFN: msg = a === VOID ? '不是可呼叫的物件 (前一個呼叫回傳了空值？)' : '不是可呼叫的物件: ' + toStr(a, true); break;
      case E_OOM: msg = '記憶體不足 (heap 沒有 GC)'; break;
      case E_HSTK: msg = '例外處理器堆疊錯誤 (太多 TRY 或 UNTRY 不平衡)'; break;
      case E_APPLY: msg = 'apply: 第二個參數必須是 proper list (且不超過 256 個)'; break;
      default: msg = 'runtime error ' + kind;
    }
    const v = mkStr(msg);
    inErr = false;
    throwLisp(v);
  };
  const primWrap = (id, argc) => {
    try { return prims[id](argc); }
    catch (e) {
      if (e instanceof WebAssembly.Exception) throw e;
      if (e instanceof ExitSignal) throw e;             // exit 直通，不轉 Lisp 例外
      throwLisp(mkStr(String((e && e.message) || e)));
    }
  };

  const inst = new WebAssembly.Instance(mod, { env: { prim: primWrap, err: hostErr } });
  ex = inst.exports;
  exnTag = ex.exntag || null;
  try { return ex.main(0, 0); }
  catch (e) {
    if (e instanceof WebAssembly.Exception && exnTag) throw new Error(failMsg(e.getArg(exnTag, 0)));
    if (e instanceof RangeError) throw new Error('遞迴太深 (call stack overflow)');
    throw e;
  } finally { flush(); }
}

/* 在 worker 內執行，以便給予很大的呼叫堆疊 (非尾遞迴的深度 = wasm 原生堆疊深度) */
function runInWorker(bytes, progArgs = []) {
  const w = new Worker(__filename, { workerData: { vm2wasmRun: true, bytes, progArgs }, resourceLimits: { stackSizeMb: 256 } });
  w.on('message', m => {
    if (!m) return;
    if (m.error !== undefined) { console.error('執行錯誤: ' + m.error); process.exitCode = 1; }
    else if (m.exit !== undefined) { process.exitCode = m.exit; }
  });
  w.on('error', e => { console.error('執行錯誤: ' + (e && e.message)); process.exitCode = 1; });
}

module.exports = { compile, run: runBytes };

/* ───────────── 進入點 ───────────── */
if (!isMainThread && workerData && workerData.vm2wasmRun) {
  try { runBytes(workerData.bytes, workerData.progArgs || []); parentPort.postMessage({ ok: true }); }
  catch (e) {
    if (e instanceof ExitSignal) parentPort.postMessage({ exit: e.code });
    else parentPort.postMessage({ error: e.message });
  }
} else if (require.main === module) {
  const args = process.argv.slice(2);
  let input = null, output = null, run = false, progArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') { progArgs = args.slice(i + 1); break; }
    else if (args[i] === '-o') output = args[++i];
    else if (args[i] === '--run') run = true;
    else input = args[i];
  }
  if (!input) {
    console.error('用法: node vm2wasm.js prog.fbc [-o prog.wasm] [--run] [-- 程式參數...]\n      node vm2wasm.js prog.wasm [-- 程式參數...]');
    process.exit(1);
  }
  try {
    if (input.endsWith('.wasm')) runInWorker(fs.readFileSync(input), progArgs);
    else {
      const bytes = compile(fs.readFileSync(input, 'utf8'));
      output = output || input.replace(/\.[^.]*$/, '') + '.wasm';
      fs.writeFileSync(output, bytes);
      console.error(`已編譯 ${input} -> ${output} (${bytes.length} bytes)`);
      if (run) runInWorker(bytes, progArgs);
    }
  } catch (e) { console.error('錯誤: ' + e.message); process.exit(1); }
}
