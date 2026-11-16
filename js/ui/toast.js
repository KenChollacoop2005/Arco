const TOAST_MS = 4200; // time a message stays up

let hideTimer = 0;

export function showToast(text) {
  const toast = document.querySelector('#toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toast.hidden = true;
  }, TOAST_MS);
}
