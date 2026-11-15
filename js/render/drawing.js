import * as THREE from '../../vendor/three/three.module.min.js';
import { CELL_MM, STORY_MM } from '../config.js';
import { variantKey } from '../core/grid.js';
import { centerMarks, loadPaths, connectorMarks, edgeLines } from '../core/drafting.js';
import { COPY } from '../ui/copy.js';
import { sharedUniforms } from './materials.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LABEL_RING_PX = 7; // critical joint ring radius
const LABEL_LEAD_PX = [26, -22]; // leader line offset
const LABEL_GAP_PX = 4; // text gap after the leader
const STATUS_VARS = { line: '--blue', pass: '--pass', warn: '--warn', fail: '--fail' };

function cssColor(name) {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

export function createDrawing(view, rig, moduleView, overlay, titleBlock) {
  const colors = {};
  for (const [status, name] of Object.entries(STATUS_VARS)) colors[status] = cssColor(name);
  const group = new THREE.Group();
  group.visible = false;
  view.scene.add(group);
  const layers = {};
  const shown = { edges: true, centers: true, loads: true, connectors: true };
  const point = new THREE.Vector3();
  let active = false;
  let stale = true;
  let current = { structure: null, checks: null };

  function setLayerLines(name, positions, statuses, onTop) {
    if (layers[name]) {
      group.remove(layers[name]);
      layers[name].geometry.dispose();
      layers[name].material.dispose();
    }
    const tint = new Float32Array(positions.length);
    for (let index = 0; index < positions.length / 6; index++) {
      const color = colors[statuses ? statuses[index] : 'line'];
      tint.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(tint, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: !onTop }));
    lines.frustumCulled = false;
    lines.renderOrder = onTop ? 5 : 1;
    lines.visible = shown[name];
    layers[name] = lines;
    group.add(lines);
  }

  function placeLabel() {
    overlay.replaceChildren();
    const critical = current.checks && current.checks.critical;
    if (!active || !critical || !shown.loads) return;
    point.set(critical.at[0], critical.at[1], critical.at[2]).project(rig.camera);
    const screenX = ((point.x + 1) / 2) * overlay.clientWidth;
    const screenY = ((1 - point.y) / 2) * overlay.clientHeight;
    const tone = `var(${STATUS_VARS[critical.status]})`;
    const make = (tag, attributes) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      node.style.stroke = tone;
      overlay.append(node);
      return node;
    };
    make('circle', { cx: screenX, cy: screenY, r: LABEL_RING_PX, fill: 'none' });
    make('line', { x1: screenX + LABEL_RING_PX * 0.7, y1: screenY - LABEL_RING_PX * 0.7, x2: screenX + LABEL_LEAD_PX[0], y2: screenY + LABEL_LEAD_PX[1] });
    const text = make('text', { x: screenX + LABEL_LEAD_PX[0] + LABEL_GAP_PX, y: screenY + LABEL_LEAD_PX[1] });
    text.style.stroke = 'none';
    text.style.fill = tone;
    text.textContent = `${COPY.critical} ${critical.margin.toFixed(1)} mm`;
  }

  function fillTitle() {
    const { structure, checks } = current;
    titleBlock.replaceChildren();
    if (!structure) return;
    const height = Math.max(0, ...structure.modules.map((instance) => instance.z + instance.h)) * STORY_MM;
    const cell = (text, className) => {
      const span = document.createElement('span');
      span.textContent = text;
      if (className) span.className = className;
      titleBlock.append(span);
    };
    cell(COPY.wordmark, 'title-name');
    cell(COPY.titleBlockSeed);
    cell(structure.seed);
    cell(COPY.modules);
    cell(String(structure.modules.length));
    cell(COPY.heightLabel);
    cell(`${height} mm`);
    cell(COPY.stability);
    cell(checks ? COPY[checks.stability] : COPY.checking);
    cell(COPY.titleBlockGrid);
    cell(`${CELL_MM} mm`);
  }

  function rebuild() {
    stale = false;
    const { structure, checks } = current;
    if (!structure) return;
    const edgesOf = (instance) => {
      const part = moduleView.partOf(variantKey(instance));
      return part ? part.edges : null;
    };
    setLayerLines('edges', edgeLines(structure.modules, edgesOf), null, false);
    const connectors = connectorMarks(structure.modules);
    setLayerLines('connectors', connectors.positions, connectors.statuses, false);
    const centers = checks ? centerMarks(checks) : { positions: [], statuses: [] };
    const loads = checks ? loadPaths(checks) : { positions: [], statuses: [] };
    setLayerLines('centers', centers.positions, centers.statuses, true);
    setLayerLines('loads', loads.positions, loads.statuses, true);
    fillTitle();
    placeLabel();
    view.requestRender();
  }

  rig.onChange(placeLabel);
  view.onResize(placeLabel);

  return {
    update(structure, checks) {
      current = { structure, checks };
      stale = true;
      if (active) rebuild();
    },
    setActive(on) {
      active = on;
      sharedUniforms.uDrawing.value = on ? 1 : 0;
      sharedUniforms.uGrid.value = on ? 1 : 0;
      group.visible = on;
      if (on && stale) rebuild();
      placeLabel();
      view.requestRender();
    },
    setLayer(name, on) {
      shown[name] = on;
      if (layers[name]) layers[name].visible = on;
      placeLabel();
      view.requestRender();
    },
  };
}
