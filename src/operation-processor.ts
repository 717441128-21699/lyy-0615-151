import {
  WhiteboardOperation,
  WhiteboardElement,
  CreateOperation,
  DeleteOperation,
  MoveOperation,
  UpdateOperation,
  ReorderOperation,
  ResizeOperation,
} from './types';
import { ElementManager } from './element-manager';

export interface OperationResult {
  success: boolean;
  operation: WhiteboardOperation;
  element?: WhiteboardElement;
  error?: string;
  needsTransform?: boolean;
  transformedOperation?: WhiteboardOperation;
}

export class OperationProcessor {
  private elementManager: ElementManager;
  private operationHistory: WhiteboardOperation[] = [];
  private maxHistorySize: number = 10000;
  private elementLocks: Map<string, string> = new Map();
  private lockTimers: Map<string, NodeJS.Timeout> = new Map();
  private lockTimeout: number = 5000;

  constructor(elementManager: ElementManager) {
    this.elementManager = elementManager;
  }

  process(operation: WhiteboardOperation): OperationResult {
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
        return { success: false, operation, error: 'Unknown operation type' };
    }
  }

  private processCreate(op: CreateOperation): OperationResult {
    if (this.elementManager.hasElement(op.elementId)) {
      return {
        success: false,
        operation: op,
        error: 'Element with this ID already exists',
      };
    }

    const element = { ...op.element, version: 1 };
    const result = this.elementManager.addElement(element);

    this.addToHistory(op);

    return { success: true, operation: op, element: result };
  }

  private processDelete(op: DeleteOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
      };
    }

    if (op.version > 0 && op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: 'Version conflict',
        needsTransform: true,
      };
    }

    const success = this.elementManager.deleteElement(op.elementId);

    if (success) {
      this.addToHistory(op);
      return { success: true, operation: op, element };
    }

    return { success: false, operation: op, error: 'Delete failed' };
  }

  private processMove(op: MoveOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
      };
    }

    if (op.version > 0 && op.version !== element.version) {
      return this.transformMoveOperation(op, element);
    }

    const result = this.elementManager.moveElement(op.elementId, op.dx, op.dy);

    if (result) {
      this.addToHistory(op);
      return { success: true, operation: op, element: result };
    }

    return { success: false, operation: op, error: 'Move failed' };
  }

  private transformMoveOperation(
    op: MoveOperation,
    currentElement: WhiteboardElement
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
      this.addToHistory(transformedOp);
      return {
        success: true,
        operation: transformedOp,
        element: result,
        transformedOperation: transformedOp,
      };
    }

    return { success: false, operation: op, error: 'Transform move failed' };
  }

  private processResize(op: ResizeOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
      };
    }

    if (op.version > 0 && op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: 'Version conflict',
        needsTransform: true,
      };
    }

    const result = this.elementManager.resizeElement(
      op.elementId,
      op.newWidth,
      op.newHeight
    );

    if (result) {
      this.addToHistory(op);
      return { success: true, operation: op, element: result };
    }

    return { success: false, operation: op, error: 'Resize failed' };
  }

  private processUpdate(op: UpdateOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
      };
    }

    if (op.version > 0 && op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: 'Version conflict',
        needsTransform: true,
      };
    }

    const result = this.elementManager.updateElement(
      op.elementId,
      op.properties
    );

    if (result) {
      this.addToHistory(op);
      return { success: true, operation: op, element: result };
    }

    return { success: false, operation: op, error: 'Update failed' };
  }

  private processReorder(op: ReorderOperation): OperationResult {
    const element = this.elementManager.getElement(op.elementId);
    if (!element) {
      return {
        success: false,
        operation: op,
        error: 'Element not found',
      };
    }

    if (op.version > 0 && op.version !== element.version) {
      return {
        success: false,
        operation: op,
        error: 'Version conflict',
        needsTransform: true,
      };
    }

    const result = this.elementManager.reorderElement(
      op.elementId,
      op.newZIndex
    );

    if (result) {
      this.addToHistory(op);
      return { success: true, operation: op, element: result };
    }

    return { success: false, operation: op, error: 'Reorder failed' };
  }

  processBatch(operations: WhiteboardOperation[]): OperationResult[] {
    return operations.map((op) => this.process(op));
  }

  private addToHistory(operation: WhiteboardOperation): void {
    this.operationHistory.push(operation);

    if (this.operationHistory.length > this.maxHistorySize) {
      this.operationHistory.shift();
    }
  }

  getOperationHistory(): WhiteboardOperation[] {
    return [...this.operationHistory];
  }

  getHistorySince(timestamp: number): WhiteboardOperation[] {
    return this.operationHistory.filter((op) => op.timestamp > timestamp);
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
}
