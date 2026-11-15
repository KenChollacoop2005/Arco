import { generate } from '../core/generator.js';

self.onmessage = (event) => {
  const { id, options } = event.data;
  try {
    self.postMessage({ id, done: true, result: generate(options) });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
