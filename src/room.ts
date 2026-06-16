import {
  UserState,
  Viewport,
  WhiteboardElement,
  WhiteboardOperation,
  WSMessage,
  ElementCreateInput,
  CreateElementMessage,
  CreateElementResponse,
  ViewportDiffMessage,
  ElementsRemovedMessage,
  Rect,
  MoveOperation,
} from './types';
import { ElementManager } from './element-manager';
import { OperationProcessor, OperationResult } from './operation-processor';
import { ViewportManager, ElementViewportChange } from './viewport-manager';
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

  handleCreateElement(userId: string, message: CreateElementMessage): void {
    try {
      const element = this.elementManager.createElement(message.element, userId);

      const usersToNotify = this.viewportManager.onElementCreated(element);

      this.sendToUserCallback(userId, {
        type: 'create_element_response',
        data: {
          success: true,
          element,
          requestId: message.requestId,
        } as CreateElementResponse,
        timestamp: Date.now(),
      });

      for (const uid of usersToNotify) {
        if (uid !== userId) {
          this.sendToUserCallback(uid, {
            type: 'operation',
            data: {
              type: 'create',
              id: element.id,
              elementId: element.id,
              element,
              userId,
              timestamp: Date.now(),
              version: element.version,
            },
            timestamp: Date.now(),
          });
        }
      }
    } catch (error) {
      this.sendToUserCallback(userId, {
        type: 'create_element_response',
        data: {
          success: false,
          requestId: message.requestId,
          error: error instanceof Error ? error.message : 'Unknown error',
        } as CreateElementResponse,
        timestamp: Date.now(),
      });
    }
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
      const diff = this.viewportManager.getViewportDiffForUser(userId);

      if (diff) {
        this.sendToUserCallback(userId, {
          type: 'viewport_diff',
          data: diff as ViewportDiffMessage,
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

    for (const result of successfulResults) {
      if (!result.element || !result.operationType) continue;

      switch (result.operationType) {
        case 'create':
          this.handleCreateBroadcast(result, sourceUserId);
          break;
        case 'delete':
          this.handleDeleteBroadcast(result, sourceUserId);
          break;
        case 'move':
          this.handleMoveBroadcast(result, sourceUserId);
          break;
        case 'resize':
        case 'update':
        case 'reorder':
          this.handleUpdateBroadcast(result, sourceUserId);
          break;
      }
    }
  }

  private handleCreateBroadcast(result: OperationResult, sourceUserId: string): void {
    if (!result.element || !result.newRect) return;

    const usersToNotify = this.viewportManager.onElementCreated(result.element);

    const message: WSMessage = {
      type: 'operation',
      data: result.operation,
      timestamp: Date.now(),
    };

    for (const uid of usersToNotify) {
      if (uid !== sourceUserId) {
        this.sendToUserCallback(uid, message);
      }
    }
  }

  private handleDeleteBroadcast(result: OperationResult, sourceUserId: string): void {
    if (!result.element || !result.oldRect) return;

    const usersToNotify = this.viewportManager.onElementDeleted(result.element.id, result.oldRect);

    const removeMessage: WSMessage = {
      type: 'elements_removed',
      data: {
        elementIds: [result.element.id],
        reason: 'deleted',
        timestamp: Date.now(),
      } as ElementsRemovedMessage,
      timestamp: Date.now(),
    };

    for (const uid of usersToNotify) {
      if (uid !== sourceUserId) {
        this.sendToUserCallback(uid, removeMessage);
      }
    }
  }

  private handleMoveBroadcast(result: OperationResult, sourceUserId: string): void {
    if (!result.element || !result.oldRect || !result.newRect) return;

    const viewportChange = this.viewportManager.onElementMoved(
      sourceUserId,
      result.element,
      result.oldRect,
      result.newRect
    );

    const moveOp = result.operation as MoveOperation;

    if (viewportChange.usersLeaving.length > 0) {
      const removeMessage: WSMessage = {
        type: 'elements_removed',
        data: {
          elementIds: [result.element.id],
          reason: 'moved_out',
          timestamp: Date.now(),
        } as ElementsRemovedMessage,
        timestamp: Date.now(),
      };

      for (const uid of viewportChange.usersLeaving) {
        if (uid !== sourceUserId) {
          this.sendToUserCallback(uid, removeMessage);
        }
      }
    }

    if (viewportChange.usersEntering.length > 0) {
      const enterMessage: WSMessage = {
        type: 'operation',
        data: {
          ...moveOp,
          type: 'create',
          element: result.element,
        },
        timestamp: Date.now(),
      };

      for (const uid of viewportChange.usersEntering) {
        if (uid !== sourceUserId) {
          this.sendToUserCallback(uid, enterMessage);
        }
      }
    }

    if (viewportChange.usersStaying.length > 0) {
      const updateMessage: WSMessage = {
        type: 'operation',
        data: moveOp,
        timestamp: Date.now(),
      };

      for (const uid of viewportChange.usersStaying) {
        if (uid !== sourceUserId) {
          this.sendToUserCallback(uid, updateMessage);
        }
      }
    }
  }

  private handleUpdateBroadcast(result: OperationResult, sourceUserId: string): void {
    if (!result.element) return;

    const usersToNotify = this.viewportManager.onElementUpdated(result.element);

    const message: WSMessage = {
      type: 'operation',
      data: result.operation,
      timestamp: Date.now(),
    };

    for (const uid of usersToNotify) {
      if (uid !== sourceUserId) {
        this.sendToUserCallback(uid, message);
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
