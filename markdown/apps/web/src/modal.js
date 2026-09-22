// 自繪對話框（取代 prompt/confirm）：input 輸入、選項、純訊息、富 HTML 四種
// inputModal(title, { label, value, okText }) → Promise<string|null>
// confirmModal(message, okText?) → Promise<boolean>
// choiceModal(title, options: string[]) → Promise<string|null>
// infoModal(title, html) → Promise<void>（富 HTML，可含連結與表格）

function overlay() {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  document.body.appendChild(ov);
  return ov;
}

function shell(ov, title) {
  const box = document.createElement('div');
  box.className = 'modal';
  const h = document.createElement('h3');
  h.textContent = title;
  box.appendChild(h);
  ov.appendChild(box);
  return box;
}

function buttons(box, names) {
  const row = document.createElement('div');
  row.className = 'modal-btns';
  const btns = {};
  for (const n of names) {
    const b = document.createElement('button');
    b.textContent = n;
    row.appendChild(b);
    btns[n] = b;
  }
  box.appendChild(row);
  return btns;
}

export function inputModal(title, { label = '', value = '', okText = '確定', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const ov = overlay();
    const box = shell(ov, title);
    if (label) {
      const lb = document.createElement('div');
      lb.className = 'modal-label';
      lb.textContent = label;
      box.appendChild(lb);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    box.appendChild(input);
    const btns = buttons(box, [okText, '取消']);
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    btns[okText].classList.add('primary');
    btns[okText].onclick = () => done(input.value);
    btns['取消'].onclick = () => done(null);
    ov.addEventListener('mousedown', (e) => {
      if (e.target === ov) done(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
      e.stopPropagation();
    });
    input.focus();
    input.select();
  });
}

export function confirmModal(message, okText = '確定刪除') {
  return new Promise((resolve) => {
    const ov = overlay();
    const box = shell(ov, '請確認');
    const p = document.createElement('p');
    p.textContent = message;
    box.appendChild(p);
    const btns = buttons(box, [okText, '取消']);
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    btns[okText].classList.add('primary');
    btns[okText].onclick = () => done(true);
    btns['取消'].onclick = () => done(false);
    ov.addEventListener('mousedown', (e) => {
      if (e.target === ov) done(false);
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', esc);
        done(false);
      }
    });
  });
}

export function choiceModal(title, options) {
  return new Promise((resolve) => {
    const ov = overlay();
    const box = shell(ov, title);
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    for (const o of options) {
      const b = document.createElement('button');
      b.className = 'modal-choice';
      b.textContent = o;
      b.onclick = () => done(o);
      box.appendChild(b);
    }
    const btns = buttons(box, ['取消']);
    btns['取消'].onclick = () => done(null);
    ov.addEventListener('mousedown', (e) => {
      if (e.target === ov) done(null);
    });
  });
}

/** 表單對話框：fields [{ key, label, type: 'text'|'select'|'checkbox', value, options?, checked? }]
 *  → Promise<values|null> */
export function formModal(title, fields, okText = '確定') {
  return new Promise((resolve) => {
    const ov = overlay();
    const box = shell(ov, title);
    const widgets = {};
    for (const f of fields) {
      if (f.label) {
        const lb = document.createElement('div');
        lb.className = 'modal-label';
        lb.textContent = f.label;
        box.appendChild(lb);
      }
      let w;
      if (f.type === 'select') {
        w = document.createElement('select');
        for (const o of f.options ?? []) {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          w.appendChild(op);
        }
        w.value = f.value ?? '';
      } else if (f.type === 'checkbox') {
        const wrap = document.createElement('label');
        wrap.className = 'modal-check';
        w = document.createElement('input');
        w.type = 'checkbox';
        w.checked = !!f.checked;
        wrap.append(w, document.createTextNode(' ' + (f.text ?? '')));
        box.appendChild(wrap);
        widgets[f.key] = w;
        continue;
      } else {
        w = document.createElement('input');
        w.type = 'text';
        w.value = f.value ?? '';
        w.placeholder = f.placeholder ?? '';
      }
      box.appendChild(w);
      widgets[f.key] = w;
    }
    const btns = buttons(box, [okText, '取消']);
    const done = (v) => {
      ov.remove();
      resolve(v);
    };
    btns[okText].classList.add('primary');
    btns[okText].onclick = () => {
      const out = {};
      for (const f of fields) {
        const w = widgets[f.key];
        out[f.key] = f.type === 'checkbox' ? w.checked : w.value;
      }
      done(out);
    };
    btns['取消'].onclick = () => done(null);
    ov.addEventListener('mousedown', (e) => {
      if (e.target === ov) done(null);
    });
  });
}

export function infoModal(title, html) {
  return new Promise((resolve) => {
    const ov = overlay();
    const box = shell(ov, title);
    box.classList.add('wide');
    const div = document.createElement('div');
    div.className = 'modal-info';
    div.innerHTML = html;
    box.appendChild(div);
    const btns = buttons(box, ['關閉']);
    btns['關閉'].onclick = () => {
      ov.remove();
      resolve();
    };
    ov.addEventListener('mousedown', (e) => {
      if (e.target === ov) {
        ov.remove();
        resolve();
      }
    });
  });
}
