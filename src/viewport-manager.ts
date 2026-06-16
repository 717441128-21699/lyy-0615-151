import { Viewport, Rect, WhiteboardElement } from './types';
import { ElementManager } from './element-manager';

export interface ViewportChange {
  moved: boolean;
  zoomed: boolean;
  oldViewport: Viewport;
  newViewport: Viewport;
}

export interface ViewportElements {
  viewport: Viewport;
  elements: WhiteboardElement[];
  timestamp: number;
}

export class ViewportManager {
  private elementManager: ElementManager;
  private userViewports: Map<string, Viewport> = new Map();
  private userElementIds: Map<string, Set<string>> = new Map();

  private readonly viewportMarginRatio: number = 0.2;
  private readonly updateThreshold: number = 50;

  constructor(elementManager: ElementManager) {
    this.elementManager = elementManager;
  }

  setUserViewport(userId: string, viewport: Viewport): ViewportChange | null {
    const oldViewport = this.userViewports.get(userId);

    if (!oldViewport) {
      this.userViewports.set(userId, { ...viewport });
      this.userElementIds.set(userId, new Set());
      return null;
    }

    const moved =
      Math.abs(viewport.x - oldViewport.x) > this.updateThreshold ||
      Math.abs(viewport.y - oldViewport.y) > this.updateThreshold;

    const zoomed = viewport.scale !== oldViewport.scale;

    if (!moved && !zoomed) {
      return null;
    }

    this.userViewports.set(userId, { ...viewport });

    return {
      moved,
      zoomed,
      oldViewport: { ...oldViewport },
      newViewport: { ...viewport },
    };
  }

  getUserViewport(userId: string): Viewport | undefined {
    return this.userViewports.get(userId);
  }

  removeUser(userId: string): void {
    this.userViewports.delete(userId);
    this.userElementIds.delete(userId);
  }

  getElementsInViewport(viewport: Viewport): WhiteboardElement[] {
    const expandedViewport = this.expandViewport(viewport);

    const rect: Rect = {
      x: expandedViewport.x,
      y: expandedViewport.y,
      width: expandedViewport.width,
      height: expandedViewport.height,
    };

    const elements = this.elementManager.getElementsByViewport(rect);

    elements.sort((a, b) => a.zIndex - b.zIndex);

    return elements;
  }

  getElementsForUser(userId: string): ViewportElements | null {
    const viewport = this.userViewports.get(userId);
    if (!viewport) return null;

    const elements = this.getElementsInViewport(viewport);
    const elementIds = new Set(elements.map((e) => e.id));
    this.userElementIds.set(userId, elementIds);

    return {
      viewport: { ...viewport },
      elements,
      timestamp: Date.now(),
    };
  }

  getViewportDiff(userId: string, newElements: WhiteboardElement[]): {
    added: WhiteboardElement[];
    removed: string[];
    updated: WhiteboardElement[];
  } {
    const previousIds = this.userElementIds.get(userId) || new Set<string>();
    const newIds = new Set(newElements.map((e) => e.id));

    const added: WhiteboardElement[] = [];
    const removed: string[] = [];
    const updated: WhiteboardElement[] = [];

    for (const element of newElements) {
      if (!previousIds.has(element.id)) {
        added.push(element);
      } else {
        updated.push(element);
      }
    }

    for (const id of previousIds) {
      if (!newIds.has(id)) {
        removed.push(id);
      }
    }

    return { added, removed, updated };
  }

  getUsersInElementArea(element: WhiteboardElement): string[] {
    const usersInArea: string[] = [];

    const elementRect: Rect = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    for (const [userId, viewport] of this.userViewports) {
      const expanded = this.expandViewport(viewport);
      if (this.rectsIntersect(elementRect, expanded)) {
        usersInArea.push(userId);
      }
    }

    return usersInArea;
  }

  getUsersInRect(rect: Rect): string[] {
    const usersInArea: string[] = [];

    for (const [userId, viewport] of this.userViewports) {
      const expanded = this.expandViewport(viewport);
      if (this.rectsIntersect(rect, expanded)) {
        usersInArea.push(userId);
      }
    }

    return usersInArea;
  }

  private expandViewport(viewport: Viewport): Rect {
    const marginX = viewport.width * this.viewportMarginRatio;
    const marginY = viewport.height * this.viewportMarginRatio;

    return {
      x: viewport.x - marginX,
      y: viewport.y - marginY,
      width: viewport.width + marginX * 2,
      height: viewport.height + marginY * 2,
    };
  }

  private rectsIntersect(rect1: Rect, rect2: Rect): boolean {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  }

  screenToWorld(screenX: number, screenY: number, viewport: Viewport): { x: number; y: number } {
    return {
      x: viewport.x + screenX / viewport.scale,
      y: viewport.y + screenY / viewport.scale,
    };
  }

  worldToScreen(worldX: number, worldY: number, viewport: Viewport): { x: number; y: number } {
    return {
      x: (worldX - viewport.x) * viewport.scale,
      y: (worldY - viewport.y) * viewport.scale,
    };
  }

  getUserCount(): number {
    return this.userViewports.size;
  }

  getAllUserIds(): string[] {
    return Array.from(this.userViewports.keys());
  }

  clear(): void {
    this.userViewports.clear();
    this.userElementIds.clear();
  }
}
