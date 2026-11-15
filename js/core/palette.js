// Vertex kinds
export const KIND_CONCRETE = 0;
export const KIND_DETAIL = 1;
export const KIND_GLASS = 2;
export const KIND_SWAY = 3;
export const KIND_SPIN = 4;

// Group fields: color, kind, printed
export const GROUPS = {
  concrete: [0xb7b3aa, KIND_CONCRETE, true],
  dark: [0x8d8982, KIND_CONCRETE, true],
  glass: [0x2a3038, KIND_GLASS, false],
  steel: [0x7b8087, KIND_DETAIL, true],
  rust: [0x9c4b2a, KIND_DETAIL, true],
  soot: [0x2d2b2a, KIND_DETAIL, true],
  hazard: [0xe0ae1a, KIND_DETAIL, true],
  solar: [0x1a2540, KIND_DETAIL, true],
  soil: [0x5b4737, KIND_DETAIL, true],
  plant: [0x4e7a3a, KIND_DETAIL, true],
  plantDark: [0x375c2d, KIND_DETAIL, true],
  plantLight: [0x86a44b, KIND_DETAIL, true],
  wood: [0x8c6c4a, KIND_DETAIL, true],
  water: [0x6c94a6, KIND_DETAIL, true],
  tarpTerracotta: [0xb86040, KIND_SWAY, true],
  tarpMustard: [0xc8982c, KIND_SWAY, true],
  tarpTeal: [0x4b8985, KIND_SWAY, true],
  rotor: [0xd9d6cf, KIND_SPIN, true],
};

export const GROUP_IDS = Object.keys(GROUPS);

export const groupColor = (group) => GROUPS[group][0];
export const groupKind = (group) => GROUPS[group][1];
export const groupPrinted = (group) => GROUPS[group][2];
