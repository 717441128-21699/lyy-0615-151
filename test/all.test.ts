import assert from 'assert';
import { ElementManager, SnowflakeIdGenerator } from '../src/element-manager';
import { ViewportManager } from '../src/viewport-manager';
import { OperationProcessor } from '../src/operation-processor';
import { Room } from '../src/room';
import { QuadTree } from '../src/quadtree';
import {
  ElementCreateInput,
  Viewport,
  WhiteboardOperation,
  MoveOperation,
  WhiteboardElement,
  ReconnectMessage,
  Rect,
} from '../src/types';

let passCount = 0;
let failCount = 0;
const failedTests: string[] = [];

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}\n    ${msg.split('\n').join('\n    ')}`);
    failCount++;
    failedTests.push(`${name}: ${msg}`);
  }
}

async function runAsyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}\n    ${msg.split('\n').join('\n    ')}`);
    failCount++;
    failedTests.push(`${name}: ${msg}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDummyRoom(id: string = 'room-1'): Room {
  return new Room(
    id,
    `Room ${id}`,
    () => {},
    () => {},
    0
  );
}

const DEFAULT_QT_BOUNDS: Rect = { x: -100_000_000, y: -100_000_000, width: 200_000_000, height: 200_000_000 };

console.log('\n=====================================================');
console.log('  实时多人白板后端 - 完整测试套件');
console.log('=====================================================\n');

(async function runAllTests() {

// ============================================
// 需求1: 按需扩展的无限画布 - 远坐标元素加载
// ============================================
console.log('【需求1】按需扩展的无限画布 - 远坐标元素加载');
{
  runTest('超大正坐标(1亿)创建元素后可查询', () => {
    const elementManager = new ElementManager();
    const input: ElementCreateInput = {
      type: 'rectangle',
      x: 100_000_000,
      y: 100_000_000,
      width: 100,
      height: 100,
      fill: '#FF0000',
    };
    const el = elementManager.createElement(input, 'user-a');
    assert.strictEqual(el.x, 100_000_000, 'x坐标应该正确');
    assert.strictEqual(el.y, 100_000_000, 'y坐标应该正确');
    assert.ok(elementManager.getElement(el.id), '元素应该可以通过ID查到');
  });

  runTest('超大负坐标(-1亿)创建元素后可查询', () => {
    const elementManager = new ElementManager();
    const input: ElementCreateInput = {
      type: 'circle',
      x: -99_999_999,
      y: -88_888_888,
      radius: 50,
      width: 100,
      height: 100,
      fill: '#00FF00',
    };
    const el = elementManager.createElement(input, 'user-a');
    assert.strictEqual(el.x, -99_999_999, 'x负坐标应该正确');
    assert.strictEqual(el.y, -88_888_888, 'y负坐标应该正确');
    assert.ok(elementManager.getElement(el.id), '负坐标元素应该存在');
  });

  runTest('移动元素到远坐标后四叉树可正确索引', () => {
    const qt = new QuadTree<WhiteboardElement>({
      x: -10000, y: -10000, width: 20000, height: 20000,
    });
    const el: WhiteboardElement = {
      id: 'far-move',
      type: 'rectangle',
      x: 0, y: 0,
      width: 50, height: 50,
      zIndex: 1, version: 1,
      fill: '#00F',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'u1',
      updatedBy: 'u1',
    };
    assert.ok(qt.insert(el), '初始插入应该成功');
    el.x = 500_000_000;
    el.y = 500_000_000;
    assert.ok(qt.update(el), '移动到远坐标应该update成功');
    const bounds = qt.getActualBounds();
    assert.ok(
      bounds.x <= 500_000_000 && bounds.x + bounds.width >= 500_000_000,
      '四叉树应该扩展到容纳远坐标元素'
    );
    const found = qt.query({ x: 499_999_900, y: 499_999_900, width: 300, height: 300 });
    assert.strictEqual(found.length, 1, '视口查询应该找到远坐标元素');
  });

  runTest('移动视口到远坐标能加载对应元素', () => {
    const elementManager = new ElementManager();
    const viewportManager = new ViewportManager(elementManager);

    const farInput: ElementCreateInput = {
      type: 'rectangle',
      x: 10_000_000, y: 10_000_000,
      width: 200, height: 200,
      fill: '#FF00FF',
    };
    const farEl = elementManager.createElement(farInput, 'user-a');

    const nearInput: ElementCreateInput = {
      type: 'rectangle',
      x: 0, y: 0,
      width: 200, height: 200,
      fill: '#FFFF00',
    };
    elementManager.createElement(nearInput, 'user-a');

    const farViewport: Viewport = { x: 9_999_000, y: 9_999_000, width: 5000, height: 5000, scale: 1 };
    viewportManager.setUserViewport('u-view', farViewport);
    const result = viewportManager.getElementsInViewport(farViewport);
    const ids = result.map(e => e.id);
    assert.ok(ids.includes(farEl.id), '视口内应该包含远坐标元素');
    assert.strictEqual(ids.length, 1, '只应该返回视口范围内的1个元素');
  });

  runTest('四叉树动态扩展边界应覆盖正负极端坐标', () => {
    const qt = new QuadTree<WhiteboardElement>(DEFAULT_QT_BOUNDS);
    const els: WhiteboardElement[] = [
      { id: 'p1', type: 'rectangle', x: 1e9, y: 1e9, width: 10, height: 10, zIndex: 1, version: 1, fill: 'F', createdAt: 0, updatedAt: 0, createdBy: 'u', updatedBy: 'u' },
      { id: 'p2', type: 'rectangle', x: -1e9, y: -1e9, width: 10, height: 10, zIndex: 2, version: 1, fill: 'F', createdAt: 0, updatedAt: 0, createdBy: 'u', updatedBy: 'u' },
      { id: 'p3', type: 'rectangle', x: 1e9, y: -1e9, width: 10, height: 10, zIndex: 3, version: 1, fill: 'F', createdAt: 0, updatedAt: 0, createdBy: 'u', updatedBy: 'u' },
      { id: 'p4', type: 'rectangle', x: -1e9, y: 1e9, width: 10, height: 10, zIndex: 4, version: 1, fill: 'F', createdAt: 0, updatedAt: 0, createdBy: 'u', updatedBy: 'u' },
    ];
    for (const el of els) {
      assert.ok(qt.insert(el), `插入 ${el.id} 应该成功`);
    }
    const bounds = qt.getActualBounds();
    assert.ok(bounds.x <= -1e9, '左边界应覆盖-1e9');
    assert.ok(bounds.y <= -1e9, '上边界应覆盖-1e9');
    assert.ok(bounds.x + bounds.width >= 1e9, '右边界应覆盖1e9');
    assert.ok(bounds.y + bounds.height >= 1e9, '下边界应覆盖1e9');
  });
}

// ============================================
// 需求2: 断线重连恢复
// ============================================
console.log('\n【需求2】断线重连恢复 - 基于时间戳的增量补发');
{
  runTest('首次连接(lastSyncTimestamp=0)返回全量同步(isFullSync=true)', () => {
    const room = createDummyRoom('reconn-1');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'reconn-1', element: input, requestId: 'r1' });

    const msg: ReconnectMessage = {
      userId: 'u2', userName: 'Bob', roomId: 'reconn-1',
      viewport: vp, lastSyncTimestamp: 0,
    };
    const diff = room.reconnectUser(msg);
    assert.strictEqual(diff.isFullSync, true, '首次应该是全量同步');
    assert.strictEqual(diff.success, true, '应该成功');
    assert.ok(diff.added.length >= 1, '至少有1个新增元素');
    assert.strictEqual(diff.removed.length, 0, '移除应该为空');
  });

  await runAsyncTest('断线期间有新建元素 → reconnect返回added增量', async () => {
    const room = createDummyRoom('reconn-2');
    const vp: Viewport = { x: 0, y: 0, width: 2000, height: 2000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const vpm = room.getViewportManager();

    const input1: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'reconn-2', element: input1, requestId: 'r1' });

    await delay(30);
    const t1 = Date.now();
    await delay(30);

    const input2: ElementCreateInput = { type: 'circle', x: 300, y: 300, radius: 30, width: 60, height: 60, fill: 'G' };
    room.handleCreateElement('u1', { roomId: 'reconn-2', element: input2, requestId: 'r2' });
    const newElId = vpm.getElementsInViewport(vp).find(e => e.type === 'circle')?.id;

    const msg: ReconnectMessage = {
      userId: 'u1', userName: 'Alice', roomId: 'reconn-2',
      viewport: vp, lastSyncTimestamp: t1,
    };
    const diff = room.reconnectUser(msg);
    assert.strictEqual(diff.isFullSync, false, '应该是增量同步');
    assert.ok(diff.added.some(e => e.id === newElId), 'added里应该包含断线后新建的圆形元素');
    assert.ok(diff.added.length >= 1, '至少有1个added');
  });

  await runAsyncTest('断线期间删除元素 → reconnect返回removed增量', async () => {
    const room = createDummyRoom('reconn-3');
    const vp: Viewport = { x: 0, y: 0, width: 2000, height: 2000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const vpm = room.getViewportManager();

    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'reconn-3', element: input, requestId: 'r1' });
    const elId = vpm.getElementsInViewport(vp).find(e => e.type === 'rectangle')?.id!;

    await delay(30);
    const t1 = Date.now();
    await delay(30);

    const deleteOp: WhiteboardOperation = {
      id: 'op-del-1', type: 'delete', elementId: elId,
      version: 1, userId: 'u1', timestamp: Date.now(),
    };
    room.handleOperation('u1', deleteOp);

    await delay(250);

    const msg: ReconnectMessage = {
      userId: 'u1', userName: 'Alice', roomId: 'reconn-3',
      viewport: vp, lastSyncTimestamp: t1,
    };
    const diff = room.reconnectUser(msg);
    assert.strictEqual(diff.isFullSync, false, '应该是增量同步');
    assert.ok(diff.removed.includes(elId), `removed里应该包含被删除的元素 ${elId}`);
  });

  await runAsyncTest('断线期间更新元素 → reconnect返回updated增量', async () => {
    const room = createDummyRoom('reconn-4');
    const vp: Viewport = { x: 0, y: 0, width: 2000, height: 2000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const vpm = room.getViewportManager();

    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: '#FF0000' };
    room.handleCreateElement('u1', { roomId: 'reconn-4', element: input, requestId: 'r1' });
    const el = vpm.getElementsInViewport(vp).find(e => e.type === 'rectangle')!;

    await delay(30);
    const t1 = Date.now();
    await delay(30);

    const moveOp: MoveOperation = {
      id: 'op-mv-1', type: 'move', elementId: el.id,
      dx: 200, dy: 200, newX: 300, newY: 300,
      version: el.version, userId: 'u1', timestamp: Date.now(),
    };
    room.handleOperation('u1', moveOp);

    await delay(250);

    const msg: ReconnectMessage = {
      userId: 'u1', userName: 'Alice', roomId: 'reconn-4',
      viewport: vp, lastSyncTimestamp: t1,
    };
    const diff = room.reconnectUser(msg);
    assert.strictEqual(diff.isFullSync, false, '应该是增量同步');
    const updated = diff.updated.find(e => e.id === el.id);
    assert.ok(updated, 'updated里应该包含被移动的元素');
    assert.strictEqual(updated!.x, 300, 'updated元素的x应该是移动后的300');
    assert.strictEqual(updated!.y, 300, 'updated元素的y应该是移动后的300');
  });

  runTest('lastSyncTimestamp太早(超出历史范围)自动降级为全量同步', () => {
    const room = createDummyRoom('reconn-5');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    const msg: ReconnectMessage = {
      userId: 'u1', userName: 'Alice', roomId: 'reconn-5',
      viewport: vp, lastSyncTimestamp: 1,
    };
    const diff = room.reconnectUser(msg);
    assert.strictEqual(diff.isFullSync, true, '超出历史范围应该降级全量同步');
    assert.strictEqual(diff.success, true, '应该成功');
  });
}

// ============================================
// 需求3: 冲突结果增强 - 明确的接受/拒绝信息
// ============================================
console.log('\n【需求3】冲突结果增强 - 明确的接受/拒绝/版本信息');
{
  await runAsyncTest('成功操作返回 accepted=true + serverVersion + serverElement', async () => {
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    const ackMessages: any[] = [];
    const captureRoom = new Room(
      'conflict-1b', 'Room',
      () => {},
      (uid, msg) => { if (msg.type === 'sync_ack') ackMessages.push(msg.data); },
      0
    );
    captureRoom.addUser('u1', 'Alice', vp);
    captureRoom.handleCreateElement('u1', { roomId: 'conflict-1b', element: input, requestId: 'r1' });

    const vpm = captureRoom.getViewportManager();
    const capEl = vpm.getElementsInViewport(vp)[0];

    const moveOp: MoveOperation = {
      id: 'op-ok-1', type: 'move', elementId: capEl.id,
      dx: 50, dy: 50, newX: 150, newY: 150,
      version: capEl.version, userId: 'u1', timestamp: Date.now(),
    };
    captureRoom.handleOperation('u1', moveOp);

    await delay(250);

    assert.ok(ackMessages.length >= 1, '应该收到至少一条sync_ack');
    const moveAck = ackMessages.find(a => a.operationId === 'op-ok-1');
    assert.ok(moveAck, '应该找到move操作的ack');
    assert.strictEqual(moveAck.accepted, true, '应该被接受');
    assert.ok(typeof moveAck.serverVersion === 'number', '应返回serverVersion数字');
    assert.ok(moveAck.serverElement, '应返回serverElement完整对象');
    assert.strictEqual(moveAck.serverElement.x, 150, 'serverElement x应为150');
    assert.ok(!moveAck.conflictType, '成功时不应有conflictType');
  });

  runTest('版本号冲突返回 conflictType=version_mismatch + 当前serverElement', () => {
    const em = new ElementManager();
    const processor = new OperationProcessor(em);
    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    const el = em.createElement(input, 'u1');

    const staleMove: MoveOperation = {
      id: 'op-stale', type: 'move', elementId: el.id,
      dx: 999, dy: 999, newX: 1099, newY: 1099,
      version: 0, userId: 'u2', timestamp: Date.now(),
    };
    const result = processor.process(staleMove);
    const ack = processor.buildSyncAck(result);

    assert.strictEqual(ack.accepted, false, '旧版本操作应该被拒绝');
    assert.strictEqual(ack.conflictType, 'version_mismatch', '冲突类型应该是version_mismatch');
    assert.ok(typeof ack.serverVersion === 'number', '应返回服务端当前版本号');
    assert.ok(ack.serverElement, '应返回服务端当前的完整元素快照');
    assert.strictEqual(ack.serverElement.id, el.id, 'serverElement id应匹配');
    assert.strictEqual(ack.serverElement.x, 100, 'serverElement x保持100（未被旧版本修改）');
  });

  runTest('不存在的元素返回 conflictType=not_found', () => {
    const em = new ElementManager();
    const processor = new OperationProcessor(em);
    const moveOp: MoveOperation = {
      id: 'op-nf', type: 'move', elementId: 'non-existent-id',
      dx: 10, dy: 10, newX: 110, newY: 110,
      version: 1, userId: 'u1', timestamp: Date.now(),
    };
    const result = processor.process(moveOp);
    const ack = processor.buildSyncAck(result);
    assert.strictEqual(ack.accepted, false, '应被拒绝');
    assert.strictEqual(ack.conflictType, 'not_found', '冲突类型应该是not_found');
  });

  await runAsyncTest('多人竞争时被接受者的操作 accepted=true，后到者冲突有明确提示', async () => {
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    const input: ElementCreateInput = { type: 'rectangle', x: 0, y: 0, width: 100, height: 100, fill: 'F' };
    const acks: any[] = [];
    const raceRoom = new Room(
      'race', 'Room',
      () => {},
      (uid, msg) => { if (msg.type === 'sync_ack') acks.push({ uid, ...(msg.data as object) }); },
      0
    );
    raceRoom.addUser('u1', 'Alice', vp);
    raceRoom.addUser('u2', 'Bob', vp);
    raceRoom.handleCreateElement('u1', { roomId: 'race', element: input, requestId: 'r1' });

    const vpm = raceRoom.getViewportManager();
    const raceEl = vpm.getElementsInViewport(vp)[0];

    const op1: MoveOperation = {
      id: 'op-u1', type: 'move', elementId: raceEl.id,
      dx: 50, dy: 0, newX: 50, newY: 0,
      version: raceEl.version, userId: 'u1', timestamp: Date.now(),
    };
    const op2: MoveOperation = {
      id: 'op-u2', type: 'move', elementId: raceEl.id,
      dx: 0, dy: 50, newX: 0, newY: 50,
      version: raceEl.version, userId: 'u2', timestamp: Date.now(),
    };

    raceRoom.handleOperation('u1', op1);
    raceRoom.handleOperation('u2', op2);

    await delay(250);

    const ack1 = acks.find(a => a.operationId === 'op-u1');
    const ack2 = acks.find(a => a.operationId === 'op-u2');

    assert.ok(ack1, 'u1应收到ack');
    assert.ok(ack2, 'u2应收到ack');
    assert.strictEqual(ack1.accepted, true, '第一个操作应该被接受');
    assert.strictEqual(ack2.accepted, false, '第二个操作应该被拒绝（版本冲突）');
    assert.strictEqual(ack2.conflictType, 'version_mismatch', '第二个操作冲突类型应该是version_mismatch');
    assert.ok(ack2.serverElement, '第二个操作应返回服务端当前完整元素');
    assert.strictEqual(ack2.serverElement.x, 50, 'serverElement x应该是被u1改后的50');
    assert.ok(typeof ack2.serverVersion === 'number', '应返回服务端版本号供客户端修正');
  });
}

// ============================================
// 需求4: 基础回归
// ============================================
console.log('\n【需求4】基础回归 - 确保核心链路完整');
{
  runTest('雪花ID生成万级不重复', () => {
    const gen = new SnowflakeIdGenerator(1);
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      ids.add(gen.nextId());
    }
    assert.strictEqual(ids.size, 10000, '10000个ID应该全部唯一');
  });

  runTest('视口增量diff(added/removed/updated)机制可用', () => {
    const elementManager = new ElementManager();
    const viewportManager = new ViewportManager(elementManager);
    const vp: Viewport = { x: 0, y: 0, width: 500, height: 500, scale: 1 };
    viewportManager.setUserViewport('u1', vp);
    viewportManager.getElementsForUser('u1');

    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    const el = elementManager.createElement(input, 'u1');
    viewportManager.onElementCreated(el);

    const diff1 = viewportManager.getViewportDiffForUser('u1');
    assert.ok(diff1, '首次应有diff');
    assert.ok(diff1.added.some(e => e.id === el.id), '应有added');

    const diff2 = viewportManager.getViewportDiffForUser('u1');
    if (diff2) {
      assert.strictEqual(diff2.added.length, 0, '再次查询不应该有重复added');
      assert.strictEqual(diff2.removed.length, 0, '没有元素被移除');
      assert.strictEqual(diff2.updated.length, 0, '没有元素被更新');
    }

    elementManager.updateElement(el.id, { x: 120, y: 120, updatedBy: 'u1' });
    const updated = elementManager.getElement(el.id)!;
    viewportManager.onElementUpdated(updated);
    const diff3 = viewportManager.getViewportDiffForUser('u1');
    assert.ok(diff3, 'diff3不应为空');
    assert.ok(diff3.updated.some(e => e.id === el.id), '更新后应有updated');
  });
}

// ============================================
// 汇总
// ============================================
console.log('\n=====================================================');
console.log(`  测试结果: ${passCount} 通过, ${failCount} 失败`);
console.log('=====================================================\n');

if (failCount > 0) {
  console.log('失败的测试:');
  for (const t of failedTests) {
    console.log(`  - ${t}`);
  }
  console.log('');
  process.exit(1);
} else {
  console.log('所有测试通过 ✅\n');
  process.exit(0);
}

})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
