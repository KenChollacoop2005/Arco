import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCarry, stepCarry, stretchScale, CARRY } from '../js/core/carry.js';

const FRAME = 1 / 60; // seconds per frame
const angles = (carry) => [carry.torso, carry.waist, carry.stretch, carry.yaw, ...carry.hands];

test('a held figure with a still cursor never moves', () => {
  const carry = makeCarry([200, 100]);
  for (let frame = 0; frame < 300; frame++) stepCarry(carry, [200, 100], FRAME);
  for (const part of angles(carry)) assert.deepEqual([part.angle, part.speed], [0, 0]);
});

test('moving right swings the body and hands back to the left and turns the figure', () => {
  const carry = makeCarry([0, 0]);
  for (let frame = 1; frame <= 12; frame++) stepCarry(carry, [frame * 8, 0], FRAME);
  assert.ok(carry.torso.angle < 0, `torso ${carry.torso.angle}`);
  for (const hand of carry.hands) assert.ok(hand.angle < 0, `hand ${hand.angle}`);
  assert.ok(carry.yaw.angle > 0, `yaw ${carry.yaw.angle}`);
  // Lifting fast stretches the body
  const lift = makeCarry([0, 0]);
  for (let frame = 1; frame <= 6; frame++) stepCarry(lift, [0, -frame * frame * 3], FRAME);
  assert.ok(lift.stretch.angle > 0, `stretch ${lift.stretch.angle}`);
});

test('wild cursor flicks never pass the caps or snap between frames', () => {
  const carry = makeCarry([0, 0]);
  let last = angles(carry).map((part) => part.angle);
  for (let frame = 0; frame < 600; frame++) {
    const x = (frame % 7 < 3 ? 1 : -1) * 240 * (frame % 5);
    const y = (frame % 3) * 180 - 200;
    stepCarry(carry, [x, y], FRAME);
    assert.ok(Math.abs(carry.torso.angle) <= CARRY.maxTorso + 1e-12);
    assert.ok(Math.abs(carry.waist.angle) <= CARRY.maxWaist + 1e-12);
    assert.ok(Math.abs(carry.stretch.angle) <= CARRY.maxStretch + 1e-12);
    assert.ok(Math.abs(carry.yaw.angle) <= CARRY.maxYaw + 1e-12);
    for (const hand of carry.hands) assert.ok(Math.abs(hand.angle) <= CARRY.maxHand + 1e-12);
    const now = angles(carry).map((part) => part.angle);
    now.forEach((value, index) => assert.ok(Math.abs(value - last[index]) < 0.3, `frame ${frame} part ${index} jumped ${value - last[index]}`));
    last = now;
  }
});

test('after a move the hands overshoot a little and everything settles', () => {
  const carry = makeCarry([0, 0]);
  for (let frame = 1; frame <= 15; frame++) stepCarry(carry, [frame * 10, 0], FRAME);
  const trace = [];
  for (let frame = 0; frame < 240; frame++) {
    stepCarry(carry, [150, 0], FRAME);
    trace.push(carry.hands[0].angle);
  }
  const peak = Math.max(...trace.map(Math.abs));
  const sign = Math.sign(trace[trace.findIndex((value) => Math.abs(value) === peak)]);
  const over = Math.max(0, ...trace.map((value) => -sign * value));
  assert.ok(over > 0.02 * peak, `overshoot ${over} of ${peak}`);
  assert.ok(over < 0.6 * peak, `overshoot ${over} of ${peak}`);
  for (const part of angles(carry)) {
    assert.ok(Math.abs(part.angle) < 1e-3, `settled angle ${part.angle}`);
    assert.ok(Math.abs(part.speed) < 1e-2, `settled speed ${part.speed}`);
  }
});

test('stretch keeps the volume', () => {
  for (let stretch = -CARRY.maxStretch; stretch <= CARRY.maxStretch; stretch += 0.01) {
    const [first, second, along] = stretchScale(stretch);
    assert.ok(Math.abs(first * second * along - 1) < 1e-12);
  }
});
