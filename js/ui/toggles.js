import { createToggles, isLightDevice } from '../core/toggles.js';
import { readSetting, writeSetting } from './legend.js';

// Registry backed by the visitor's stored settings
export function setupToggles() {
  const light = isLightDevice({ cores: navigator.hardwareConcurrency, memoryGb: navigator.deviceMemory });
  return createToggles({ read: readSetting, write: writeSetting, light });
}

// Ties a checkbox to a registered toggle
export function bindToggle(toggles, input, spec) {
  const apply = spec.apply || (() => {});
  toggles.register({
    ...spec,
    apply(on) {
      input.checked = on;
      apply(on);
    },
  });
  input.addEventListener('change', () => toggles.set(spec.id, input.checked));
}
