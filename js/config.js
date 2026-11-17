// Grid
export const CELL_MM = 25; // cell width
export const STORY_MM = 25; // story height
export const PLINTH_DIAMETER_CELLS = 12; // plinth width in cells
export const MAX_MODULE_STORIES = 4; // tallest single module
export const MAX_MODULES = 220; // performance cap

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
export const RUNOFF_STREAMS_MAX = 4; // runoff stream cap
export const TURBINE_RPM = 22; // rotor speed
export const TARP_SWAY_MM = 0.5; // tarp sway size

// Toggles
export const LIGHT_CORES_MAX = 4; // cores at or under this: light preset
export const LIGHT_MEMORY_GB_MAX = 4; // memory at or under this: light preset

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
export const WATER_STEP = 0.5; // units split between branches in steps of this
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
};
export const SOURCE_FAMILIES = { spout: 'rain', tank: 'tank' }; // families that are sources (no family is a spring yet)
export const PUMP_KINDS = { pumptank: 'pumptank', smallpump: 'smallpump', plant: 'plantpump', pumproom: 'pumproom' }; // family to pump row
export const DEMAND_PER_CELL = { farm: 0.5, planter: 0.5, greenhouse: 0.5, planted: 0.5 }; // crop beds, units per footprint cell
export const DEMAND_PER_MODULE = { housing: 0.25, studio: 0.25, penthouse: 0.25, shacks: 0.25, flared: 0.25, garden: 0.5 }; // homes and pools, units per module
export const HUB_INPUTS = 2; // most pipes into one pump or main
export const BASIN_INPUTS = 2; // most pipes into one consumer

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
export const POWER_SOURCES = ['turbine', 'solar']; // families that make power
export const POWER_ROOMS = ['powerroom']; // families wires fan out from
export const ROOM_NEAR_MM = 5 * 25; // a power room this close takes over from a source
export const JUMPER_MAX_MM = 1.2 * 25; // longest wire between touching modules
export const WIRE_CROSS_MM = 1.5 * 25; // cost added per wire crossed in plan
export const WIRE_LINKS_MAX = 70; // most wire links per structure
export const CABLES_PER_LINK = [1, 3]; // cables strung on one link
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
