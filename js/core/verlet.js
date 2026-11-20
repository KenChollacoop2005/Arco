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
