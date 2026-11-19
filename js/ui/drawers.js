import { readSetting, writeSetting } from './legend.js';

const OPEN = 'open'; // stored value for an open drawer
const CLOSED = 'closed'; // stored value for a closed drawer

// One drawer: starts as stored, else its default, and remembers changes
export function bindDrawer(drawer, key, fallback = CLOSED) {
  drawer.open = readSetting(key, fallback) === OPEN;
  drawer.addEventListener('toggle', () => writeSetting(key, drawer.open ? OPEN : CLOSED));
}

// Every details element with data-drawer-key under root
export function setupDrawers(root = document) {
  for (const drawer of root.querySelectorAll('details[data-drawer-key]')) {
    bindDrawer(drawer, drawer.dataset.drawerKey, drawer.dataset.drawerDefault === OPEN ? OPEN : CLOSED);
  }
}
