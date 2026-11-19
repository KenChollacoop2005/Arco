import { COPY } from './copy.js';

const POPOVER_GAP_PX = 6; // space between the anchor and the popover
const EDGE_PX = 8; // keep the popover this far inside the window

let open = null;

// Closes the open popover, if any, as a cancel
export function closeConfirm() {
  if (open) open(false);
}

// Small confirm popover anchored on a button; resolves true on confirm
export function confirmAt(anchor, text, confirmLabel = COPY.confirmDelete) {
  closeConfirm();
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'popover';
    box.setAttribute('role', 'alertdialog');
    const message = document.createElement('p');
    message.textContent = text;
    const yes = document.createElement('button');
    yes.className = 'primary danger';
    yes.textContent = confirmLabel;
    const no = document.createElement('button');
    no.className = 'plain';
    no.textContent = COPY.cancel;
    const row = document.createElement('div');
    row.className = 'button-row';
    row.append(yes, no);
    box.append(message, row);
    document.body.append(box);
    const rect = anchor.getBoundingClientRect();
    const width = box.offsetWidth;
    box.style.left = `${Math.max(EDGE_PX, Math.min(window.innerWidth - width - EDGE_PX, rect.right - width))}px`;
    box.style.top = `${rect.bottom + POPOVER_GAP_PX}px`;
    const finish = (answer) => {
      open = null;
      box.remove();
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape, true);
      resolve(answer);
    };
    const away = (event) => {
      if (!box.contains(event.target)) finish(false);
    };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      finish(false);
    };
    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape, true);
    open = finish;
    no.focus();
  });
}
