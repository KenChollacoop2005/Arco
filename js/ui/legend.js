const STORAGE_KEY = 'arco.legend'; // remembered open state
const NARROW_PX = 760; // phone layout width

export function readSetting(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function setupLegend(legend) {
  const narrow = window.innerWidth <= NARROW_PX;
  legend.open = readSetting(STORAGE_KEY, narrow ? 'closed' : 'open') === 'open';
  legend.querySelector('summary').addEventListener('click', () => {
    writeSetting(STORAGE_KEY, legend.open ? 'closed' : 'open');
  });
}
