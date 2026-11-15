const cross = (origin, pointA, pointB) =>
  (pointA[0] - origin[0]) * (pointB[1] - origin[1]) -
  (pointA[1] - origin[1]) * (pointB[0] - origin[0]);

// Counter clockwise hull, collinear points dropped
export function convexHull(points) {
  const sorted = points
    .map((point) => [point[0], point[1]])
    .sort((pointA, pointB) => pointA[0] - pointB[0] || pointA[1] - pointB[1]);
  const unique = sorted.filter(
    (point, index) =>
      index === 0 ||
      Math.abs(point[0] - sorted[index - 1][0]) > 1e-9 ||
      Math.abs(point[1] - sorted[index - 1][1]) > 1e-9
  );
  if (unique.length < 3) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-12) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-12) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function nearestOnSegment(pointA, pointB, pointX, pointY) {
  const deltaX = pointB[0] - pointA[0];
  const deltaY = pointB[1] - pointA[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  let along = 0;
  if (lengthSquared > 0) {
    along = ((pointX - pointA[0]) * deltaX + (pointY - pointA[1]) * deltaY) / lengthSquared;
    along = Math.max(0, Math.min(1, along));
  }
  return [pointA[0] + along * deltaX, pointA[1] + along * deltaY];
}

// Positive inside, negative distance outside
export function hullDistance(hull, pointX, pointY) {
  if (hull.length === 0) return -Infinity;
  if (hull.length === 1) return -Math.hypot(pointX - hull[0][0], pointY - hull[0][1]);
  if (hull.length === 2) {
    const nearest = nearestOnSegment(hull[0], hull[1], pointX, pointY);
    return -Math.hypot(pointX - nearest[0], pointY - nearest[1]);
  }
  let inside = Infinity;
  let outside = Infinity;
  for (let index = 0; index < hull.length; index++) {
    const pointA = hull[index];
    const pointB = hull[(index + 1) % hull.length];
    const edgeLength = Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]);
    const signed = cross(pointA, pointB, [pointX, pointY]) / edgeLength;
    inside = Math.min(inside, signed);
    const nearest = nearestOnSegment(pointA, pointB, pointX, pointY);
    outside = Math.min(outside, Math.hypot(pointX - nearest[0], pointY - nearest[1]));
  }
  return inside >= 0 ? inside : -outside;
}

export function nearestInHull(hull, pointX, pointY) {
  if (hull.length === 0) return [pointX, pointY];
  if (hull.length === 1) return hull[0].slice();
  if (hull.length > 2 && hullDistance(hull, pointX, pointY) >= 0) return [pointX, pointY];
  let best = null;
  let bestDistance = Infinity;
  const edgeCount = hull.length === 2 ? 1 : hull.length;
  for (let index = 0; index < edgeCount; index++) {
    const nearest = nearestOnSegment(hull[index], hull[(index + 1) % hull.length], pointX, pointY);
    const distance = Math.hypot(pointX - nearest[0], pointY - nearest[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = nearest;
    }
  }
  return best;
}
