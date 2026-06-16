import {
  WhiteboardOperation,
  WhiteboardElement,
  CreateOperation,
  DeleteOperation,
  MoveOperation,
  UpdateOperation,
  ReorderOperation,
  ResizeOperation,
  Rect,
  SyncAckMessage,
} from './types';
import { ElementManager } from './element-manager';

export type ConflictType = 'version_mismatch' | 'lock_held' | 'not_found' | 'invalid' | 'duplicate_id';

export interface OperationResult {
  success: boolean;
  operation: WhiteboardOperation;
  element?: WhiteboardElement;
  error?: string;
  needsTransform?: boolean;
  transformedOperation?: WhiteboardOperation;
  oldRect?: Rect;
  newRect?: Rect;
  operationType?: 'create' | 'delete' | 'move' | 'resize' | 'update' | 'reorder';
  conflictType?: ConflictType;
  serverVersion?: number;
  serverElement?: WhiteboardElement;
  acceptedBy?: string;
}

export interface OperationHistoryEntry {
  operation: WhiteboardOperation;
  elementAfter?: WhiteboardElement;
  elementBefore?: WhiteboardElement;
  oldRect?: Rect;
  newRect?: Rect;
}

export class OperationProcessor {
  private elementManager: ElementManager;
  private operationHistory: OperationHistoryEntry[] = [];
  private maxHistorySize: number = 100000;
  private elementLocks: Map<string, string> = new Map();
  private lockTimers: Map<string, NodeJS.Timeout> = new Map();
  private lockTimeout: number = 5000;

  constructor(elementManager: ElementManager) {
    this.elementManager = elementManager;
  }

  process(operation: WhiteboardOperation): OperationResult {
    if (this.elementLocks.has(operation.elementId)) {
      const lockHolder = this.elementLocks.get(operation.elementId);
      if (lockHolder && lockHolder !== operation.userId) {
        return {
          success: false,
          operation,
          error: `Element is locked by user ${lockHolder}`,
          conflictType: 'lock_held',
          acceptedBy: lockHolder,
          element: this.elementManager.getElement(operation.elementId),
        } as OperationResult;
      }
    }

    switch (operation.type) {
      case 'create':
        return this.processCreate(operation as CreateOperation);
      case 'delete':
        return this.processDelete(operation as DeleteOperation);
      case 'move':
        return this.processMove(operation as MoveOperation);
      case 'resize':
        return this.processResize(operation as ResizeOperation);
      case 'update':
        return this.processUpdate(operation as UpdateOperation);
      case 'reorder':
        return this.processReorder(operation as ReorderOperation);
      default:
        return {
          success: false,
          operation,
          error: 'Unknown operation type',
          conflictType: 'invalid',
        };
    }
  }

  private addToHistory(entry: OperationHistoryEntry): void {
    this.operationHistory.push(entry);

    if (this.operationHistory.length > this.maxHistorySize) {
      this.operationHistory.splice(0, this.operationHistory.length - this.maxHistorySize);
    }
  }

  private processCreate(op: CreateOperation): OperationResult {
    if (this.elementManager.hasElement(op.elementId)) {
      return {
        success: false,
        operation: op,
        error: 'Element with this ID already exists',
        operationType: 'create',
        conflictType: 'duplicate_id',
        serverElement: this.elementManager.getElement(op.elementId),
      };
    }

    const element = { ...op.element, version: 1 };
    const result = this.elementManager.addElement(element);

    const newRect: Rect = {
      x: result.x,
      y: result.y,
      width: result.width,
      height: result.height,
    };

    this.addToHistory({
      operation: op,
      elementAfter: result,
      newRect,
    });

    return {
      success: true,
      operation: op,
      element: result,
      newRect,
      operationType: 'create',
      serverVersion: result.version,
    };
  }

  private processDelete(op: DeleteOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
        operationType: 'delete',
        conflictType: 'not_found',
      };
    }

    if (op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: `Version conflict: expected v${op.version}, server has v${element.version}`,
        needsTransform: true,
        operationType: 'delete',
        conflictType: 'version_mismatch',
        serverVersion: element.version,
        serverElement: { ...element },
        acceptedBy: element.updatedBy,
      };
    }

    const oldRect: Rect = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    const success = this.elementManager.deleteElement(op.elementId);

    if (success) {
      this.addToHistory({
        operation: op,
        elementBefore: { ...element },
        oldRect,
      });

      return {
        success: true,
        operation: op,
        element,
        oldRect,
        operationType: 'delete',
        serverVersion: 0,
      };
    }

    return {
      success: false,
      operation: op,
      error: 'Delete failed',
      operationType: 'delete',
      conflictType: 'invalid',
    };
  }

  private processMove(op: MoveOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
        operationType: 'move',
        conflictType: 'not_found',
      };
    }

    const oldRect: Rect = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    if (op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: `Version conflict: expected v${op.version}, server has v${element.version}`,
        operationType: 'move',
        conflictType: 'version_mismatch',
        serverVersion: element.version,
        serverElement: { ...element },
        acceptedBy: element.updatedBy,
      };
    }

    const result = this.elementManager.moveElement(op.elementId, op.dx, op.dy);

    if (result) {
      const newRect: Rect = {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      };

      this.addToHistory({
        operation: op,
        elementBefore: { ...element },
        elementAfter: result,
        oldRect,
        newRect,
      });

      return {
        success: true,
        operation: op,
        element: result,
        oldRect,
        newRect,
        operationType: 'move',
        serverVersion: result.version,
        acceptedBy: op.userId,
      };
    }

    return {
      success: false,
      operation: op,
      error: 'Move failed',
      operationType: 'move',
      conflictType: 'invalid',
    };
  }

  private transformMoveOperation(
    op: MoveOperation,
    currentElement: WhiteboardElement,
    oldRect: Rect
  ): OperationResult {
    const transformedOp: MoveOperation = {
      ...op,
      newX: op.newX,
      newY: op.newY,
      version: currentElement.version,
    };

    const result = this.elementManager.updateElement(op.elementId, {
      x: op.newX,
      y: op.newY,
    });

    if (result) {
      const newRect: Rect = {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      };

      this.addToHistory({
        operation: transformedOp,
        elementBefore: { ...currentElement },
        elementAfter: result,
        oldRect,
        newRect,
      });

      return {
        success: true,
        operation: transformedOp,
        element: result,
        transformedOperation: transformedOp,
        oldRect,
        newRect,
        operationType: 'move',
        serverVersion: result.version,
        conflictType: 'version_mismatch',
        serverElement: { ...currentElement },
        acceptedBy: op.userId,
      };
    }

    return {
      success: false,
      operation: op,
      error: 'Transform move failed',
      operationType: 'move',
      conflictType: 'invalid',
    };
  }

  private processResize(op: ResizeOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
        operationType: 'resize',
        conflictType: 'not_found',
      };
    }

    const oldRect: Rect = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    if (op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: `Version conflict: expected v${op.version}, server has v${element.version}`,
        needsTransform: true,
        operationType: 'resize',
        conflictType: 'version_mismatch',
        serverVersion: element.version,
        serverElement: { ...element },
        acceptedBy: element.updatedBy,
      };
    }

    const result = this.elementManager.resizeElement(
      op.elementId,
      op.newWidth,
      op.newHeight
    );

    if (result) {
      const newRect: Rect = {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      };

      this.addToHistory({
        operation: op,
        elementBefore: { ...element },
        elementAfter: result,
        oldRect,
        newRect,
      });

      return {
        success: true,
        operation: op,
        element: result,
        oldRect,
        newRect,
        operationType: 'resize',
        serverVersion: result.version,
      };
    }

    return {
      success: false,
      operation: op,
      error: 'Resize failed',
      operationType: 'resize',
      conflictType: 'invalid',
    };
  }

  private processUpdate(op: UpdateOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
        operationType: 'update',
        conflictType: 'not_found',
      };
    }

    if (op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: `Version conflict: expected v${op.version}, server has v${element.version}`,
        needsTransform: true,
        operationType: 'update',
        conflictType: 'version_mismatch',
        serverVersion: element.version,
        serverElement: { ...element },
        acceptedBy: element.updatedBy,
      };
    }

    const result = this.elementManager.updateElement(
      op.elementId,
      op.properties
    );

    if (result) {
      this.addToHistory({
        operation: op,
        elementBefore: { ...element },
        elementAfter: result,
      });

      return {
        success: true,
        operation: op,
        element: result,
        operationType: 'update',
        serverVersion: result.version,
      };
    }

    return {
      success: false,
      operation: op,
      error: 'Update failed',
      operationType: 'update',
      conflictType: 'invalid',
    };
  }

  private processReorder(op: ReorderOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
        operationType: 'reorder',
        conflictType: 'not_found',
      };
    }

    if (op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: `Version conflict: expected v${op.version}, server has v${element.version}`,
        needsTransform: true,
        operationType: 'reorder',
        conflictType: 'version_mismatch',
        serverVersion: element.version,
        serverElement: { ...element },
        acceptedBy: element.updatedBy,
      };
    }

    const result = this.elementManager.reorderElement(
      op.elementId,
      op.newZIndex
    );

    if (result) {
      this.addToHistory({
        operation: op,
        elementBefore: { ...element },
        elementAfter: result,
      });

      return {
        success: true,
        operation: op,
        element: result,
        operationType: 'reorder',
        serverVersion: result.version,
      };
    }

    return {
      success: false,
      operation: op,
      error: 'Reorder failed',
      operationType: 'reorder',
      conflictType: 'invalid',
    };
  }

  processBatch(operations: WhiteboardOperation[]): OperationResult[] {
    return operations.map((op) => this.process(op));
  }

  getOperationHistory(): OperationHistoryEntry[] {
    return [...this.operationHistory];
  }

  getHistorySince(timestamp: number): OperationHistoryEntry[] {
    return this.operationHistory.filter((entry) => entry.operation.timestamp > timestamp);
  }

  getHistorySize(): number {
    return this.operationHistory.length;
  }

  getEarliestHistoryTimestamp(): number {
    if (this.operationHistory.length === 0) {
      return Number.MAX_SAFE_INTEGER;
    }
    return this.operationHistory[0].operation.timestamp;
  }

  acquireLock(elementId: string, userId: string): boolean {
    const currentLock = this.elementLocks.get(elementId);

    if (currentLock && currentLock !== userId) {
      return false;
    }

    this.elementLocks.set(elementId, userId);

    const existingTimer = this.lockTimers.get(elementId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.releaseLock(elementId, userId);
    }, this.lockTimeout);

    this.lockTimers.set(elementId, timer);

    return true;
  }

  releaseLock(elementId: string, userId: string): boolean {
    const currentLock = this.elementLocks.get(elementId);

    if (currentLock !== userId) {
      return false;
    }

    this.elementLocks.delete(elementId);

    const timer = this.lockTimers.get(elementId);
    if (timer) {
      clearTimeout(timer);
      this.lockTimers.delete(elementId);
    }

    return true;
  }

  isLocked(elementId: string): boolean {
    return this.elementLocks.has(elementId);
  }

  getLockHolder(elementId: string): string | undefined {
    return this.elementLocks.get(elementId);
  }

  clearAllLocks(): void {
    this.lockTimers.forEach((timer) => clearTimeout(timer));
    this.lockTimers.clear();
    this.elementLocks.clear();
  }

  buildSyncAck(result: OperationResult): SyncAckMessage {
    return {
      operationId: result.operation.id,
      accepted: result.success,
      reason: result.error,
      serverVersion: result.serverVersion,
      serverElement: result.serverElement ?? result.element,
      conflictType: result.conflictType,
      acceptedBy: result.acceptedBy,
    };
  }

  recordExternalCreate(element: WhiteboardElement, userId: string): void {
    const op: WhiteboardOperation = {
      id: `create-${element.id}`,
      type: 'create',
      elementId: element.id,
      element,
      userId,
      timestamp: element.updatedAt || Date.now(),
      version: element.version,
    };
    const rect: Rect = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
    this.addToHistory({
      operation: op,
      elementAfter: element,
      newRect: rect,
    });
  }
}
