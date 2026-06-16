export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ElementType = 'rectangle' | 'circle' | 'line' | 'text' | 'path' | 'image';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  version: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: Point[];
  stroke?: string;
  strokeWidth?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fill?: string;
}

export interface PathElement extends BaseElement {
  type: 'path';
  pathData: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
}

export type WhiteboardElement =
  | RectangleElement
  | CircleElement
  | LineElement
  | TextElement
  | PathElement
  | ImageElement;

export type OperationType =
  | 'create'
  | 'delete'
  | 'move'
  | 'resize'
  | 'update'
  | 'reorder';

export interface BaseOperation {
  id: string;
  type: OperationType;
  elementId: string;
  userId: string;
  timestamp: number;
  version: number;
}

export interface CreateOperation extends BaseOperation {
  type: 'create';
  element: WhiteboardElement;
}

export interface DeleteOperation extends BaseOperation {
  type: 'delete';
}

export interface MoveOperation extends BaseOperation {
  type: 'move';
  dx: number;
  dy: number;
  newX: number;
  newY: number;
}

export interface ResizeOperation extends BaseOperation {
  type: 'resize';
  newWidth: number;
  newHeight: number;
}

export interface UpdateOperation extends BaseOperation {
  type: 'update';
  properties: Record<string, any>;
}

export interface ReorderOperation extends BaseOperation {
  type: 'reorder';
  newZIndex: number;
}

export type WhiteboardOperation =
  | CreateOperation
  | DeleteOperation
  | MoveOperation
  | ResizeOperation
  | UpdateOperation
  | ReorderOperation;

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface UserState {
  id: string;
  name: string;
  color: string;
  viewport: Viewport;
  cursor?: Point;
  lastActive: number;
}

export interface RoomState {
  id: string;
  name: string;
  elements: Map<string, WhiteboardElement>;
  users: Map<string, UserState>;
  maxZIndex: number;
  operationHistory: WhiteboardOperation[];
}

export type WSMessageType =
  | 'join'
  | 'join_response'
  | 'reconnect'
  | 'reconnect_diff'
  | 'leave'
  | 'operation'
  | 'batch_operation'
  | 'viewport_update'
  | 'cursor_update'
  | 'elements_in_viewport'
  | 'viewport_diff'
  | 'create_element'
  | 'create_element_response'
  | 'elements_removed'
  | 'user_joined'
  | 'user_left'
  | 'sync_ack'
  | 'room_status'
  | 'error';

export interface WSMessage<T = any> {
  type: WSMessageType;
  data: T;
  timestamp?: number;
}

export interface OperationMessage {
  roomId: string;
  operation: WhiteboardOperation;
}

export interface BatchOperationMessage {
  roomId: string;
  operations: WhiteboardOperation[];
}

export interface ViewportUpdateMessage {
  roomId: string;
  viewport: Viewport;
}

export interface CursorUpdateMessage {
  roomId: string;
  position: Point;
}

export interface ElementsInViewportMessage {
  elements: WhiteboardElement[];
  viewport: Viewport;
  timestamp: number;
}

export interface SyncAckMessage {
  operationId: string;
  accepted: boolean;
  reason?: string;
  serverVersion?: number;
  serverElement?: WhiteboardElement;
  conflictType?: 'version_mismatch' | 'lock_held' | 'not_found' | 'invalid' | 'duplicate_id';
  acceptedBy?: string;
}

export type ElementCreateInput =
  | Omit<RectangleElement, 'id' | 'zIndex' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version'>
  | Omit<CircleElement, 'id' | 'zIndex' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version'>
  | Omit<LineElement, 'id' | 'zIndex' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version'>
  | Omit<TextElement, 'id' | 'zIndex' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version'>
  | Omit<PathElement, 'id' | 'zIndex' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version'>
  | Omit<ImageElement, 'id' | 'zIndex' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version'>;

export interface CreateElementMessage {
  roomId: string;
  element: ElementCreateInput;
  requestId?: string;
}

export interface CreateElementResponse {
  success: boolean;
  element?: WhiteboardElement;
  requestId?: string;
  error?: string;
}

export interface ViewportDiffMessage {
  viewport: Viewport;
  added: WhiteboardElement[];
  removed: string[];
  updated: WhiteboardElement[];
  timestamp: number;
}

export interface ElementsRemovedMessage {
  elementIds: string[];
  reason?: 'moved_out' | 'deleted';
  timestamp: number;
}

export interface ElementsAddedMessage {
  elements: WhiteboardElement[];
  reason?: 'moved_in' | 'created';
  timestamp: number;
}

export interface ReconnectMessage {
  roomId: string;
  userId: string;
  userName: string;
  viewport: Viewport;
  lastSyncTimestamp: number;
}

export interface ReconnectDiffMessage {
  success: boolean;
  viewport: Viewport;
  added: WhiteboardElement[];
  removed: string[];
  updated: WhiteboardElement[];
  operations: WhiteboardOperation[];
  users: UserState[];
  fromTimestamp: number;
  toTimestamp: number;
  isFullSync: boolean;
  error?: string;
}

export interface JoinResponse {
  success: boolean;
  roomId: string;
  user: UserState;
  users: UserState[];
  elements: WhiteboardElement[];
  viewport: Viewport;
  isNewRoom: boolean;
  isSnapshotRestored: boolean;
  canIncrementalSync: boolean;
  lastSyncTimestamp: number;
  error?: string;
}

export interface RoomStatusMessage {
  roomId: string;
  onlineUserCount: number;
  elementCount: number;
  lastActiveAt: number;
  earliestHistoryTimestamp: number;
  canIncrementalSync: boolean;
  expiresAt?: number;
}

export interface RoomStatusQueryMessage {
  roomId: string;
}

export interface JoinMessage {
  roomId: string;
  userId: string;
  userName: string;
  viewport: Viewport;
  lastSyncTimestamp?: number;
}
