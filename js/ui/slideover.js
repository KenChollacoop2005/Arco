const OPEN_CLASSES = { left: 'left-open', right: 'right-open' }; // body class per open panel

// Edge tabs open the side columns as slide-over panels on narrow screens
export function setupSlideovers(app) {
  const tabs = { left: document.querySelector('#leftTab'), right: document.querySelector('#rightTab') };
  function set(side) {
    for (const [name, tab] of Object.entries(tabs)) {
      const open = name === side;
      document.body.classList.toggle(OPEN_CLASSES[name], open);
      tab.setAttribute('aria-expanded', String(open));
    }
  }
  for (const [side, tab] of Object.entries(tabs)) {
    tab.addEventListener('click', () => set(document.body.classList.contains(OPEN_CLASSES[side]) ? null : side));
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (document.body.classList.contains(OPEN_CLASSES.left) || document.body.classList.contains(OPEN_CLASSES.right))) set(null);
  });
  app.modeListeners.push(() => set(null));
  return { close: () => set(null), open: set };
}
