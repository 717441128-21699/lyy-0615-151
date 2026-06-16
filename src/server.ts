import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import {
  WSMessage,
  JoinMessage,
  OperationMessage,
  BatchOperationMessage,
  ViewportUpdateMessage,
  CursorUpdateMessage,
  CreateElementMessage,
  ReconnectMessage,
  RoomStatusQueryMessage,
  WSMessageType,
} from './types';
import { Room } from './room';

interface ClientConnection {
  id: string;
  userId: string;
  roomId: string | null;
  ws: WebSocket;
  lastPing: number;
}

export class WhiteboardServer {
  private wss: WebSocketServer;
  private rooms: Map<string, Room> = new Map();
  private clients: Map<string, ClientConnection> = new Map();
  private workerId: number;

  private readonly pingInterval: number = 30000;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(server?: HttpServer, port?: number, workerId: number = 0) {
    this.workerId = workerId;

    if (server) {
      this.wss = new WebSocketServer({ server });
    } else if (port) {
      this.wss = new WebSocketServer({ port });
    } else {
      this.wss = new WebSocketServer({ port: 8080 });
    }

    this.setupEventHandlers();
    this.startHeartbeat();
  }

  private setupEventHandlers(): void {
    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });

    this.wss.on('listening', () => {
      console.log('Whiteboard WebSocket server is listening');
    });
  }

  private handleConnection(ws: WebSocket, req: any): void {
    const clientId = this.generateClientId();

    const client: ClientConnection = {
      id: clientId,
      userId: '',
      roomId: null,
      ws,
      lastPing: Date.now(),
    };

    this.clients.set(clientId, client);

    console.log(`Client connected: ${clientId}`);

    ws.on('message', (data) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      this.handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
      console.error(`Client ${clientId} error:`, error);
    });

    ws.on('pong', () => {
      client.lastPing = Date.now();
    });
  }

  private handleMessage(clientId: string, data: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message: WSMessage = JSON.parse(data.toString());
      this.handleParsedMessage(client, message);
    } catch (error) {
      console.error('Failed to parse message:', error);
      this.sendToClient(clientId, {
        type: 'error',
        data: { message: 'Invalid message format' },
        timestamp: Date.now(),
      });
    }
  }

  private handleParsedMessage(client: ClientConnection, message: WSMessage): void {
    switch (message.type) {
      case 'join':
        this.handleJoin(client, message.data as JoinMessage);
        break;
      case 'leave':
        this.handleLeave(client);
        break;
      case 'operation':
        this.handleOperation(client, message.data as OperationMessage);
        break;
      case 'batch_operation':
        this.handleBatchOperation(client, message.data as BatchOperationMessage);
        break;
      case 'viewport_update':
        this.handleViewportUpdate(client, message.data as ViewportUpdateMessage);
        break;
      case 'cursor_update':
        this.handleCursorUpdate(client, message.data as CursorUpdateMessage);
        break;
      case 'create_element':
        this.handleCreateElement(client, message.data as CreateElementMessage);
        break;
      case 'reconnect':
        this.handleReconnect(client, message.data as ReconnectMessage);
        break;
      case 'room_status':
        this.handleRoomStatusQuery(client, message.data as RoomStatusQueryMessage);
        break;
      default:
        this.sendToClient(client.id, {
          type: 'error',
          data: { message: 'Unknown message type' },
          timestamp: Date.now(),
        });
    }
  }

  private handleJoin(client: ClientConnection, data: JoinMessage): void {
    const { roomId, userId, userName, viewport } = data;

    if (!roomId || !userId || !userName) {
      this.sendToClient(client.id, {
        type: 'error',
        data: { message: 'Missing required fields: roomId, userId, userName' },
        timestamp: Date.now(),
      });
      return;
    }

    if (client.roomId) {
      this.handleLeave(client);
    }

    client.userId = userId;
    client.roomId = roomId;

    let room = this.rooms.get(roomId);
    let isNewRoom = false;
    if (!room) {
      room = new Room(
        roomId,
        roomId,
        (roomId, message, excludeIds) => {
          this.broadcastToRoom(roomId, message, excludeIds);
        },
        (userId, message) => {
          this.sendToUserInRoom(roomId, userId, message);
        },
        this.workerId
      );
      room.setOnExpire(() => {
        this.rooms.delete(roomId);
        console.log(`Room expired and removed: ${roomId}`);
      });
      this.rooms.set(roomId, room);
      isNewRoom = true;
      console.log(`Room created: ${roomId}`);
    }

    const wasExpired = room.getIsExpired();
    const user = room.addUser(userId, userName, viewport);
    const users = room.getAllUsers().filter((u) => u.id !== userId);
    const status = room.getStatus();

    const isSnapshotRestored = !isNewRoom && !wasExpired;

    this.sendToClient(client.id, {
      type: 'join',
      data: {
        success: true,
        roomId,
        user,
        users,
        isNewRoom,
        isSnapshotRestored,
        canIncrementalSync: status.canIncrementalSync,
        lastSyncTimestamp: status.lastActiveAt,
        elementsCount: room.getElementsCount(),
      },
      timestamp: Date.now(),
    });

    console.log(`User ${userId} joined room ${roomId}`);
  }

  private handleLeave(client: ClientConnection): void {
    if (!client.roomId || !client.userId) return;

    const room = this.rooms.get(client.roomId);
    if (room) {
      room.removeUser(client.userId);
    }

    client.roomId = null;
  }

  private handleOperation(client: ClientConnection, data: OperationMessage): void {
    if (!client.roomId || !client.userId) {
      this.sendToClient(client.id, {
        type: 'error',
        data: { message: 'Not joined a room' },
        timestamp: Date.now(),
      });
      return;
    }

    const room = this.rooms.get(client.roomId);
    if (!room) return;

    room.handleOperation(client.userId, data.operation);
  }

  private handleBatchOperation(client: ClientConnection, data: BatchOperationMessage): void {
    if (!client.roomId || !client.userId) {
      this.sendToClient(client.id, {
        type: 'error',
        data: { message: 'Not joined a room' },
        timestamp: Date.now(),
      });
      return;
    }

    const room = this.rooms.get(client.roomId);
    if (!room) return;

    for (const op of data.operations) {
      room.handleOperation(client.userId, op);
    }
  }

  private handleViewportUpdate(client: ClientConnection, data: ViewportUpdateMessage): void {
    if (!client.roomId || !client.userId) return;

    const room = this.rooms.get(client.roomId);
    if (!room) return;

    room.handleViewportUpdate(client.userId, data.viewport);
  }

  private handleCursorUpdate(client: ClientConnection, data: CursorUpdateMessage): void {
    if (!client.roomId || !client.userId) return;

    const room = this.rooms.get(client.roomId);
    if (!room) return;

    room.handleCursorUpdate(client.userId, data.position);
  }

  private handleCreateElement(client: ClientConnection, data: CreateElementMessage): void {
    if (!client.roomId || !client.userId) {
      this.sendToClient(client.id, {
        type: 'create_element_response',
        data: {
          success: false,
          requestId: data.requestId,
          error: 'Not joined a room',
        },
        timestamp: Date.now(),
      });
      return;
    }

    const room = this.rooms.get(client.roomId);
    if (!room) {
      this.sendToClient(client.id, {
        type: 'create_element_response',
        data: {
          success: false,
          requestId: data.requestId,
          error: 'Room not found',
        },
        timestamp: Date.now(),
      });
      return;
    }

    room.handleCreateElement(client.userId, data);
  }

  private handleReconnect(client: ClientConnection, data: ReconnectMessage): void {
    const { roomId, userId, userName, viewport } = data;

    if (!roomId || !userId || !userName) {
      this.sendToClient(client.id, {
        type: 'reconnect_diff',
        data: {
          success: false,
          error: 'Missing required fields: roomId, userId, userName',
          viewport,
          added: [],
          removed: [],
          updated: [],
          users: [],
          fromTimestamp: 0,
          toTimestamp: Date.now(),
          isFullSync: false,
        },
        timestamp: Date.now(),
      });
      return;
    }

    if (client.roomId && client.roomId !== roomId) {
      this.handleLeave(client);
    }

    client.userId = userId;
    client.roomId = roomId;

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(
        roomId,
        `Room ${roomId}`,
        (rid, msg, exclude) => this.broadcastToRoom(rid, msg, exclude),
        (uid, msg) => this.sendToUserInRoom(roomId, uid, msg),
        this.workerId
      );
      this.rooms.set(roomId, room);
      console.log(`Room created by reconnect: ${roomId}`);
    }

    const diff = room.reconnectUser(data);

    this.sendToClient(client.id, {
      type: 'reconnect_diff',
      data: diff,
      timestamp: Date.now(),
    });
  }

  private handleRoomStatusQuery(client: ClientConnection, data: RoomStatusQueryMessage): void {
    const { roomId } = data;

    if (!roomId) {
      this.sendToClient(client.id, {
        type: 'error',
        data: { message: 'Missing roomId' },
        timestamp: Date.now(),
      });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      this.sendToClient(client.id, {
        type: 'room_status',
        data: {
          roomId,
          onlineUserCount: 0,
          elementCount: 0,
          lastActiveAt: 0,
          earliestHistoryTimestamp: 0,
          canIncrementalSync: false,
          roomExists: false,
        },
        timestamp: Date.now(),
      });
      return;
    }

    const status = room.getStatus();
    this.sendToClient(client.id, {
      type: 'room_status',
      data: status,
      timestamp: Date.now(),
    });
  }

  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.log(`Client disconnected: ${clientId}`);

    if (client.roomId && client.userId) {
      const room = this.rooms.get(client.roomId);
      if (room) {
        room.removeUser(client.userId);
      }
    }

    this.clients.delete(clientId);
  }

  private sendToClient(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  private broadcastToRoom(
    roomId: string,
    message: WSMessage,
    excludeUserIds: string[] = []
  ): void {
    const excludeSet = new Set(excludeUserIds);

    for (const client of this.clients.values()) {
      if (
        client.roomId === roomId &&
        !excludeSet.has(client.userId) &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        try {
          client.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error(`Failed to broadcast to user ${client.userId}:`, error);
        }
      }
    }
  }

  private sendToUserInRoom(roomId: string, userId: string, message: WSMessage): void {
    for (const client of this.clients.values()) {
      if (
        client.roomId === roomId &&
        client.userId === userId &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        try {
          client.ws.send(JSON.stringify(message));
        } catch (error) {
          console.error(`Failed to send to user ${userId}:`, error);
        }
        break;
      }
    }
  }

  private startHeartbeat(): void {
    this.pingTimer = setInterval(() => {
      const now = Date.now();

      for (const client of this.clients.values()) {
        if (now - client.lastPing > this.pingInterval * 2) {
          console.log(`Client ${client.id} timed out`);
          client.ws.terminate();
          continue;
        }

        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      }
    }, this.pingInterval);
  }

  private generateClientId(): string {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const room of this.rooms.values()) {
      room.destroy();
    }
    this.rooms.clear();

    this.wss.close();
  }
}
