import { WhiteboardElement, Rect } from './types';
import { QuadTree } from './quadtree';

export class SnowflakeIdGenerator {
  private epoch: number = 1609459200000;
  private workerId: number;
  private datacenterId: number;
  private sequence: number = 0;
  private lastTimestamp: number = -1;

  private readonly workerIdBits: number = 5;
  private readonly datacenterIdBits: number = 5;
  private readonly sequenceBits: number = 12;

  private readonly maxWorkerId: number = -1 ^ (-1 << this.workerIdBits);
  private readonly maxDatacenterId: number = -1 ^ (-1 << this.datacenterIdBits);
  private readonly sequenceMask: number = -1 ^ (-1 << this.sequenceBits);

  private readonly workerIdShift: number = this.sequenceBits;
  private readonly datacenterIdShift: number = this.sequenceBits + this.workerIdBits;
  private readonly timestampShift: number = this.sequenceBits + this.workerIdBits + this.datacenterIdBits;

  constructor(workerId: number = 0, datacenterId: number = 0) {
    if (workerId > this.maxWorkerId || workerId < 0) {
      throw new Error(`workerId must be between 0 and ${this.maxWorkerId}`);
    }
    if (datacenterId > this.maxDatacenterId || datacenterId < 0) {
      throw new Error(`datacenterId must be between 0 and ${this.maxDatacenterId}`);
    }
    this.workerId = workerId;
    this.datacenterId = datacenterId;
  }

  private tilNextMillis(lastTimestamp: number): number {
    let timestamp = this.currentTimestamp();
    while (timestamp <= lastTimestamp) {
      timestamp = this.currentTimestamp();
    }
    return timestamp;
  }

  private currentTimestamp(): number {
    return Date.now();
  }

  nextId(): string {
    let timestamp = this.currentTimestamp();

    if (timestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards. Refusing to generate id');
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & this.sequenceMask;
      if (this.sequence === 0) {
        timestamp = this.tilNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    const id =
      ((timestamp - this.epoch) << this.timestampShift) |
      (this.datacenterId << this.datacenterIdShift) |
      (this.workerId << this.workerIdShift) |
      this.sequence;

    return id.toString();
  }
}

export class ElementManager {
  private elements: Map<string, WhiteboardElement> = new Map();
  private quadtree: QuadTree;
  private idGenerator: SnowflakeIdGenerator;
  private maxZIndex: number = 0;
  private zIndexCounter: number = 0;

  constructor(
    canvasBounds: Rect = { x: -1000000, y: -1000000, width: 2000000, height: 2000000 },
    workerId: number = 0
  ) {
    this.quadtree = new QuadTree(canvasBounds);
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

  clear(): void {
    this.elements.clear();
    this.quadtree.clear();
    this.maxZIndex = 0;
    this.zIndexCounter = 0;
  }
}
