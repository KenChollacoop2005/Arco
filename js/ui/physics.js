import { createPoseStage } from '../core/physics.js';
import { createWorkerClient } from '../workers/client.js';
import { COPY } from './copy.js';
import { showToast } from './toast.js';

// Physics toggle: the worker loads on first use
export function setupPhysics(app, moduleView, toggle) {
  const stage = createPoseStage(moduleView);
  let client = null;

  function halt() {
    if (client) client.call({ kind: 'stop' }).catch(() => {});
    stage.stop();
  }

  async function run() {
    if (!toggle.checked || !app.structure || app.structure.modules.length === 0) return;
    if (!client) {
      showToast(COPY.physicsLoading);
      client = createWorkerClient(new URL('../workers/physics.worker.js', import.meta.url));
    }
    const modules = app.structure.modules;
    const feed = stage.start(modules.map((instance) => instance.id));
    try {
      const result = await client.call({ kind: 'run', modules }, (frame) => feed(frame.poses, frame.settled));
      if (result && toggle.checked) showToast(result.fallen ? `${COPY.physicsFell} ${result.fallen} ${COPY.assemblyOf} ${result.total}` : COPY.physicsStands);
    } catch {
      client = null;
      toggle.checked = false;
      stage.stop();
      showToast(COPY.loadFailed);
    }
  }

  toggle.addEventListener('change', () => (toggle.checked ? run() : halt()));
  app.structureListeners.push((result, phase) => {
    if (!toggle.checked) return;
    if (phase === 'ready') run();
    else halt();
  });
  if (toggle.checked) run();
}
