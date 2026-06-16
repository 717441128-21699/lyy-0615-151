import {
  UserState,
  Viewport,
  WhiteboardElement,
  WhiteboardOperation,
  WSMessage,
} from './types';
import { ElementManager } from './element-manager';
import { OperationProcessor, OperationResult } from './operation-processor';
import { ViewportManager } from './viewport-manager';
import { OperationBatcher } from './operation-batcher';

export type BroadcastCallback = (
  roomId: string,
  message: WSMessage,
  excludeUserIds?: string[]
) => void;

export type SendToUserCallback = (
  userId: string,
  message: WSMessage
) => void;

export class Room {
  id: string;
  name: string;

  private elementManager: ElementManager;
  private operationProcessor: OperationProcessor;
  private viewportManager: ViewportManager;
  private operationBatcher: OperationBatcher;

  private users: Map<string, UserState> = new Map();
  private broadcastCallback: BroadcastCallback;
  private sendToUserCallback: SendToUserCallback;

  private viewportUpdateTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly viewportUpdateDebounce: number = 100;

  constructor(
    id: string,
    name: string,
    broadcastCallback: BroadcastCallback,
    sendToUserCallback: SendToUserCallback,
    workerId: number = 0
  ) {
    this.id = id;
    this.name = name;
    this.broadcastCallback = broadcastCallback;
    this.sendToUserCallback = sendToUserCallback;

    this.elementManager = new ElementManager(undefined, workerId);
    this.operationProcessor = new OperationProcessor(this.elementManager);
    this.viewportManager = new ViewportManager(this.elementManager);
    this.operationBatcher = new OperationBatcher((operations, userId) => {
      this.handleBatchFlush(operations, userId);
    });
  }

  addUser(userId: string, userName: string, viewport: Viewport): UserState {
    const user: UserState = {
      id: userId,
      name: userName,
      color: this.generateUserColor(userId),
      viewport,
      lastActive: Date.now(),
    };

    this.users.set(userId, user);
    this.viewportManager.setUserViewport(userId, viewport);

    const elementsData = this.viewportManager.getElementsForUser(userId);
    if (elementsData) {
      this.sendToUserCallback(userId, {
        type: 'elements_in_viewport',
        data: {
          elements: elementsData.elements,
          viewport: elementsData.viewport,
          timestamp: elementsData.timestamp,
        },
        timestamp: Date.now(),
      });
    }

    this.broadcastUserJoined(user);

    return user;
  }

  removeUser(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    this.users.delete(userId);
    this.viewportManager.removeUser(userId);
    this.operationBatcher.removeUser(userId);
    this.operationProcessor.clearAllLocks();

    const timer = this.viewportUpdateTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.viewportUpdateTimers.delete(userId);
    }

    this.broadcastUserLeft(userId);

    return true;
  }

  getUser(userId: string): UserState | undefined {
    return this.users.get(userId);
  }

  getAllUsers(): UserState[] {
    return Array.from(this.users.values());
  }

  getUserCount(): number {
    return this.users.size;
  }

  handleOperation(userId: string, operation: WhiteboardOperation): void {
    this.operationBatcher.addOperation(userId, operation);
  }

  handleViewportUpdate(userId: string, viewport: Viewport): void {
    const user = this.users.get(userId);
    if (!user) return;

    user.viewport = viewport;
    user.lastActive = Date.now();

    const existingTimer = this.viewportUpdateTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.processViewportUpdate(userId, viewport);
      this.viewportUpdateTimers.delete(userId);
    }, this.viewportUpdateDebounce);

    this.viewportUpdateTimers.set(userId, timer);
  }

  private processViewportUpdate(userId: string, viewport: Viewport): void {
    const change = this.viewportManager.setUserViewport(userId, viewport);

    if (change) {
      const elementsData = this.viewportManager.getElementsForUser(userId);
      if (elementsData) {
        this.sendToUserCallback(userId, {
          type: 'elements_in_viewport',
          data: {
            elements: elementsData.elements,
            viewport: elementsData.viewport,
            timestamp: elementsData.timestamp,
          },
          timestamp: Date.now(),
        });
      }
    }
  }

  handleCursorUpdate(userId: string, position: { x: number; y: number }): void {
    const user = this.users.get(userId);
    if (!user) return;

    user.cursor = position;
    user.lastActive = Date.now();

    this.broadcastCursorUpdate(userId, position);
  }

  private handleBatchFlush(operations: WhiteboardOperation[], userId: string): void {
    const results: OperationResult[] = [];

    for (const op of operations) {
      const result = this.operationProcessor.process(op);
      results.push(result);

      if (result.success && result.element) {
        this.sendSyncAck(userId, op.id, true, result.element.version);
      } else if (!result.success) {
        this.sendSyncAck(userId, op.id, false, undefined, result.error);
      }
    }

    this.broadcastOperations(results, userId);
  }

  private broadcastOperations(results: OperationResult[], sourceUserId: string): void {
    const successfulResults = results.filter((r) => r.success && r.element);

    if (successfulResults.length === 0) return;

    const affectedUserIds = new Set<string>();

    for (const result of successfulResults) {
      if (result.element) {
        const users = this.viewportManager.getUsersInElementArea(result.element);
        users.forEach((uid) => {
          if (uid !== sourceUserId) {
            affectedUserIds.add(uid);
          }
        });
      }
    }

    const operations = successfulResults
      .map((r) => r.operation)
      .filter((op): op is WhiteboardOperation => op !== undefined);

    if (affectedUserIds.size > 0 && operations.length > 0) {
      const message: WSMessage = {
        type: operations.length === 1 ? 'operation' : 'batch_operation',
        data: operations.length === 1 ? operations[0] : { operations },
        timestamp: Date.now(),
      };

      for (const userId of affectedUserIds) {
        this.sendToUserCallback(userId, message);
      }
    }
  }

  private sendSyncAck(
    userId: string,
    operationId: string,
    accepted: boolean,
    serverVersion?: number,
    reason?: string
  ): void {
    this.sendToUserCallback(userId, {
      type: 'sync_ack',
      data: {
        operationId,
        accepted,
        reason,
        serverVersion,
      },
      timestamp: Date.now(),
    });
  }

  private broadcastUserJoined(user: UserState): void {
    this.broadcastCallback(
      this.id,
      {
        type: 'user_joined',
        data: { user },
        timestamp: Date.now(),
      },
      [user.id]
    );
  }

  private broadcastUserLeft(userId: string): void {
    this.broadcastCallback(
      this.id,
      {
        type: 'user_left',
        data: { userId },
        timestamp: Date.now(),
      },
      [userId]
    );
  }

  private broadcastCursorUpdate(userId: string, position: { x: number; y: number }): void {
    const user = this.users.get(userId);
    if (!user) return;

    const viewport = this.viewportManager.getUserViewport(userId);
    if (!viewport) return;

    const nearbyUsers = this.viewportManager.getUsersInRect({
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: viewport.height,
    });

    if (nearbyUsers.length <= 1) return;

    const message: WSMessage = {
      type: 'cursor_update',
      data: {
        userId,
        userName: user.name,
        color: user.color,
        position,
      },
      timestamp: Date.now(),
    };

    for (const uid of nearbyUsers) {
      if (uid !== userId) {
        this.sendToUserCallback(uid, message);
      }
    }
  }

  generateElementId(): string {
    return this.elementManager.generateId();
  }

  getNextZIndex(): number {
    return this.elementManager.getNextZIndex();
  }

  getElementsCount(): number {
    return this.elementManager.getElementsCount();
  }

  getAllElements(): WhiteboardElement[] {
    return this.elementManager.getAllElements();
  }

  getElementManager(): ElementManager {
    return this.elementManager;
  }

  getOperationProcessor(): OperationProcessor {
    return this.operationProcessor;
  }

  getViewportManager(): ViewportManager {
    return this.viewportManager;
  }

  destroy(): void {
    this.operationBatcher.clear();
    this.operationProcessor.clearAllLocks();
    this.viewportManager.clear();
    this.users.clear();

    for (const timer of this.viewportUpdateTimers.values()) {
      clearTimeout(timer);
    }
    this.viewportUpdateTimers.clear();
  }

  private generateUserColor(userId: string): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
    ];

    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }

    return colors[Math.abs(hash) % colors.length];
  }
}
