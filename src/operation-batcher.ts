import { WhiteboardOperation, MoveOperation } from './types';

export interface BatchFlushCallback {
  (operations: WhiteboardOperation[], userId: string): void;
}

interface UserBatchState {
  operations: WhiteboardOperation[];
  moveOperations: Map<string, MoveOperation>;
  timer: NodeJS.Timeout | null;
  lastFlush: number;
}

export class OperationBatcher {
  private userBatches: Map<string, UserBatchState> = new Map();
  private flushCallback: BatchFlushCallback;

  private readonly defaultDelay: number = 50;
  private readonly maxDelay: number = 200;
  private readonly maxBatchSize: number = 100;

  constructor(flushCallback: BatchFlushCallback) {
    this.flushCallback = flushCallback;
  }

  addOperation(userId: string, operation: WhiteboardOperation): void {
    const state = this.getOrCreateState(userId);

    if (operation.type === 'move') {
      this.mergeMoveOperation(state, operation as MoveOperation);
    } else {
      state.operations.push(operation);
    }

    if (state.operations.length >= this.maxBatchSize) {
      this.flush(userId);
      return;
    }

    if (!state.timer) {
      const delay = this.calculateDelay(state);
      state.timer = setTimeout(() => {
        this.flush(userId);
      }, delay);
    }
  }

  private getOrCreateState(userId: string): UserBatchState {
    let state = this.userBatches.get(userId);

    if (!state) {
      state = {
        operations: [],
        moveOperations: new Map(),
        timer: null,
        lastFlush: Date.now(),
      };
      this.userBatches.set(userId, state);
    }

    return state;
  }

  private mergeMoveOperation(state: UserBatchState, op: MoveOperation): void {
    const existing = state.moveOperations.get(op.elementId);

    if (existing) {
      const merged: MoveOperation = {
        ...op,
        dx: existing.dx + op.dx,
        dy: existing.dy + op.dy,
        newX: op.newX,
        newY: op.newY,
        version: op.version,
        timestamp: op.timestamp,
      };
      state.moveOperations.set(op.elementId, merged);
    } else {
      state.moveOperations.set(op.elementId, { ...op });
    }
  }

  private calculateDelay(state: UserBatchState): number {
    const timeSinceLastFlush = Date.now() - state.lastFlush;
    const remainingDelay = this.maxDelay - timeSinceLastFlush;

    return Math.max(this.defaultDelay, Math.min(remainingDelay, this.defaultDelay));
  }

  flush(userId: string): void {
    const state = this.userBatches.get(userId);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    const moveOps = Array.from(state.moveOperations.values());
    const allOperations = [...state.operations, ...moveOps];

    if (allOperations.length > 0) {
      allOperations.sort((a, b) => a.timestamp - b.timestamp);
      this.flushCallback(allOperations, userId);
    }

    state.operations = [];
    state.moveOperations.clear();
    state.lastFlush = Date.now();
  }

  flushAll(): void {
    for (const userId of this.userBatches.keys()) {
      this.flush(userId);
    }
  }

  cancelBatch(userId: string): void {
    const state = this.userBatches.get(userId);
    if (state && state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
      state.operations = [];
      state.moveOperations.clear();
    }
  }

  removeUser(userId: string): void {
    const state = this.userBatches.get(userId);
    if (state) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      this.userBatches.delete(userId);
    }
  }

  getPendingCount(userId: string): number {
    const state = this.userBatches.get(userId);
    if (!state) return 0;
    return state.operations.length + state.moveOperations.size;
  }

  clear(): void {
    for (const state of this.userBatches.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.userBatches.clear();
  }
}
