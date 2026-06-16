import { Rect, WhiteboardElement } from './types';

interface QuadTreeItem<T> {
  element: T;
  bounds: Rect;
}

export class QuadTree<T extends WhiteboardElement = WhiteboardElement> {
  private items: QuadTreeItem<T>[] = [];
  private children: QuadTree<T>[] = [];
  private isDivided = false;
  private actualBounds: Rect;

  constructor(
    public bounds: Rect,
    private maxItems: number = 10,
    private maxDepth: number = 12,
    private depth: number = 0
  ) {
    this.actualBounds = { ...bounds };
  }

  getActualBounds(): Rect {
    return { ...this.actualBounds };
  }

  private getBounds(element: T): Rect {
    return {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };
  }

  private containsPoint(point: { x: number; y: number }, rect: Rect): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  private intersects(rect1: Rect, rect2: Rect): boolean {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  }

  private contains(parent: Rect, child: Rect): boolean {
    return (
      child.x >= parent.x &&
      child.y >= parent.y &&
      child.x + child.width <= parent.x + parent.width &&
      child.y + child.height <= parent.y + parent.height
    );
  }

  private expandBoundsToContain(rect: Rect): void {
    const newX = Math.min(this.actualBounds.x, rect.x);
    const newY = Math.min(this.actualBounds.y, rect.y);
    const newMaxX = Math.max(
      this.actualBounds.x + this.actualBounds.width,
      rect.x + rect.width
    );
    const newMaxY = Math.max(
      this.actualBounds.y + this.actualBounds.height,
      rect.y + rect.height
    );

    const centerX = (newX + newMaxX) / 2;
    const centerY = (newY + newMaxY) / 2;
    const currentHalfW = this.actualBounds.width / 2;
    const currentHalfH = this.actualBounds.height / 2;

    let expandFactor = 1;
    while (
      centerX - currentHalfW * expandFactor > newX ||
      centerX + currentHalfW * expandFactor < newMaxX ||
      centerY - currentHalfH * expandFactor > newY ||
      centerY + currentHalfH * expandFactor < newMaxY
    ) {
      expandFactor *= 2;
    }

    this.actualBounds = {
      x: centerX - currentHalfW * expandFactor,
      y: centerY - currentHalfH * expandFactor,
      width: currentHalfW * expandFactor * 2,
      height: currentHalfH * expandFactor * 2,
    };

    this.bounds = { ...this.actualBounds };
  }

  private divide(): void {
    if (this.depth >= this.maxDepth) return;

    const { x, y, width, height } = this.bounds;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const newDepth = this.depth + 1;

    this.children = [
      new QuadTree<T>({ x, y, width: halfWidth, height: halfHeight }, this.maxItems, this.maxDepth, newDepth),
      new QuadTree<T>({ x: x + halfWidth, y, width: halfWidth, height: halfHeight }, this.maxItems, this.maxDepth, newDepth),
      new QuadTree<T>({ x, y: y + halfHeight, width: halfWidth, height: halfHeight }, this.maxItems, this.maxDepth, newDepth),
      new QuadTree<T>({ x: x + halfWidth, y: y + halfHeight, width: halfWidth, height: halfHeight }, this.maxItems, this.maxDepth, newDepth),
    ];

    this.isDivided = true;

    const items = this.items;
    this.items = [];

    for (const item of items) {
      this.insertIntoChildren(item);
    }
  }

  private insertIntoChildren(item: QuadTreeItem<T>): boolean {
    for (const child of this.children) {
      if (child.contains(child.bounds, item.bounds)) {
        child.insert(item.element, item.bounds);
        return true;
      }
    }
    return false;
  }

  insert(element: T, bounds?: Rect): boolean {
    const elementBounds = bounds || this.getBounds(element);

    if (!this.contains(this.bounds, elementBounds)) {
      this.expandBoundsToContain(elementBounds);

      if (this.isDivided) {
        const allItems = this.getAll();
        this.items = [];
        this.children = [];
        this.isDivided = false;

        for (const item of allItems) {
          const itemBounds = {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          };
          this._insertInternal(item, itemBounds);
        }
      }
    }

    if (!this.intersects(this.bounds, elementBounds)) {
      return false;
    }

    return this._insertInternal(element, elementBounds);
  }

  private _insertInternal(element: T, elementBounds: Rect): boolean {
    if (this.contains(this.bounds, elementBounds) && this.items.length < this.maxItems) {
      this.items.push({ element, bounds: elementBounds });
      return true;
    }

    if (!this.isDivided) {
      this.divide();
    }

    if (this.isDivided && this.insertIntoChildren({ element, bounds: elementBounds })) {
      return true;
    }

    this.items.push({ element, bounds: elementBounds });
    return true;
  }

  query(range: Rect): T[] {
    const results: T[] = [];

    if (!this.intersects(this.bounds, range)) {
      return results;
    }

    for (const item of this.items) {
      if (this.intersects(range, item.bounds)) {
        results.push(item.element);
      }
    }

    if (this.isDivided) {
      for (const child of this.children) {
        results.push(...child.query(range));
      }
    }

    return results;
  }

  remove(elementId: string): boolean {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].element.id === elementId) {
        this.items.splice(i, 1);
        return true;
      }
    }

    if (this.isDivided) {
      for (const child of this.children) {
        if (child.remove(elementId)) {
          return true;
        }
      }
    }

    return false;
  }

  update(element: T): boolean {
    const oldItem = this.findItem(element.id);
    const oldBounds = oldItem?.bounds;
    const newBounds = this.getBounds(element);

    const boundsChanged =
      !oldBounds ||
      oldBounds.x !== newBounds.x ||
      oldBounds.y !== newBounds.y ||
      oldBounds.width !== newBounds.width ||
      oldBounds.height !== newBounds.height;

    if (this.remove(element.id)) {
      if (boundsChanged && !this.contains(this.bounds, newBounds)) {
        this.expandBoundsToContain(newBounds);
        const allItems = this.getAll();
        this.items = [];
        this.children = [];
        this.isDivided = false;
        for (const item of allItems) {
          const itemBounds = {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          };
          this._insertInternal(item, itemBounds);
        }
      }
      return this._insertInternal(element, newBounds);
    }
    return false;
  }

  private findItem(elementId: string): QuadTreeItem<T> | undefined {
    for (const item of this.items) {
      if (item.element.id === elementId) {
        return item;
      }
    }
    if (this.isDivided) {
      for (const child of this.children) {
        const found = child.findItem(elementId);
        if (found) return found;
      }
    }
    return undefined;
  }

  getAll(): T[] {
    const results: T[] = [];

    for (const item of this.items) {
      results.push(item.element);
    }

    if (this.isDivided) {
      for (const child of this.children) {
        results.push(...child.getAll());
      }
    }

    return results;
  }

  getCount(): number {
    let count = this.items.length;

    if (this.isDivided) {
      for (const child of this.children) {
        count += child.getCount();
      }
    }

    return count;
  }

  clear(): void {
    this.items = [];
    this.children = [];
    this.isDivided = false;
  }
}
