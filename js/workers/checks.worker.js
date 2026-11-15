import { runChecks } from '../core/checks.js';

self.onmessage = (event) => {
  const { id, modules } = event.data;
  try {
    self.postMessage({ id, done: true, result: runChecks(modules) });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
