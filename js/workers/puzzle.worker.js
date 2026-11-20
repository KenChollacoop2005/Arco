import { loadDaily, infinitePuzzle } from '../core/daily.js';

// Daily files sit two folders up from this worker
const readText = async (path) => {
  const response = await fetch(new URL('../../' + path, self.location.href));
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.text();
};

self.onmessage = async (event) => {
  const { id, kind, seed } = event.data;
  try {
    const result = kind === 'infinite' ? infinitePuzzle(seed) : await loadDaily(readText);
    self.postMessage({ id, done: true, result });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message ? error.message : error) });
  }
};
