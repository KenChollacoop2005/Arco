// Grid
export const CELL_MM = 25; // cell width
export const STORY_MM = 25; // story height
export const PLINTH_DIAMETER_CELLS = 12; // plinth width in cells
export const MAX_MODULE_STORIES = 4; // tallest single module
export const MAX_MODULES = 220; // performance cap

// Budget modes
export const BUDGET_HARD_CAP = 400; // most modules a structure may ever hold
export const BUDGET_CUSTOM_MIN = 10; // smallest custom module cap
export const BUDGET_CUSTOM_DEFAULT = 120; // custom cap when none is typed
export const FANTASY_GROW = [8, 30]; // fewest and most modules one fantasy Grow adds

// Grow here tool
export const GROW_ZONE_CELLS = { S: 2, M: 3, L: 4 }; // zone radius in cells per size stop
export const GROW_ZONE_DEFAULT = 'M'; // size stop the slider starts on
export const GROW_ZONE_COLOR = 0xa8e6b8; // pastel green zone sphere
export const GROW_ZONE_OPACITY = 0.28; // zone sphere see-through share

// Collection showroom
export const SHOWROOM_IDLE_MS = 3000; // pause before the view eases home
export const SHOWROOM_EASE_MS = 900; // time to ease back to the default angle
export const SHOWROOM_SPIN = 1; // turn speed, one turn in about 60 s

// Opening structure
export const OPENING_UNIT_MIN = 12; // fewest opening modules
export const OPENING_UNIT_MAX = 30; // most opening modules

// Build animation
export const BUILD_MS_PER_MODULE = 350; // one module build time
export const BUILD_TOTAL_MS = 3600; // whole structure stagger span
export const BUILD_STAGGER_MAX_MS = 70; // longest gap between modules

// Stability
export const STABILITY_MARGIN = 1.5; // support inset in mm

// Printability, Bambu Lab A1 Mini
export const BED_MM = 180; // build volume edge
export const MAX_OVERHANG_DEG = 45; // steepest overhang from vertical
export const MAX_BRIDGE_MM = 20; // longest flat bridge
export const MIN_WALL_MM = 1.2; // thinnest wall
export const MIN_BED_CONTACT_MM2 = 60; // smallest flat base area

// Connectors
export const CONNECTOR_CLEARANCE_MM = 0.2; // gap between mating faces
export const CLEARANCE_MIN_MM = 0.05; // lowest clearance setting
export const CLEARANCE_MAX_MM = 0.5; // highest clearance setting
export const CLEARANCE_STEP_MM = 0.05; // clearance setting step
export const RAIL_OFFSET_MM = 6.25; // rail center from face center
export const RAIL_NECK_MM = 4; // dovetail width at face
export const RAIL_DEPTH_MM = 2.5; // dovetail depth
export const RAIL_FLANK_DEG = 30; // flank undercut angle
export const RAIL_LEAD_MM = 0.8; // rail end chamfer
export const PEG_SIZE_MM = 8; // peg square width
export const PEG_LENGTH_MM = 8; // peg length
export const SOCKET_CHAMFER_MM = 0.4; // socket mouth chamfer
export const SIDE_CLEAR_MM = 3; // setback for parts without rails
export const DOCK_LIP_MM = 1.6; // slot floor a bridge rail lands on
export const DOCK_HEAD_MM = [5, 8]; // bridge end block length and height
export const COUPON_DEPTH_MM = 16; // fit test block depth
export const COUPON_HEIGHT_MM = 12; // fit test block height
export const COUPON_SOCKET_BACK_MM = 6; // coupon socket center from the back

// Export plates
export const PLATE_GAP_MM = 4; // spacing between packed parts
export const PLATE_EDGE_MM = 3; // margin at plate edge

// Physics
export const PHYSICS_GRAVITY = 9.81; // gravity in cells per second squared
export const PHYSICS_FRICTION = 0.6; // contact friction
export const PHYSICS_STEP_S = 1 / 120; // simulation step
export const PHYSICS_CONTACT_HZ = 60; // contact stiffness, engine default 30
export const PHYSICS_SETTLE_S = 4; // test simulation length
export const PHYSICS_RUN_MAX_S = 30; // longest run in the browser
export const PHYSICS_MOVE_TOL_CELLS = 0.12; // drift counted as falling

// Camera
export const CAMERA_AZIMUTH_DEG = 35; // three quarter view yaw
export const CAMERA_ELEVATION_DEG = 28; // three quarter view pitch
export const CAMERA_FIT_PADDING = 1.18; // space around the model
export const CAMERA_RISE_RATE = 3.2; // target follow speed
export const CAMERA_ZOOM_MIN = 0.35; // furthest zoom factor
export const CAMERA_ZOOM_MAX = 9; // closest zoom factor

// Effects
export const SMOKE_PARTICLES_MAX = 160; // smoke particle cap
export const SMOKE_PER_EMITTER = 5; // smoke puffs alive per stack
export const STEAM_PER_EMITTER = 4; // steam wisps alive per vent
export const SMOKE_LIFE_S = [5, 8]; // smoke puff life range
export const STEAM_LIFE_S = [2, 3.4]; // steam wisp life range
export const SMOKE_RISE_MM = [22, 34]; // smoke rise over its life
export const STEAM_RISE_MM = [10, 16]; // steam rise over its life
export const SMOKE_DRIFT_MM = 9; // smoke sideways drift over its life
export const SMOKE_SIZE_MM = [2.5, 9]; // smoke puff size, born to faded
export const STEAM_SIZE_MM = [1.6, 5]; // steam wisp size, born to faded
export const SMOKE_ALPHA = 0.16; // smoke puff peak opacity
export const STEAM_ALPHA = 0.12; // steam wisp peak opacity
export const DRIPS_PER_FALL = 2; // droplets per falling sheet
export const DRIPS_MAX = 24; // droplet cap
export const DRIP_CYCLE_S = [2.5, 6]; // seconds between droplets, per droplet
export const DRIP_LIFE_S = 0.5; // droplet flight time
export const DRIP_SPEED_MM = 9; // droplet sideways speed, mm per second
export const DRIP_GRAVITY_MM = 60; // droplet fall, mm per second squared
export const DRIP_SIZE_MM = 0.7; // droplet size
export const DRIP_ALPHA = 0.5; // droplet opacity
export const PARTICLE_LIGHT_SHARE = 0.4; // share of particles kept on the light preset
export const RUNOFF_STREAMS_MAX = 4; // runoff stream cap
export const TURBINE_RPM = 22; // rotor speed
export const TARP_SWAY_MM = 0.5; // tarp sway size

// Time of day, visual only
export const TIMES = ['day', 'dusk', 'night']; // slider stops, left to right
export const TIME_KEY = 'arco.time'; // remembered time of day
// Per time: key colour, key strength, key direction, sky colour, ground colour, fill strength
export const DUSK_LIGHT = [0xffa25e, 2.3, [-0.9, -0.32, 0.26], 0x7f93c4, 0x6b5448, 0.95];
export const NIGHT_LIGHT = [0x8ea6dc, 0.42, [0.35, -0.55, 0.75], 0x26314f, 0x15171d, 0.42];
export const WINDOW_GLOW = { day: 0, dusk: 0.55, night: 1 }; // window and lamp glow strength by time
export const WINDOW_LIT_SHARE = 0.82; // share of windows lit at full power
export const WINDOW_WARM = [[1, 0.72, 0.4], [1, 0.84, 0.58]]; // window glow colour range, linear
export const WINDOW_GLOW_STRENGTH = 1.6; // window emissive strength at night
export const SIGN_GLOW_STRENGTH = 0.55; // amenity sign glow, share of its colour
export const LAMP_GLOW_STRENGTH = 2.4; // lamp bulb emissive strength at night
export const LAMP_DAY_GLOW = 0.15; // lamp bulb glow share in daylight
export const FLICKER_SHARE = 0.5; // power share under which lit windows flicker
export const FLICKER_PERIOD_S = [1.6, 4.5]; // seconds between flicker dips, per window
export const FLICKER_OFF_SHARE = 0.14; // share of each period a window is out
export const BEACON_PERIOD_S = 1.8; // beacon blink cycle
export const BEACON_ON_SHARE = 0.35; // share of the cycle a beacon is lit
export const POOL_RADIUS_MM = 26; // lamp light pool radius on the ground
export const POOL_STRENGTH = { day: 0, dusk: 0.35, night: 0.8 }; // light pool opacity by time
export const NIGHT_POINT_LIGHTS = 4; // real point lights at the brightest lamp clusters
export const POINT_LIGHT_STRENGTH = 900; // point light intensity at night
export const POINT_LIGHT_REACH_MM = 110; // point light distance
export const POINT_CLUSTER_MM = 60; // lamps within this join one cluster

// Lights from power and light pieces
export const LIGHT_DEMAND = { lamppost: 0.25, floodlight: 0.25, beacon: 0.25, stringlights: 0.25 }; // power per light
export const LIGHT_RADIUS_CELLS = { lamppost: 2, floodlight: 3.5, stringlights: 1.5 }; // outdoor light reach in cells
export const STRING_LIGHTS_MAX = 4; // most string light runs per structure
export const STRING_LIGHTS_CHANCE = 0.4; // chance a free line hook starts a run
export const STRING_LIGHTS_SAG = [0.06, 0.12]; // string light sag, share of the span
export const STRING_BULB_GAP_MM = 3; // spacing of bulbs along a run
export const STRING_BULB_MM = 0.55; // bulb radius

// Toggles
export const LIGHT_CORES_MAX = 4; // cores at or under this: light preset
export const LIGHT_MEMORY_GB_MAX = 4; // memory at or under this: light preset

// Stream on the plinth
export const STREAM_CHANCE = 0.35; // share of seeds with a stream
export const STREAM_LENGTH = [6, 12]; // stream length range in cells, from the rim upstream

// Analysis
export const EXPOSURE_REACH_CELLS = 4; // free cells counted in front of a face

// Strings: physical ports
export const PORT_RAY_OUT_MM = 14; // probe starts this far outside the cell edge
export const PORT_RAY_IN_MM = 13; // probe reaches this far inside the cell edge
export const PORT_RAY_STEP_MM = 0.25; // probe step before refining
export const PORT_TRIES = 8; // seeded spots tried per port
export const PORT_FRONT_MM = 2; // space a port needs in front of it

// Strings: water
export const WATER_QUARTERS = 4; // units are counted in quarters inside the solver
export const WATER_STEP = 0.5; // water and power split between branches in steps of this
export const GRAVITY_HEAD = 3; // head of gravity water, which cannot climb
export const HEAD_PER_CELL = 1; // head spent per cell of level pipe
export const HEAD_PER_STORY_UP = 2; // head spent per story of rise; falling is free
// Water sources: own supply in units, head (null is gravity), throughput (null is none)
export const WATER_SOURCES = {
  rain: [1, null, null],
  spring: [2, null, null],
  tank: [4, null, null],
  roof: [0.25, null, null],
  pumptank: [3, 8, 6],
  smallpump: [0, 9, 6],
  plantpump: [0, 9, 6],
  pumproom: [6, 20, 12],
  well: [3, 6, 3],
};
export const SOURCE_FAMILIES = { raincatcher: 'rain', spring: 'spring', tank: 'tank' }; // families that are gravity sources
export const PUMP_KINDS = { pumptank: 'pumptank', smallpump: 'smallpump', plant: 'plantpump', pumproom: 'pumproom', well: 'well' }; // family to pump row
export const DEMAND_PER_CELL = { farm: 0.5, planter: 0.5, greenhouse: 0.5, planted: 0.5 }; // crop beds, units per footprint cell
export const DEMAND_PER_MODULE = { housing: 0.25, studio: 0.25, penthouse: 0.25, shacks: 0.25, flared: 0.25, garden: 0.5 }; // homes and pools, units per module
export const HUB_INPUTS = 2; // most pipes into one pump or main
export const BASIN_INPUTS = 2; // most pipes into one consumer
export const TRICKLE_ON = false; // surplus falls to lower basins as drawn sheets

// Strings: geometry
export const PIPE_MAX_MM = 8 * 25; // longest pipe, port to port
export const PIPE_RADIUS_MM = 0.85; // pipe radius
export const PIPE_GAP_MM = 0.5; // gap between a pipe and the surface it follows
export const PIPE_CROSS_MAX_MM = 3 * 25; // longest free span across a gap between masses
export const PIPE_CROSS_FACING = 0.5; // a gap span leaves and meets each wall at least this square on
export const BODY_MIN_MM = 8; // solids thinner than this in plan are protrusions pipes may pass
export const STRING_CLEAR_MM = 0.3; // strings keep this far from collider boxes
export const WIRE_MAX_MM = 6 * 25; // longest power wire, port to port
export const LINE_MAX_MM = 3 * 25; // longest plain line, port to port
export const STRING_MAX_MM = { pipe: PIPE_MAX_MM, wire: WIRE_MAX_MM, line: LINE_MAX_MM }; // length limit per string type
export const WIRE_SAG = [0.05, 0.13]; // wire sag at mid span, share of the span
export const LINE_SAG = [0.03, 0.08]; // plain line sag at mid span, share of the span
export const CURVE_STEPS = 10; // straight pieces per hanging string
export const CURVE_LIGHT_STEPS = 4; // pieces per hanging string on weak devices
export const WIRE_OUT_MM = 1.2; // cable ends this far off the bracket

// Strings: pair caps, counted both ways between the same two ports
export const MAX_WIRES_PER_PAIR = 2; // most power wires between two ports
export const MAX_PIPES_PER_PAIR = 1; // most pipes between two ports
export const MAX_LINES_PER_PAIR = 1; // most plain lines between two ports

// Strings: power
export const POWER_ROOMS = ['powerroom']; // families wires fan out from
export const CABLE_SHIFT_MM = 0.9; // seeded shift of each cable's ends
export const CABLE_TILT = 0.35; // most sideways swing of a cable's sag, radians
export const SPARE_SHARE = 0.15; // share of links with a slack spare cable
export const SPARE_SAG = [0.22, 0.32]; // spare cable sag, share of the span

// Strings: plain lines and decor
export const LINE_RISE_MM = 0.6 * 25; // most height difference along a clothesline
export const CLOTHESLINES_MAX = 36; // most clotheslines per structure
export const LAUNDRY_GAP_MM = [2.6, 5.5]; // spacing of laundry along a line
export const LAUNDRY_CHANCE = 0.7; // chance a spot on the line has laundry
export const LAUNDRY_SIZE_MM = [[1.4, 3], [1.8, 3.6]]; // laundry width range, drop range
export const LAUNDRY_COLORS = [0xe4ded0, 0x9b3d3d, 0x3d5e8a, 0xd9b44a, 0x6f8f5e, 0xc4c4c4, 0xb86040]; // washing colors
export const TARP_REACH_MM = 2.3 * 25; // longest tarp edge
export const TARP_RISE_MM = 25; // most height difference between tarp corners
export const TARP_MIN_AREA_MM2 = 60; // smallest tarp in plan
export const TARPS_MAX = 6; // most tarps per structure
export const TARP_COLORS = [0xb5694a, 0xc9a23f, 0x5f9c95]; // terracotta, mustard, faded teal

// Power: units, reach and throughput
// Power sources: supply in units, reach in cells
export const POWER_SUPPLY = {
  turbine: [2, 6],
  solar: [1, 6],
  generator: [6, 8],
  wheel: [3, 6],
  wheelup: [0, 6],
};
export const TURBINE_EXTRA_PER_STORY = 0.5; // turbine supply added per story past its shortest
export const SOLAR_PER_CELL = 0.5; // solar supply per footprint cell, at least the base row
export const WHEEL_PER_UNIT = 1; // elevated wheel power per unit of gravity water through it
export const WHEEL_UP_CAP = 3; // most power one elevated wheel makes
// Power relays: reach in cells, throughput in units
export const POWER_RELAYS = { powerroom: [12, 8], junction: [6, 3] };
// Power demand per module
export const POWER_DEMAND = {
  housing: 0.5, studio: 0.5, penthouse: 0.5, shacks: 0.5, flared: 0.5,
  smokestack: 1, chimney: 1, cooling: 1, tankfarm: 1,
  smallpump: 0.5, pumptank: 0.5, plantpump: 0.5, pumproom: 1, well: 0.5,
  hall: 0.5, shop: 0.5,
};
export const POWER_FANOUT = [1, 3]; // children a source or relay feeds, seeded
export const POWER_CHILD_FANOUT = [0, 3]; // children a fed consumer passes power on to, seeded
export const MAX_CHAIN_LINKS = 2; // most one-in-one-out links in a row
export const REJOIN_CHANCE = 0.25; // share of branch ends that rejoin a relay higher up
export const POWER_SHORT_REACH = 4; // cells past the reach searched to report a shortfall
export const POWER_JITTER = 0.15; // seeded cells added to a link cost, for variety
export const POWER_OVERBOOK = 1.5; // a tree wires up to this many times its supply; the rest report source empty

// Wires: routing and hang
export const WIRE_SPAN_MAX_MM = 5 * 25; // longest free span between brackets
export const WIRE_SPAN_FACING = 0.1; // a span leaves and meets each bracket at least this square on
export const WIRE_SLACK = [0.015, 0.045]; // extra cable over the route length, share
export const WIRE_CABLES = [1, 3]; // cables strung on one link; the pair cap trims the rest
export const WIRE_BUNDLE_MM = 0.9; // spacing of cables sharing a conduit
export const WIRE_SAMPLE_MM = 1.5; // sample spacing along a conduit check
export const CATENARY_STEPS = 16; // straight pieces per free span

// Residents: rolls and want, hate and dream parameters
export const RESIDENT_WANTS = [1, 4]; // wants per resident
export const RESIDENT_HATES = [0, 2]; // hates per resident
export const RESIDENT_DREAM_CHANCE = 0.5; // share of residents with a dream
export const RESIDENT_ROLL_TRIES = 40; // draws tried before a roll gives up on a slot
export const HIGH_STORY = [2, 4]; // high up: home at or above this story
export const LOW_STORY = [0, 1]; // low down: home at or below this story
export const HEIGHTS_STORY = [2, 3]; // hates heights: home above this story
export const INDUSTRY_CELLS = [2, 3]; // away from or near industry: within this many cells
export const DISPOSAL_CELLS = [2, 3]; // near disposal: within this many cells
export const AMENITY_STEPS = [6, 12]; // near an amenity: walking steps
export const LONG_WALK_STEPS = [8, 14]; // long walk: more steps than this to the plinth
export const CROWDING_HOMES = [2, 3]; // crowding: more adjacent homes than this
export const TALL_STORIES = [4, 6]; // dream: building at least this many stories
export const EXTRA_SUPPLY = 0.5; // extra water or power: units above the home's demand
export const OUTWARD_REACH_CELLS = 4; // a side face looks out when this many cells are free
export const NOISY_FAMILIES = ['generator', 'powerroom', 'pumproom']; // noise when adjacent
export const BRIDGE_FAMILIES = ['walkway', 'bridge', 'gantry']; // join masses, never part of one

// Puzzle points, fixed and never puzzle dependent
export const POINTS = {
  needMet: 10, // a need met
  needMissed: -15, // a need not met
  wantMet: 8, // a want met
  wantMissed: -4, // a want not met
  hateTriggered: -8, // a hate triggered
  dreamMet: 6, // a dream met
  dreamMissed: 0, // a dream missed
  happy: 20, // every want met, no hate, dream met if any
  unusedPiece: 2, // each tray piece left unused
  unusedCap: 10, // most points from unused pieces
};

// Puzzles: content rules, site split, tray, par search
export const PUZZLE_FORMAT_VERSION = 1; // puzzle file format
export const PUZZLE_GENERATOR_VERSION = 1; // puzzle generator rules
export const PUZZLE_MAX_PIECES = 25; // most modules in the answer
export const PUZZLE_ANSWER = { density: 0, height: 1, daring: 1, theme: 1, services: 'high' }; // Generate choices for the answer
export const PUZZLE_RESIDENTS = [3, 5]; // residents per puzzle
export const PUZZLE_PRESET_RESIDENTS = [0, 2]; // residents already living in locked homes
export const PUZZLE_SITE_SHARE = 0.5; // share of the answer pre-placed and locked
export const PUZZLE_DECOYS = [2, 4]; // extra tray pieces beside the answer
export const PUZZLE_TRAIT_SHARE = [0.45, 0.85]; // share of traits the answer satisfies
export const PUZZLE_TRAIT_TRIES = 12; // resident rolls tried per answer
export const PUZZLE_REROLLS = 24; // seeds tried before giving up
export const PAR_STEPS = 20; // hill-climb steps for par
export const PAR_PIECE_SHARE = 0.45; // share of steps that move a tray piece
export const PAR_PLACE_TRIES = 16; // spots tried when placing a piece
export const PAR_POINTS = [60, 700]; // healthy par range
export const PAR_START_SHARE = 0.5; // the empty tray scores at most this share of par
export const PIECE_ID_BASE = 1000; // ids of placed tray pieces start here
