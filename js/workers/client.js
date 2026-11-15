// Promise wrapper around a module worker
export function createWorkerClient(url) {
  const worker = new Worker(url, { type: 'module' });
  const pending = new Map();
  let nextId = 1;
  worker.onmessage = (event) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.error) {
      pending.delete(message.id);
      entry.reject(new Error(message.error));
    } else if (message.done) {
      pending.delete(message.id);
      entry.resolve(message.result);
    } else {
      entry.onPart(message);
    }
  };
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || 'worker failed'));
    pending.clear();
  };
  return {
    call(payload, onPart = () => {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onPart });
        worker.postMessage({ id, ...payload });
      });
    },
  };
}
