// Facade: check .lean sources, track axioms/sorry, run #commands.
// Pure JS; usable from Node.js and directly in the browser.

import { Env, pretty, infer, whnf, check, freeVars, KernelError } from './kernel.mjs';
import { buildPrelude } from './prelude.mjs';
import { parseFile, showExpr, ParseError } from './parser.mjs';
import { elab, elabType, ElabError } from './elab.mjs';
import { runBlock, TacticError } from './tactics.mjs';

export { pretty };

export function freshEnv() {
  return buildPrelude();
}

// Collect Const names occurring in a proof term.
function collectConsts(tm, out = new Set()) {
  if (!tm) return out;
  if (tm.t === 'Const') { out.add(tm.name); return out; }
  if (tm.t === 'App') { collectConsts(tm.fn, out); collectConsts(tm.arg, out); }
  else if (tm.t === 'Lam') { if (tm.ty) collectConsts(tm.ty, out); collectConsts(tm.body, out); }
  else if (tm.t === 'Pi') { collectConsts(tm.dom, out); collectConsts(tm.body, out); }
  else if (tm.t === 'Let') { collectConsts(tm.ty, out); collectConsts(tm.val, out); collectConsts(tm.body, out); }
  else if (tm.t === 'Ann') { collectConsts(tm.e, out); collectConsts(tm.ty, out); }
  return out;
}

function elabBinders(env, ctx, binders, line) {
  // returns list of {name, type(kernel)}
  const out = [];
  for (const g of binders) {
    let ty;
    try {
      ty = elabType(env, ctx, g.ty);
    } catch (err) {
      throw new ElabError(`binder '${g.name}': ${err.message}`, line);
    }
    if (ctx.has(g.name)) throw new ElabError(`duplicate binder name '${g.name}'`, line);
    ctx.set(g.name, { type: ty });
    out.push({ name: g.name, type: ty });
  }
  return out;
}

export function checkSource(src, opts = {}) {
  const filename = opts.filename ?? '<input>';
  const env = opts.env ?? freshEnv();
  const warnings = [];
  const messages = [];
  const declResults = [];
  const tacOpts = { warnings };
  const sorryUsed = () => warnings.some((w) => w.includes("'sorry'"));

  let file;
  try {
    file = parseFile(src);
  } catch (err) {
    return { ok: false, env, warnings, messages, declResults, errors: [fmtErr(filename, err)], hasSorry: false };
  }

  // #commands run in the final env; process decls first, then commands.
  for (const d of file.decls) {
    const t0 = Date.now();
    try {
      checkDecl(env, d, tacOpts);
      const ent = d.name ? env.map.get(d.name) : null;
      declResults.push({
        name: d.name ?? '(anonymous)',
        kw: d.kw,
        line: d.line,
        ok: true,
        ms: Date.now() - t0,
        axioms: axiomsOf(env, d.name),
        proof: ent?.proof ? pretty(ent.proof) : null,
        trace: ent?.trace ?? null,
      });
    } catch (err) {
      declResults.push({ name: d.name ?? '(anonymous)', kw: d.kw, line: d.line, ok: false, ms: Date.now() - t0 });
      return { ok: false, env, warnings, messages, declResults, errors: [fmtDeclErr(filename, d, err)], hasSorry: sorryUsed() };
    }
  }
  for (const c of file.commands) {
    try {
      messages.push(runCommand(env, c));
    } catch (err) {
      return { ok: false, env, warnings, messages, declResults, errors: [fmtErr(filename, err)], hasSorry: sorryUsed() };
    }
  }
  return { ok: true, env, warnings, messages, declResults, errors: [], hasSorry: sorryUsed() };
}

function axiomsOf(env, name) {
  const e = name && env.map.get(name);
  if (!e || !e.proof) return [];
  const uses = [...collectConsts(e.proof)];
  return uses.filter((n) => {
    const c = env.map.get(n);
    return c && (c.kind === 'axiom' || c.kind === 'sorryAx');
  });
}

function checkDecl(env, d, tacOpts) {
  const ctx = new Map();
  const binderList = elabBinders(env, ctx, d.binders ?? [], d.line);
  let type = null;
  if (d.typeExpr) {
    try {
      type = elabType(env, ctx, d.typeExpr);
    } catch (err) {
      throw new ElabError(`bad type ascription (${err.message})`, d.line);
    }
  }
  const fullType = (body) => {
    let t = body;
    for (let i = binderList.length - 1; i >= 0; i--) {
      const { name, type: ty } = binderList[i];
      t = { t: 'Pi', name, dom: ty, body: t };
    }
    return t;
  };

  if (d.kw === 'axiom') {
    if (!type) throw new ElabError('axiom needs a type ascription', d.line);
    env.add(d.name, fullType(type), undefined, 'axiom');
    return;
  }

  if (d.valueIsBy) {
    if (!type) throw new ElabError('`by` proofs need a type ascription', d.line);
    const hyps = binderList.map((b) => ({ ...b }));
    let res;
    try {
      res = runBlock(env, hyps, type, d.tactics, tacOpts);
    } catch (err) {
      if (err instanceof TacticError && err.line) throw err;
      throw new TacticError(`${err.message}`, d.line);
    }
    // wrap proof in lambdas for binders
    let proof = res.proof;
    for (let i = binderList.length - 1; i >= 0; i--) {
      proof = { t: 'Lam', name: binderList[i].name, ty: binderList[i].type, body: proof };
    }
    const FT = fullType(type);
    try {
      check(new Map(), env, proof, FT);
    } catch (err) {
      throw new ElabError(`kernel rejected proof (${err.message})`, d.line);
    }
    env.map.set(d.name, { type: FT, value: d.kw === 'def' || d.kw === 'abbrev' ? proof : undefined, kind: d.kw, proof, trace: res.trace });
    return;
  }

  // term mode
  let tm;
  try {
    tm = elab(env, ctx, d.valueExpr, type ?? null);
  } catch (err) {
    throw new ElabError(`cannot elaborate proof (${err.message})`, d.line);
  }
  // sorry as whole proof: `sorryAx T` (checked: T must be a Type/Prop)
  if (tm.t === 'Hole' && String(tm.name).startsWith('sorry')) {
    const T = type ?? { t: 'Prop' };
    tacOpts.warnings.push(`line ${d.line}: 'sorry' used`);
    const FT = fullType(T);
    let proof = { t: 'App', fn: { t: 'Const', name: 'sorryAx' }, arg: T };
    for (let i = binderList.length - 1; i >= 0; i--) {
      proof = { t: 'Lam', name: binderList[i].name, ty: binderList[i].type, body: proof };
    }
    try {
      check(new Map(), env, proof, FT);
    } catch (err) {
      throw new ElabError(`kernel rejected proof (${err.message})`, d.line);
    }
    env.map.set(d.name, { type: FT, value: undefined, kind: d.kw, proof });
    return;
  }
  let inferred;
  try {
    inferred = infer(ctx, env, tm);
  } catch (err) {
    throw new ElabError(`cannot infer proof type (${err.message})`, d.line);
  }
  if (type) {
    try {
      check(ctx, env, tm, type);
    } catch (err) {
      throw new ElabError(`${err.message}`, d.line);
    }
  } else {
    type = inferred;
  }
  let proof = tm;
  for (let i = binderList.length - 1; i >= 0; i--) {
    proof = { t: 'Lam', name: binderList[i].name, ty: binderList[i].type, body: proof };
  }
  const FT = fullType(type);
  try {
    check(new Map(), env, proof, FT);
  } catch (err) {
    throw new ElabError(`kernel rejected proof (${err.message})`, d.line);
  }
  env.map.set(d.name, { type: FT, value: d.kw === 'def' || d.kw === 'abbrev' ? proof : undefined, kind: d.kw, proof });
}

function runCommand(env, c) {
  const ctx = new Map();
  if (c.cmd === 'check') {
    const tm = elab(env, ctx, c.e);
    const t = infer(ctx, env, tm);
    return { cmd: '#check', line: c.line, text: `${showExpr(c.e)} : ${pretty(t)}` };
  }
  if (c.cmd === 'eval') {
    const tm = elab(env, ctx, c.e);
    const v = whnf(ctx, env, tm);
    return { cmd: '#eval', line: c.line, text: `${showExpr(c.e)} ⇒ ${pretty(v)}` };
  }
  if (c.cmd === 'print') {
    const tm = elab(env, ctx, c.e);
    return { cmd: '#print', line: c.line, text: pretty(tm) };
  }
  throw new ElabError(`unknown command #${c.cmd}`, c.line);
}

function fmtErr(filename, err) {
  return `${filename}:${err.line ?? '?'}: ${err.name}: ${err.message}`;
}
function fmtDeclErr(filename, d, err) {
  const at = err.line ?? d.line;
  return `${filename}:${at}: [${d.kw} ${d.name ?? ''}] ${err.name}: ${err.message}`;
}

export async function checkFile(path, opts = {}) {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(path, 'utf8');
  return checkSource(src, { ...opts, filename: path });
}
