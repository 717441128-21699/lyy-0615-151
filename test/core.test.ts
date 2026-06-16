import { QuadTree } from '../src/quadtree';
import { RectangleElement, WhiteboardElement, Rect } from '../src/types';
import { SnowflakeIdGenerator, ElementManager } from '../src/element-manager';

function testQuadtree() {
  console.log('=== Testing Quadtree ===');

  const bounds: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
  const quadtree = new QuadTree<RectangleElement>(bounds, 4, 4);

  const idGen = new SnowflakeIdGenerator(0);

  const elements: RectangleElement[] = [];
  for (let i = 0; i < 100; i++) {
    const element: RectangleElement = {
      id: idGen.nextId(),
      type: 'rectangle',
      x: Math.random() * 900,
      y: Math.random() * 900,
      width: 20 + Math.random() * 50,
      height: 20 + Math.random() * 50,
      zIndex: i,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'test',
      updatedBy: 'test',
      version: 1,
    };
    elements.push(element);
    quadtree.insert(element);
  }

  console.log(`Inserted ${quadtree.getCount()} elements`);

  const queryRect: Rect = { x: 200, y: 200, width: 400, height: 400 };
  const results = quadtree.query(queryRect);
  console.log(`Query [200,200,400,400] returned ${results.length} elements`);

  const toDelete = elements[0];
  const removed = quadtree.remove(toDelete.id);
  console.log(`Removed element ${toDelete.id}: ${removed}`);
  console.log(`Count after remove: ${quadtree.getCount()}`);

  const updated = { ...elements[1], x: 500, y: 500 };
  const updateResult = quadtree.update(updated);
  console.log(`Updated element: ${updateResult}`);

  const all = quadtree.getAll();
  console.log(`Total elements in tree: ${all.length}`);

  quadtree.clear();
  console.log(`After clear: ${quadtree.getCount()}`);

  console.log('Quadtree tests passed!\n');
}

function testElementManager() {
  console.log('=== Testing ElementManager ===');

  const manager = new ElementManager();
  const idGen = new SnowflakeIdGenerator(1);

  const id = idGen.nextId();
  const zIndex = manager.getNextZIndex();

  const element: RectangleElement = {
    id,
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    zIndex,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: 'test-user',
    updatedBy: 'test-user',
    version: 1,
  };

  manager.addElement(element);
  console.log(`Added element, total count: ${manager.getElementsCount()}`);

  const found = manager.getElement(id);
  console.log(`Found element: ${found ? 'yes' : 'no'}, type: ${found?.type}`);

  const updated = manager.updateElement(id, { x: 200, y: 200 });
  console.log(`Updated element position: (${updated?.x}, ${updated?.y}), version: ${updated?.version}`);

  const moved = manager.moveElement(id, 50, 50);
  console.log(`Moved element by (50,50): (${moved?.x}, ${moved?.y})`);

  const viewportElements = manager.getElementsByViewport({
    x: 0,
    y: 0,
    width: 500,
    height: 500,
  });
  console.log(`Elements in viewport: ${viewportElements.length}`);

  const front = manager.bringToFront(id);
  console.log(`Bring to front, zIndex: ${front?.zIndex}`);

  const deleted = manager.deleteElement(id);
  console.log(`Deleted element: ${deleted}`);
  console.log(`Count after delete: ${manager.getElementsCount()}`);

  console.log('ElementManager tests passed!\n');
}

function testIdGenerator() {
  console.log('=== Testing Snowflake ID Generator ===');

  const gen1 = new SnowflakeIdGenerator(0, 0);
  const gen2 = new SnowflakeIdGenerator(1, 0);

  const ids1: string[] = [];
  const ids2: string[] = [];

  for (let i = 0; i < 1000; i++) {
    ids1.push(gen1.nextId());
    ids2.push(gen2.nextId());
  }

  const unique1 = new Set(ids1);
  const unique2 = new Set(ids2);
  const allUnique = new Set([...ids1, ...ids2]);

  console.log(`Generated 1000 IDs from worker 0, unique: ${unique1.size === 1000}`);
  console.log(`Generated 1000 IDs from worker 1, unique: ${unique2.size === 1000}`);
  console.log(`All 2000 IDs unique across workers: ${allUnique.size === 2000}`);
  console.log(`Example ID: ${ids1[0]}`);
  console.log(`ID length: ${ids1[0].length} chars`);

  console.log('Snowflake ID generator tests passed!\n');
}

function runAllTests() {
  testIdGenerator();
  testQuadtree();
  testElementManager();
  console.log('All tests completed!');
}

runAllTests();
