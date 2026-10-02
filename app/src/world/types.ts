// Shapes of design/world.json and design/derived/walls.json that the runtime reads.
export type Vec2 = [number, number];
export type FloorId = 'L1' | 'L2';
export type AccessMode = 'staff' | 'visitor';

export interface Room {
  id: string; floor: FloorId; name: string; category: string; access: 'public' | 'staff' | 'restricted';
  noise: string; function: string; polygon: Vec2[]; finish: { floor: string; wall: string; ceiling: string };
}
export interface Door {
  id: string; floor: FloorId; rooms: [string, string]; center: Vec2; width: number;
  type: 'single' | 'double' | 'opening' | 'sliding' | 'hatch'; access: 'public' | 'staff' | 'restricted';
  exit: boolean; wallAxis: 'x' | 'y';
  /** Swing doors only: leaf opens into `into`; hinge low/high = jamb at the lower/higher coordinate along the wall. */
  swing?: { into: string; hinge: 'low' | 'high' | 'both' };
}
export interface WindowSpec {
  id: string; floor: FloorId; room: string; wallAxis: 'x' | 'y'; at: number; center: Vec2; width: number;
  sill: number; head: number; glazing: 'clear' | 'obscured'; status: 'konsep';
}
export interface Outlet {
  id: string; floor: FloorId; room: string; pos: Vec2; mount: string; z: number; ports: number; serves: string;
  domain: string; endpointTypes: string[];
}
export interface OutletRule { ports: number; mount: string; domainByFloor: Record<FloorId, string>; endpointTypes: string[] }
export interface Fixture {
  id: string; floor: FloorId; room: string; type: string; asset: string; pos: Vec2; rot: number;
  size: [number, number, number]; collider: boolean; pairedWith?: string; artwork?: string;
  verticalLink?: string; ictRack?: string;
}
export interface CatalogEntry {
  size: [number, number, number]; label: string; collider: boolean; family: string; interaction?: string;
}
export interface ActivitySlot {
  id: string; fixture: string; floor: FloorId; room: string; activity: string; pos: Vec2; facing: number;
  pose: 'sit' | 'stand'; capacity: number;
}
export interface VerticalLinkEnd { floor: FloorId; point: Vec2; facing?: number; arrive?: Vec2 }
export interface VerticalLink { id: string; type: string; ends: VerticalLinkEnd[]; prompt: string; playable?: boolean; travelSeconds?: number }
export interface Waypoint { id: string; floor: FloorId; pos: Vec2; kind: string; facing?: number }
export interface Actor {
  id: string; displayName: string; role: string; kind: 'player' | 'npc'; avatarAsset: string; homeRoom: string;
  homeSeat?: string; rolePreference: Record<string, number>; allowedPublicFields: string[]; simulated: true;
}
export interface Floor { id: FloorId; name: string; level: number; elevation: number; envelope: Vec2[]; spawn: string; safePoint: string }
export interface World {
  schemaVersion: string; revision: { id: string; date: string; note: string }; status: string;
  building: { footprint: Vec2; floorToFloor: number; ceilingHeight: number; slab: number; wall: { exterior: number; interior: number } };
  floors: Floor[]; rooms: Room[]; doors: Door[]; windows: WindowSpec[]; verticalLinks: VerticalLink[]; catalog: Record<string, CatalogEntry>;
  fixtures: Fixture[]; activitySlots: ActivitySlot[]; waypoints: Waypoint[]; actors: Actor[];
  ict: {
    outlets: Outlet[]; outletRules: Record<string, OutletRule>; mountZ: Record<string, number>;
    devices: { id: string; type: string; floor: FloorId; room: string; pos: Vec2 }[];
  };
  assumptions: { id: string; topic: string; text: string }[];
}
export interface WallPiece { axis: 'x' | 'y'; at: number; from: number; to: number; thickness: number; exterior: boolean }
export interface Opening { door: string; axis: 'x' | 'y'; at: number; from: number; to: number; type: string; access: string; exit: boolean }
/** Door leaf derived by tools/kantor/geometry.py::door_leaves (hinge on the wall face of the 'into' side). */
export interface DoorLeaf {
  id: string; door: string; into: string; restricted: boolean; hinge: Vec2; length: number;
  closedDeg: number; openDeg: number; openRect: [number, number, number, number];
}
export interface DerivedWalls { worldRevision: string; floors: Record<FloorId, { walls: WallPiece[]; openings: Opening[]; leaves: DoorLeaf[] }> }
