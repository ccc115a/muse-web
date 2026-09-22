// VSCode 式選單列：點標題開、hover 切換、Esc／外點關、選後自動關
export function initMenu() {
  const bar = document.getElementById('menubar');
  if (!bar) return;
  const menus = [...bar.querySelectorAll('.menu')];
  const drops = new Map(menus.map((m) => [m, m.querySelector('.menu-drop')]));

  function closeAll() {
    for (const d of drops.values()) d.hidden = true;
    for (const m of menus) m.querySelector('.menu-title').classList.remove('open');
  }
  function isOpen() {
    return menus.some((m) => !drops.get(m).hidden);
  }
  function open(m) {
    closeAll();
    drops.get(m).hidden = false;
    m.querySelector('.menu-title').classList.add('open');
  }

  for (const m of menus) {
    const title = m.querySelector('.menu-title');
    title.addEventListener('click', () => {
      drops.get(m).hidden ? open(m) : closeAll();
    });
    m.addEventListener('mouseenter', () => {
      if (isOpen() && drops.get(m).hidden) open(m);
    });
    // 選了項目就關（main.js 的動作照跑）
    drops.get(m).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.disabled) closeAll();
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#menubar')) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) closeAll();
  });
}
