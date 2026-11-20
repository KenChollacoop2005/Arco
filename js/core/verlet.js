// Light 2D verlet: points, sticks of fixed length, one pinned point

// points: [[x, y]], sticks: [[a, b]] with lengths from the start pose
export function makeRig(points, sticks) {
  return {
    points: points.map(([x, y]) => ({ x, y, lastX: x, lastY: y })),
    sticks: sticks.map(([a, b]) => ({ a, b, length: Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]) })),
  };
}

// One step: inertia with damping, gravity (y down), then sticks and the pin
export function stepRig(rig, { pin, at, gravity, damping, iterations }) {
  for (const point of rig.points) {
    const moveX = (point.x - point.lastX) * damping;
    const moveY = (point.y - point.lastY) * damping;
    point.lastX = point.x;
    point.lastY = point.y;
    point.x += moveX;
    point.y += moveY + gravity;
  }
  for (let round = 0; round < iterations; round++) {
    for (const stick of rig.sticks) {
      const first = rig.points[stick.a];
      const second = rig.points[stick.b];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy) || 1e-6;
      const share = (distance - stick.length) / distance / 2;
      first.x += dx * share;
      first.y += dy * share;
      second.x -= dx * share;
      second.y -= dy * share;
    }
    rig.points[pin].x = at[0];
    rig.points[pin].y = at[1];
  }
  return rig;
}

// Pendulum swing of a carried figure from cursor motion, angle always capped
export function makeSwing(x = 0) {
  return { angle: 0, speed: 0, lastX: x, lag: [0, 0], time: 0 };
}

// One frame: push from cursor speed, spring back, damping; hands lag behind and bob
export function stepSwing(swing, x, { push, spring, damping, maxAngle, handLag, maxLag, bob, bobRate }) {
  const moved = x - swing.lastX;
  swing.lastX = x;
  swing.speed = (swing.speed - moved * push - swing.angle * spring) * damping;
  swing.angle += swing.speed;
  if (Math.abs(swing.angle) > maxAngle) {
    swing.angle = Math.sign(swing.angle) * maxAngle;
    swing.speed = 0;
  }
  const target = Math.max(-maxLag, Math.min(maxLag, -moved * handLag));
  swing.lag[0] += (target - swing.lag[0]) * (1 - damping);
  swing.time += bobRate;
  swing.lag[1] = Math.sin(swing.time) * bob;
  return swing;
}
