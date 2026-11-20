// Carried figure physics in the screen plane (x right, y down, px and seconds)

export const CARRY = {
  gravity: 2400, // px per s squared
  torsoLength: 50, // head to hips pendulum, px
  torsoDamping: 4.8, // per second
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
  maxTorso: 0.55, // swing cap, radians
  maxWaist: 0.35, // waist bend cap, radians
  maxHand: 0.8, // hand swing cap from rest, radians
  maxYaw: 0.35, // turn cap, radians
  maxStretch: 0.12, // stretch or squash cap, share of length
};
const STEP_S = 1 / 120; // physics substep
const MAX_DT_S = 1 / 20; // longer frames are cut to this

const spring = () => ({ angle: 0, speed: 0 });

export function makeCarry(cursor = [0, 0]) {
  return { torso: spring(), waist: spring(), stretch: spring(), hands: [spring(), spring()], yaw: spring(), cursor: [...cursor], velocity: [0, 0] };
}

// Keeps a value inside its cap and stops it pushing further out
function cap(state, limit) {
  if (Math.abs(state.angle) <= limit) return;
  state.angle = Math.sign(state.angle) * limit;
  if (Math.sign(state.speed) === Math.sign(state.angle)) state.speed = 0;
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
    const torsoAccel = -(pull * Math.sin(torso.angle) + ax * Math.cos(torso.angle)) / tune.torsoLength - tune.torsoDamping * torso.speed;
    torso.speed += torsoAccel * step;
    torso.angle += torso.speed * step;
    cap(torso, tune.maxTorso);
    // Hips bend at the waist, lagging the torso
    waist.speed += (-tune.waistSpring * waist.angle - tune.waistDamping * waist.speed - tune.waistCouple * torsoAccel) * step;
    waist.angle += waist.speed * step;
    cap(waist, tune.maxWaist);
    // Upward pulls stretch the body, downward ones squash it
    stretch.speed += (-tune.stretchSpring * stretch.angle - tune.stretchDamping * stretch.speed - tune.stretchSpring * tune.stretchGain * ay) * step;
    stretch.angle += stretch.speed * step;
    cap(stretch, tune.maxStretch);
    // Each hand on an invisible arm from the shoulder
    for (const hand of hands) {
      const swing = -(pull * Math.sin(hand.angle) + ax * Math.cos(hand.angle)) / tune.handLength;
      hand.speed += (swing - tune.handDamping * hand.speed - tune.handCouple * torsoAccel) * step;
      hand.angle += hand.speed * step;
      cap(hand, tune.maxHand);
    }
    // A small turn from sideways speed
    const target = Math.max(-tune.maxYaw, Math.min(tune.maxYaw, carry.velocity[0] * tune.yawGain * tune.force));
    yaw.speed += (-tune.yawSpring * (yaw.angle - target) - tune.yawDamping * yaw.speed) * step;
    yaw.angle += yaw.speed * step;
    cap(yaw, tune.maxYaw);
  }
  return carry;
}

// Scale that stretches along the body and keeps volume: [across, across, along]
export function stretchScale(stretch) {
  const along = 1 + stretch;
  const across = 1 / Math.sqrt(along);
  return [across, across, along];
}
