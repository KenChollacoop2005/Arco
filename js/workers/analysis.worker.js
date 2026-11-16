import { analyze } from '../core/analysis.js';

self.onmessage = (event) => {
  const { id, modules } = event.data;
  try {
    self.postMessage({ id, done: true, result: analyze(modules) });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
