import { Rect, WhiteboardElement } from './types';

interface QuadTreeItem<T> {
  element: T;
  bounds: Rect;
}

export class QuadTree<T extends WhiteboardElement = WhiteboardElement> {
  private items: QuadTreeItem<T>[] = [];
  private children: QuadTree<T>[] = [];
  private isDivided = false;

  constructor(
    public bounds: Rect,
    private maxItems: number = 10,
    private maxDepth: number = 8,
    private depth: number = 0
  ) {}

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

    if (!this.intersects(this.bounds, elementBounds)) {
      return false;
    }

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
    if (this.remove(element.id)) {
      return this.insert(element);
    }
    return false;
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
