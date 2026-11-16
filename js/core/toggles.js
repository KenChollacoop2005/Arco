import { LIGHT_CORES_MAX, LIGHT_MEMORY_GB_MAX } from '../config.js';

const KEY_PREFIX = 'arco.toggle.'; // stored setting name
const STORED_ON = 'on'; // stored value when switched on
const STORED_OFF = 'off'; // stored value when switched off

// Weak devices start on the lighter preset
export function isLightDevice({ cores, memoryGb } = {}) {
  return (cores !== undefined && cores <= LIGHT_CORES_MAX) || (memoryGb !== undefined && memoryGb <= LIGHT_MEMORY_GB_MAX);
}

// Layers register here: id, on, lightOn, remember, apply
export function createToggles({ read = (key, fallback) => fallback, write = () => true, light = false } = {}) {
  const entries = new Map();

  function entryOf(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error('unknown toggle: ' + id);
    return entry;
  }

  function register({ id, on = false, lightOn = on, remember = true, apply = () => {} }) {
    if (entries.has(id)) throw new Error('toggle exists: ' + id);
    const stored = remember ? read(KEY_PREFIX + id, null) : null;
    const preset = light ? lightOn : on;
    const entry = { id, on: stored === STORED_ON || (stored !== STORED_OFF && preset), remember, listeners: [apply] };
    entries.set(id, entry);
    apply(entry.on);
    return entry.on;
  }

  function set(id, on) {
    const entry = entryOf(id);
    const next = !!on;
    if (entry.on === next) return next;
    entry.on = next;
    if (entry.remember) write(KEY_PREFIX + id, next ? STORED_ON : STORED_OFF);
    for (const listener of entry.listeners) listener(next);
    return next;
  }

  return {
    light,
    register,
    set,
    get: (id) => entryOf(id).on,
    has: (id) => entries.has(id),
    watch: (id, listener) => entryOf(id).listeners.push(listener),
    list: () => [...entries.values()].map((entry) => ({ id: entry.id, on: entry.on })),
  };
}
