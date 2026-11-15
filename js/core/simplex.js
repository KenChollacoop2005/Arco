const PIVOT_EPS = 1e-9; // smallest usable pivot
const COST_EPS = 1e-9; // reduced cost tolerance
const FEASIBLE_TOL = 1e-7; // leftover infeasibility allowed
const STALL_LIMIT = 40; // stalls before Bland's rule

// Finds x >= 0 with rows * x = rhs, or null
export function solveFeasible(rows, rhs, variableCount) {
  const rowCount = rows.length;
  const width = variableCount + 1;
  const table = new Float64Array((rowCount + 1) * width);
  for (let row = 0; row < rowCount; row++) {
    const sign = rhs[row] < 0 ? -1 : 1;
    const base = row * width;
    for (const [column, value] of rows[row]) table[base + column] += sign * value;
    table[base + variableCount] = sign * rhs[row];
  }
  const costBase = rowCount * width;
  for (let row = 0; row < rowCount; row++) {
    const base = row * width;
    for (let column = 0; column < width; column++) table[costBase + column] -= table[base + column];
  }
  const basis = new Int32Array(rowCount).fill(-1);
  const iterationLimit = 60 * (rowCount + variableCount) + 200;
  let stalls = 0;
  let lastObjective = table[costBase + variableCount];
  for (let iteration = 0; iteration < iterationLimit; iteration++) {
    let entering = -1;
    if (stalls > STALL_LIMIT) {
      for (let column = 0; column < variableCount; column++) {
        if (table[costBase + column] < -COST_EPS) {
          entering = column;
          break;
        }
      }
    } else {
      let lowest = -COST_EPS;
      for (let column = 0; column < variableCount; column++) {
        if (table[costBase + column] < lowest) {
          lowest = table[costBase + column];
          entering = column;
        }
      }
    }
    if (entering < 0) break;
    let leaving = -1;
    let bestRatio = Infinity;
    for (let row = 0; row < rowCount; row++) {
      const pivot = table[row * width + entering];
      if (pivot > PIVOT_EPS) {
        const ratio = table[row * width + variableCount] / pivot;
        if (ratio < bestRatio - 1e-12 || (ratio < bestRatio + 1e-12 && leaving >= 0 && basis[row] < basis[leaving])) {
          bestRatio = ratio;
          leaving = row;
        }
      }
    }
    if (leaving < 0) break;
    const pivotBase = leaving * width;
    const pivotValue = table[pivotBase + entering];
    for (let column = 0; column < width; column++) table[pivotBase + column] /= pivotValue;
    for (let row = 0; row <= rowCount; row++) {
      if (row === leaving) continue;
      const base = row * width;
      const factor = table[base + entering];
      if (factor === 0) continue;
      for (let column = 0; column < width; column++) {
        table[base + column] -= factor * table[pivotBase + column];
      }
    }
    basis[leaving] = entering;
    const objective = table[costBase + variableCount];
    if (Math.abs(objective - lastObjective) < 1e-12) stalls++;
    else stalls = 0;
    lastObjective = objective;
  }
  let scale = 1;
  for (let row = 0; row < rowCount; row++) scale = Math.max(scale, Math.abs(rhs[row]));
  if (Math.abs(table[costBase + variableCount]) > FEASIBLE_TOL * scale) return null;
  const solution = new Float64Array(variableCount);
  for (let row = 0; row < rowCount; row++) {
    if (basis[row] >= 0) solution[basis[row]] = Math.max(0, table[row * width + variableCount]);
  }
  return solution;
}
