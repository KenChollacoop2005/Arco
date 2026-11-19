import { box, cyl, pyramid } from './kit.js';

const SINK_MM = 0.25; // parts sunk into what holds them
const PAD_MM = 4; // concrete pad under a light
const POST_HALF_MM = [1.9, 1.3]; // lamp post half width, base and top
const LAMP_HEAD_MM = [1.7, 1.1, 3.2]; // lamp head radius low, high, height
const LAMP_DOUBLE_CHANCE = 0.35; // chance a lamp post has a second, lower head
const LAMP_LOW_HEAD_MM = 7; // second head drop below the top
const MAST_HALF_MM = [3, 1.7]; // floodlight mast half width, base and top
const FLOOD_HEAD_MM = [4.2, 1.3, 2.6, 4.5]; // floodlight head half length, half depth, height, drop below the top
const BEACON_MM = [1.15, 0.7, 1.8]; // beacon radius low, high, height
const ROUND_SIDES = 8; // facets on posts and heads

// Lamp post: pad, tapered steel post, glowing head
function lamppost(kit) {
  const centerX = kit.W / 2;
  const centerY = kit.D / 2;
  const top = kit.H - LAMP_HEAD_MM[2];
  kit.slab('concrete', kit.clear, 0, PAD_MM);
  kit.add('steel', pyramid(centerX, centerY, PAD_MM - SINK_MM, top + SINK_MM, POST_HALF_MM[0], POST_HALF_MM[1]));
  kit.add('lamp', cyl(centerX, centerY, top, kit.H, LAMP_HEAD_MM[0], LAMP_HEAD_MM[1], ROUND_SIDES));
  kit.anchors.lamps.push([centerX, centerY, kit.H - LAMP_HEAD_MM[2] / 2]);
  if (!kit.rng.chance(LAMP_DOUBLE_CHANCE)) return;
  const low = top - LAMP_LOW_HEAD_MM;
  kit.add('lamp', cyl(centerX, centerY, low, low + LAMP_HEAD_MM[2] * 0.6, LAMP_HEAD_MM[0] * 1.15, LAMP_HEAD_MM[0] * 1.15, ROUND_SIDES));
}

// Floodlight: pad, steel mast, a bar of lamp heads on top
function floodlight(kit) {
  const centerX = kit.W / 2;
  const centerY = kit.D / 2;
  const [half, depth, tall, drop] = FLOOD_HEAD_MM;
  const top = kit.H - drop;
  kit.slab('concrete', kit.clear, 0, PAD_MM);
  kit.add('steel', pyramid(centerX, centerY, PAD_MM - SINK_MM, kit.H - SINK_MM, MAST_HALF_MM[0], MAST_HALF_MM[1]));
  const alongX = kit.rng.chance(0.5);
  const head = alongX
    ? box(centerX - half, centerY - MAST_HALF_MM[1] - depth, top, centerX + half, centerY - MAST_HALF_MM[1] + SINK_MM, top + tall)
    : box(centerX - MAST_HALF_MM[1] - depth, centerY - half, top, centerX - MAST_HALF_MM[1] + SINK_MM, centerY + half, top + tall);
  kit.add('lamp', head);
  for (const end of [-1, 1]) {
    kit.anchors.lamps.push(alongX ? [centerX + end * half * 0.6, centerY - MAST_HALF_MM[1] - depth, top + tall / 2] : [centerX - MAST_HALF_MM[1] - depth, centerY + end * half * 0.6, top + tall / 2]);
  }
}

// Beacon on a mast top, render only
export function addBeacon(kit, centerX, centerY) {
  if (!kit.variant.bc) return;
  kit.add('beacon', cyl(centerX, centerY, kit.H - SINK_MM, kit.H + BEACON_MM[2], BEACON_MM[0], BEACON_MM[1], ROUND_SIDES));
  kit.anchors.beacons = [[centerX, centerY, kit.H + BEACON_MM[2] / 2]];
}

export const LAMP_RECIPES = { lamppost, floodlight };
