// Carried figure physics in the screen plane (x right, y down, px and seconds)

export const CARRY = {
  gravity: 2400, // px per s squared
  torsoLength: 50, // head to hips pendulum, px
  torsoDamping: 7.5, // per second
  torsoSpring: 55, // torso stiffness toward hanging straight
  torsoForce: 0.55, // share of cursor push the torso feels
  waistSpring: 60, // waist bend stiffness
  waistDamping: 6.2, // waist bend damping
  waistCouple: 0.6, // hips lag the torso's swing by this share
  stretchSpring: 200, // stretch stiffness
  stretchDamping: 14, // stretch damping
  stretchGain: 0.000027, // settled stretch per px/s² of upward pull
  handLength: 25, // shoulder to hand pendulum, px
  handDamping: 8.8, // hand damping
  handCouple: 0.5, // hands follow the torso's swing by this share
  yawSpring: 40, // turn stiffness
  yawDamping: 7.6, // turn damping
  yawGain: 0.0006, // turn per px/s sideways
  velocityRate: 25, // cursor velocity smoothing per second
  maxAccel: 12000, // cursor push cap, px/s²
  minGravity: 0.3, // effective gravity floor, share of gravity
  force: 1, // share of cursor push felt (reduced motion lowers it)
  maxTorso: 0.62, // outer swing range, radians
  maxWaist: 0.4, // outer waist bend range, radians
  maxHand: 0.9, // outer hand swing range from rest, radians
  maxYaw: 0.4, // outer turn range, radians
  maxStretch: 0.13, // outer stretch or squash range, share of length
  comfort: 0.55, // share of each range that is free
  limitSpring: 1400, // spring past the comfort range, per range
  limitGrowth: 3, // spring stiffens this many times more at the edge
  limitDamping: 12, // extra damping past the comfort range
};
const STEP_S = 1 / 120; // physics substep
const MAX_DT_S = 1 / 20; // longer frames are cut to this

const spring = () => ({ angle: 0, speed: 0 });

export function makeCarry(cursor = [0, 0]) {
  return { torso: spring(), waist: spring(), stretch: spring(), hands: [spring(), spring()], yaw: spring(), cursor: [...cursor], velocity: [0, 0] };
}

// Soft limit: past the comfort range a spring stiffens toward the edge
function limitAccel(state, limit, tune) {
  const free = limit * tune.comfort;
  const past = Math.abs(state.angle) - free;
  if (past <= 0) return 0;
  const share = past / (limit - free);
  const push = tune.limitSpring * limit * share * (1 + tune.limitGrowth * share);
  const outward = Math.sign(state.speed) === Math.sign(state.angle) ? tune.limitDamping * state.speed : 0;
  return -Math.sign(state.angle) * push - outward * (1 + share);
}

// Last resort only, the soft limit keeps values well inside
function keepInside(state, limit) {
  if (Math.abs(state.angle) <= limit) return;
  state.angle = Math.sign(state.angle) * limit;
  if (Math.sign(state.speed) === Math.sign(state.angle)) state.speed = 0;
}

function advance(state, accel, limit, step, tune) {
  state.speed += (accel + limitAccel(state, limit, tune)) * step;
  state.angle += state.speed * step;
  keepInside(state, limit);
}

// One frame: cursor at a new spot after dt seconds
export function stepCarry(carry, cursor, dt, tune = CARRY) {
  const time = Math.min(Math.max(dt, 0), MAX_DT_S);
  if (time === 0) return carry;
  const raw = [(cursor[0] - carry.cursor[0]) / time, (cursor[1] - carry.cursor[1]) / time];
  carry.cursor = [...cursor];
  const blend = Math.min(1, time * tune.velocityRate);
  const before = carry.velocity;
  carry.velocity = [before[0] + (raw[0] - before[0]) * blend, before[1] + (raw[1] - before[1]) * blend];
  let accel = [(carry.velocity[0] - before[0]) / time, (carry.velocity[1] - before[1]) / time];
  const size = Math.hypot(...accel);
  if (size > tune.maxAccel) accel = accel.map((value) => (value * tune.maxAccel) / size);
  const [ax, ay] = accel.map((value) => value * tune.force);
  const pull = Math.max(tune.gravity * tune.minGravity, tune.gravity - ay);
  const steps = Math.ceil(time / STEP_S - 1e-9);
  const step = time / steps;
  const { torso, waist, stretch, hands, yaw } = carry;
  for (let index = 0; index < steps; index++) {
    // Torso hangs from the held head
    const torsoAccel = -(pull * Math.sin(torso.angle) + ax * tune.torsoForce * Math.cos(torso.angle)) / tune.torsoLength - tune.torsoSpring * torso.angle - tune.torsoDamping * torso.speed;
    advance(torso, torsoAccel, tune.maxTorso, step, tune);
    // Hips bend at the waist, lagging the torso
    advance(waist, -tune.waistSpring * waist.angle - tune.waistDamping * waist.speed - tune.waistCouple * torsoAccel, tune.maxWaist, step, tune);
    // Upward pulls stretch the body, downward ones squash it
    advance(stretch, -tune.stretchSpring * stretch.angle - tune.stretchDamping * stretch.speed - tune.stretchSpring * tune.stretchGain * ay, tune.maxStretch, step, tune);
    // Each hand on an invisible arm from the shoulder
    for (const hand of hands) {
      const swing = -(pull * Math.sin(hand.angle) + ax * Math.cos(hand.angle)) / tune.handLength;
      advance(hand, swing - tune.handDamping * hand.speed - tune.handCouple * torsoAccel, tune.maxHand, step, tune);
    }
    // A small turn from sideways speed
    const target = Math.max(-tune.maxYaw, Math.min(tune.maxYaw, carry.velocity[0] * tune.yawGain * tune.force));
    advance(yaw, -tune.yawSpring * (yaw.angle - target) - tune.yawDamping * yaw.speed, tune.maxYaw, step, tune);
  }
  return carry;
}

// Scale that stretches along the body and keeps volume: [across, across, along]
export function stretchScale(stretch) {
  const along = 1 + stretch;
  const across = 1 / Math.sqrt(along);
  return [across, across, along];
}
