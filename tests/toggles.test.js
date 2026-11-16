import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_CORES_MAX, LIGHT_MEMORY_GB_MAX } from '../js/config.js';
import { createToggles, isLightDevice } from '../js/core/toggles.js';

// Stands in for the stored settings
function fakeStore(start = {}) {
  const values = { ...start };
  return {
    values,
    read: (key, fallback) => (key in values ? values[key] : fallback),
    write: (key, value) => {
      values[key] = value;
      return true;
    },
  };
}

test('a toggle starts on its default and applies it once', () => {
  const toggles = createToggles();
  const seen = [];
  assert.equal(toggles.register({ id: 'effects', on: true, apply: (on) => seen.push(on) }), true);
  assert.equal(toggles.register({ id: 'wear' }), false);
  assert.deepEqual(seen, [true]);
  assert.deepEqual(toggles.list(), [{ id: 'effects', on: true }, { id: 'wear', on: false }]);
  assert.ok(toggles.has('wear') && !toggles.has('decor'));
});

test('the light preset is used on weak devices', () => {
  const toggles = createToggles({ light: true });
  assert.equal(toggles.register({ id: 'effects', on: true, lightOn: false }), false);
  assert.equal(toggles.register({ id: 'plain', on: true }), true);
  assert.equal(toggles.light, true);
});

test('a stored choice beats both presets', () => {
  const store = fakeStore({ 'arco.toggle.effects': 'on', 'arco.toggle.decor': 'off' });
  const toggles = createToggles({ ...store, light: true });
  assert.equal(toggles.register({ id: 'effects', on: true, lightOn: false }), true);
  assert.equal(toggles.register({ id: 'decor', on: true, lightOn: true }), false);
});

test('set stores the choice and tells every listener once', () => {
  const store = fakeStore();
  const toggles = createToggles(store);
  const seen = [];
  toggles.register({ id: 'decor', apply: (on) => seen.push(['apply', on]) });
  toggles.watch('decor', (on) => seen.push(['watch', on]));
  assert.equal(toggles.set('decor', true), true);
  assert.equal(toggles.set('decor', true), true);
  assert.equal(toggles.get('decor'), true);
  assert.deepEqual(seen, [['apply', false], ['apply', true], ['watch', true]]);
  assert.deepEqual(store.values, { 'arco.toggle.decor': 'on' });
  toggles.set('decor', false);
  assert.deepEqual(store.values, { 'arco.toggle.decor': 'off' });
});

test('a toggle that is not remembered never touches storage', () => {
  const store = fakeStore({ 'arco.toggle.physics': 'on' });
  const toggles = createToggles(store);
  assert.equal(toggles.register({ id: 'physics', remember: false }), false);
  toggles.set('physics', true);
  assert.deepEqual(store.values, { 'arco.toggle.physics': 'on' });
});

test('blocked storage leaves the toggle working', () => {
  const toggles = createToggles({ read: (key, fallback) => fallback, write: () => false });
  toggles.register({ id: 'effects', on: true });
  assert.equal(toggles.set('effects', false), false);
  assert.equal(toggles.get('effects'), false);
});

test('duplicate and unknown ids are refused', () => {
  const toggles = createToggles();
  toggles.register({ id: 'effects' });
  assert.throws(() => toggles.register({ id: 'effects' }), /exists/);
  assert.throws(() => toggles.set('missing', true), /unknown/);
  assert.throws(() => toggles.get('missing'), /unknown/);
});

test('few cores or little memory count as a weak device', () => {
  assert.equal(isLightDevice({ cores: LIGHT_CORES_MAX, memoryGb: 16 }), true);
  assert.equal(isLightDevice({ cores: 16, memoryGb: LIGHT_MEMORY_GB_MAX }), true);
  assert.equal(isLightDevice({ cores: LIGHT_CORES_MAX + 1, memoryGb: LIGHT_MEMORY_GB_MAX * 2 }), false);
  assert.equal(isLightDevice({ cores: 16 }), false);
  assert.equal(isLightDevice({}), false);
});
