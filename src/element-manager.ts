import { WhiteboardElement, Rect, ElementCreateInput } from './types';
import { QuadTree } from './quadtree';

export class SnowflakeIdGenerator {
  private epoch: bigint = 1609459200000n;
  private workerId: bigint;
  private datacenterId: bigint;
  private sequence: bigint = 0n;
  private lastTimestamp: bigint = -1n;

  private readonly workerIdBits: bigint = 5n;
  private readonly datacenterIdBits: bigint = 5n;
  private readonly sequenceBits: bigint = 12n;

  private readonly maxWorkerId: bigint = ~(-1n << this.workerIdBits);
  private readonly maxDatacenterId: bigint = ~(-1n << this.datacenterIdBits);
  private readonly sequenceMask: bigint = ~(-1n << this.sequenceBits);

  private readonly workerIdShift: bigint = this.sequenceBits;
  private readonly datacenterIdShift: bigint = this.sequenceBits + this.workerIdBits;
  private readonly timestampShift: bigint = this.sequenceBits + this.workerIdBits + this.datacenterIdBits;

  private generatedIds: Set<string> = new Set();

  constructor(workerId: number = 0, datacenterId: number = 0) {
    const workerIdBig = BigInt(workerId);
    const datacenterIdBig = BigInt(datacenterId);

    if (workerIdBig > this.maxWorkerId || workerIdBig < 0n) {
      throw new Error(`workerId must be between 0 and ${this.maxWorkerId}`);
    }
    if (datacenterIdBig > this.maxDatacenterId || datacenterIdBig < 0n) {
      throw new Error(`datacenterId must be between 0 and ${this.maxDatacenterId}`);
    }
    this.workerId = workerIdBig;
    this.datacenterId = datacenterIdBig;
  }

  private tilNextMillis(lastTimestamp: bigint): bigint {
    let timestamp = this.currentTimestamp();
    while (timestamp <= lastTimestamp) {
      timestamp = this.currentTimestamp();
    }
    return timestamp;
  }

  private currentTimestamp(): bigint {
    return BigInt(Date.now());
  }

  nextId(): string {
    let timestamp = this.currentTimestamp();

    if (timestamp < this.lastTimestamp) {
      timestamp = this.tilNextMillis(this.lastTimestamp);
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & this.sequenceMask;
      if (this.sequence === 0n) {
        timestamp = this.tilNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const idBigInt =
      ((timestamp - this.epoch) << this.timestampShift) |
      (this.datacenterId << this.datacenterIdShift) |
      (this.workerId << this.workerIdShift) |
      this.sequence;

    const id = idBigInt.toString();

    if (this.generatedIds.has(id)) {
      return this.nextId();
    }
    this.generatedIds.add(id);

    if (this.generatedIds.size > 1000000) {
      this.generatedIds.clear();
    }

    return id;
  }

  isIdGenerated(id: string): boolean {
    return this.generatedIds.has(id);
  }
}

export class ElementManager {
  private elements: Map<string, WhiteboardElement> = new Map();
  private quadtree: QuadTree;
  private idGenerator: SnowflakeIdGenerator;
  private maxZIndex: number = 0;
  private zIndexCounter: number = 0;

  private readonly DEFAULT_BOUNDS: Rect = {
    x: -100000000,
    y: -100000000,
    width: 200000000,
    height: 200000000,
  };

  constructor(
    canvasBounds?: Rect,
    workerId: number = 0
  ) {
    const bounds = canvasBounds || this.DEFAULT_BOUNDS;
    this.quadtree = new QuadTree(bounds, 10, 12);
    this.idGenerator = new SnowflakeIdGenerator(workerId);
  }

  generateId(): string {
    return this.idGenerator.nextId();
  }

  getNextZIndex(): number {
    this.zIndexCounter++;
    this.maxZIndex = Math.max(this.maxZIndex, this.zIndexCounter);
    return this.zIndexCounter;
  }

  createElement(
    input: ElementCreateInput,
    userId: string
  ): WhiteboardElement {
    const id = this.generateId();
    const zIndex = this.getNextZIndex();
    const now = Date.now();

    const element = {
      ...input,
      id,
      zIndex,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      version: 1,
    } as WhiteboardElement;

    if (this.elements.has(element.id)) {
      throw new Error(`Element with id ${element.id} already exists`);
    }

    if (element.zIndex > this.maxZIndex) {
      this.maxZIndex = element.zIndex;
      this.zIndexCounter = element.zIndex;
    }

    this.elements.set(element.id, element);
    this.quadtree.insert(element);

    return element;
  }

  addElement(element: WhiteboardElement): WhiteboardElement {
    if (this.elements.has(element.id)) {
      throw new Error(`Element with id ${element.id} already exists`);
    }

    if (element.zIndex > this.maxZIndex) {
      this.maxZIndex = element.zIndex;
      this.zIndexCounter = element.zIndex;
    }

    this.elements.set(element.id, element);
    this.quadtree.insert(element);

    return element;
  }

  getElement(id: string): WhiteboardElement | undefined {
    return this.elements.get(id);
  }

  hasElement(id: string): boolean {
    return this.elements.has(id);
  }

  updateElement(id: string, updates: Partial<WhiteboardElement>): WhiteboardElement | null {
    const element = this.elements.get(id);
    if (!element) return null;

    const oldBounds = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    const updatedElement = { ...element, ...updates } as WhiteboardElement;
    updatedElement.version = element.version + 1;
    updatedElement.updatedAt = Date.now();

    const boundsChanged =
      updates.x !== undefined ||
      updates.y !== undefined ||
      updates.width !== undefined ||
      updates.height !== undefined;

    if (boundsChanged) {
      this.quadtree.remove(id);
      this.quadtree.insert(updatedElement);
    } else {
      this.quadtree.update(updatedElement);
    }

    this.elements.set(id, updatedElement);
    return updatedElement;
  }

  deleteElement(id: string): boolean {
    if (!this.elements.has(id)) return false;

    this.quadtree.remove(id);
    this.elements.delete(id);
    return true;
  }

  getElementsByViewport(viewport: Rect): WhiteboardElement[] {
    return this.quadtree.query(viewport);
  }

  getAllElements(): WhiteboardElement[] {
    return Array.from(this.elements.values());
  }

  getElementsCount(): number {
    return this.elements.size;
  }

  moveElement(id: string, dx: number, dy: number): WhiteboardElement | null {
    const element = this.elements.get(id);
    if (!element) return null;

    return this.updateElement(id, {
      x: element.x + dx,
      y: element.y + dy,
    });
  }

  moveElementTo(id: string, newX: number, newY: number): WhiteboardElement | null {
    return this.updateElement(id, { x: newX, y: newY });
  }

  resizeElement(id: string, newWidth: number, newHeight: number): WhiteboardElement | null {
    return this.updateElement(id, {
      width: newWidth,
      height: newHeight,
    });
  }

  reorderElement(id: string, newZIndex: number): WhiteboardElement | null {
    const element = this.elements.get(id);
    if (!element) return null;

    if (newZIndex > this.maxZIndex) {
      this.maxZIndex = newZIndex;
      this.zIndexCounter = newZIndex;
    }

    return this.updateElement(id, { zIndex: newZIndex });
  }

  bringToFront(id: string): WhiteboardElement | null {
    return this.reorderElement(id, this.getNextZIndex());
  }

  sendToBack(id: string): WhiteboardElement | null {
    return this.reorderElement(id, 0);
  }

  getMaxZIndex(): number {
    return this.maxZIndex;
  }

  getIdGenerator(): SnowflakeIdGenerator {
    return this.idGenerator;
  }

  getQuadtree(): QuadTree {
    return this.quadtree;
  }

  clear(): void {
    this.elements.clear();
    this.quadtree.clear();
    this.maxZIndex = 0;
    this.zIndexCounter = 0;
  }
}
