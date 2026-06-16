import { Viewport, Rect, WhiteboardElement, ViewportDiffMessage } from './types';
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

export interface ElementViewportChange {
  element: WhiteboardElement;
  oldRect: Rect;
  newRect: Rect;
  usersEntering: string[];
  usersLeaving: string[];
  usersStaying: string[];
}

export class ViewportManager {
  private elementManager: ElementManager;
  private userViewports: Map<string, Viewport> = new Map();
  private userElementVersions: Map<string, Map<string, number>> = new Map();

  private readonly viewportMarginRatio: number = 0.2;
  private readonly updateThreshold: number = 50;

  constructor(elementManager: ElementManager) {
    this.elementManager = elementManager;
  }

  setUserViewport(userId: string, viewport: Viewport): ViewportChange | null {
    const oldViewport = this.userViewports.get(userId);

    if (!oldViewport) {
      this.userViewports.set(userId, { ...viewport });
      this.userElementVersions.set(userId, new Map());
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
    this.userElementVersions.delete(userId);
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
    const versionMap = this.userElementVersions.get(userId) || new Map();

    versionMap.clear();
    for (const element of elements) {
      versionMap.set(element.id, element.version);
    }
    this.userElementVersions.set(userId, versionMap);

    return {
      viewport: { ...viewport },
      elements,
      timestamp: Date.now(),
    };
  }

  getViewportDiffForUser(userId: string): ViewportDiffMessage | null {
    const viewport = this.userViewports.get(userId);
    if (!viewport) return null;

    const newElements = this.getElementsInViewport(viewport);
    const previousVersions = this.userElementVersions.get(userId) || new Map();

    const newIds = new Set(newElements.map((e) => e.id));
    const added: WhiteboardElement[] = [];
    const removed: string[] = [];
    const updated: WhiteboardElement[] = [];

    for (const element of newElements) {
      const prevVersion = previousVersions.get(element.id);
      if (prevVersion === undefined) {
        added.push(element);
      } else if (element.version > prevVersion) {
        updated.push(element);
      }
    }

    for (const [id] of previousVersions) {
      if (!newIds.has(id)) {
        removed.push(id);
      }
    }

    const newVersions = new Map<string, number>();
    for (const element of newElements) {
      newVersions.set(element.id, element.version);
    }
    this.userElementVersions.set(userId, newVersions);

    if (added.length === 0 && removed.length === 0 && updated.length === 0) {
      return null;
    }

    return {
      viewport: { ...viewport },
      added,
      removed,
      updated,
      timestamp: Date.now(),
    };
  }

  calculateElementMoveChange(
    element: WhiteboardElement,
    oldRect: Rect,
    newRect: Rect
  ): ElementViewportChange {
    const usersEntering: string[] = [];
    const usersLeaving: string[] = [];
    const usersStaying: string[] = [];

    for (const [userId, viewport] of this.userViewports) {
      const expanded = this.expandViewport(viewport);
      const wasIn = this.rectsIntersect(oldRect, expanded);
      const isIn = this.rectsIntersect(newRect, expanded);

      if (!wasIn && isIn) {
        usersEntering.push(userId);
      } else if (wasIn && !isIn) {
        usersLeaving.push(userId);
      } else if (wasIn && isIn) {
        usersStaying.push(userId);
      }
    }

    return {
      element,
      oldRect,
      newRect,
      usersEntering,
      usersLeaving,
      usersStaying,
    };
  }

  onElementMoved(
    userId: string,
    element: WhiteboardElement,
    oldRect: Rect,
    newRect: Rect
  ): ElementViewportChange {
    const change = this.calculateElementMoveChange(element, oldRect, newRect);

    for (const uid of change.usersEntering) {
      const versions = this.userElementVersions.get(uid);
      if (versions) {
        versions.set(element.id, element.version);
      }
    }

    for (const uid of change.usersLeaving) {
      const versions = this.userElementVersions.get(uid);
      if (versions) {
        versions.delete(element.id);
      }
    }

    return change;
  }

  onElementCreated(element: WhiteboardElement): string[] {
    const usersInArea = this.getUsersInElementArea(element);

    for (const userId of usersInArea) {
      const versions = this.userElementVersions.get(userId);
      if (versions) {
        versions.set(element.id, element.version);
      }
    }

    return usersInArea;
  }

  onElementDeleted(elementId: string, elementRect: Rect): string[] {
    const usersInArea = this.getUsersInRect(elementRect);

    for (const userId of usersInArea) {
      const versions = this.userElementVersions.get(userId);
      if (versions) {
        versions.delete(elementId);
      }
    }

    return usersInArea;
  }

  onElementUpdated(element: WhiteboardElement): string[] {
    const usersInArea = this.getUsersInElementArea(element);

    for (const userId of usersInArea) {
      const versions = this.userElementVersions.get(userId);
      if (versions) {
        versions.set(element.id, element.version);
      }
    }

    return usersInArea;
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

  getUserElementIds(userId: string): Set<string> {
    const versions = this.userElementVersions.get(userId);
    return versions ? new Set(versions.keys()) : new Set();
  }

  hasUserElement(userId: string, elementId: string): boolean {
    const versions = this.userElementVersions.get(userId);
    return versions ? versions.has(elementId) : false;
  }

  getUserCount(): number {
    return this.userViewports.size;
  }

  getAllUserIds(): string[] {
    return Array.from(this.userViewports.keys());
  }

  clear(): void {
    this.userViewports.clear();
    this.userElementVersions.clear();
  }
}
