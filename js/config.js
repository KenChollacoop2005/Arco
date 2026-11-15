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

// Export plates
export const PLATE_GAP_MM = 4; // spacing between packed parts
export const PLATE_EDGE_MM = 3; // margin at plate edge

// Physics
export const PHYSICS_GRAVITY = 9.81; // gravity in cells per second squared
export const PHYSICS_FRICTION = 0.6; // contact friction
export const PHYSICS_STEP_S = 1 / 120; // simulation step
export const PHYSICS_SETTLE_S = 4; // test simulation length
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
