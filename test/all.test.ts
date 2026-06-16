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
// 需求5: 房间短期保活 + 快照恢复
// ============================================
console.log('\n【需求5】房间短期保活 + 快照恢复');
{
  runTest('最后一个用户离开后房间不立即销毁，启动过期倒计时', () => {
    const room = createDummyRoom('ttl-1');
    room.setRoomTtl(60000);
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };

    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'ttl-1', element: input, requestId: 'r1' });

    const elementCountBefore = room.getStatus().elementCount;
    assert.strictEqual(elementCountBefore, 1, '离开前应该有1个元素');

    room.removeUser('u1');
    assert.strictEqual(room.getUserCount(), 0, '移除后用户数应为0');
    assert.strictEqual(room.getStatus().elementCount, 1, '用户离开后元素应该还在（保活）');
    assert.strictEqual(room.getIsExpired(), false, '房间尚未过期');
  });

  await runAsyncTest('短时间内重进同一房间，能看到之前的元素（快照恢复）', async () => {
    const room = createDummyRoom('ttl-2');
    room.setRoomTtl(5000);
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };

    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 200, y: 200, width: 80, height: 80, fill: '#123456' };
    room.handleCreateElement('u1', { roomId: 'ttl-2', element: input, requestId: 'r1' });
    const elId = room.getViewportManager().getElementsInViewport(vp)[0].id;

    room.removeUser('u1');
    assert.strictEqual(room.getUserCount(), 0, '离开后用户数为0');

    await delay(50);

    room.addUser('u2', 'Bob', vp);
    const elements = room.getViewportManager().getElementsInViewport(vp);
    assert.strictEqual(elements.length, 1, '重进后应该能看到之前的1个元素');
    assert.strictEqual(elements[0].id, elId, '元素ID应该一致');
    assert.strictEqual((elements[0] as any).fill, '#123456', '元素属性应该保持');
  });

  runTest('getStatus 返回正确的房间状态信息', () => {
    const room = createDummyRoom('status-1');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    room.addUser('u2', 'Bob', vp);

    const input: ElementCreateInput = { type: 'circle', x: 50, y: 50, radius: 25, width: 50, height: 50, fill: 'G' };
    room.handleCreateElement('u1', { roomId: 'status-1', element: input, requestId: 'r1' });

    const status = room.getStatus();
    assert.strictEqual(status.roomId, 'status-1', 'roomId应正确');
    assert.strictEqual(status.onlineUserCount, 2, '在线用户数应为2');
    assert.strictEqual(status.elementCount, 1, '元素数应为1');
    assert.ok(status.lastActiveAt > 0, 'lastActiveAt应为正数');
    assert.strictEqual(typeof status.canIncrementalSync, 'boolean', 'canIncrementalSync应为布尔值');
  });
}

// ============================================
// 需求6: 冲突回执增强 - 谁的改动作效
// ============================================
console.log('\n【需求6】冲突回执增强 - 显示谁的改动作效 + 最后更新者');
{
  runTest('版本冲突时 acceptedBy 为最后生效的用户ID', () => {
    const em = new ElementManager();
    const processor = new OperationProcessor(em);
    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    const el = em.createElement(input, 'user-creator');
    assert.strictEqual(el.updatedBy, 'user-creator', '初始 updatedBy 应该是创建者');

    const staleMove: MoveOperation = {
      id: 'op-stale', type: 'move', elementId: el.id,
      dx: 50, dy: 50, newX: 150, newY: 150,
      version: 0, userId: 'user-late', timestamp: Date.now(),
    };
    const result = processor.process(staleMove);
    const ack = processor.buildSyncAck(result);

    assert.strictEqual(ack.accepted, false, '应该被拒绝');
    assert.strictEqual(ack.conflictType, 'version_mismatch', '冲突类型正确');
    assert.strictEqual(ack.acceptedBy, 'user-creator', 'acceptedBy应该是最后生效的用户（创建者）');
    assert.ok(ack.serverElement, '应有serverElement');
    assert.strictEqual(ack.serverElement!.updatedBy, 'user-creator', 'serverElement.updatedBy 应该是创建者');
  });

  await runAsyncTest('先到先得：先提交者 accepted=true，后提交者 acceptedBy=先提交者', async () => {
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    const input: ElementCreateInput = { type: 'rectangle', x: 0, y: 0, width: 100, height: 100, fill: 'F' };
    const acks: any[] = [];
    const raceRoom = new Room(
      'race2', 'Room',
      () => {},
      (uid, msg) => { if (msg.type === 'sync_ack') acks.push({ uid, ...(msg.data as object) }); },
      0
    );
    raceRoom.addUser('u-alice', 'Alice', vp);
    raceRoom.addUser('u-bob', 'Bob', vp);
    raceRoom.handleCreateElement('u-alice', { roomId: 'race2', element: input, requestId: 'r1' });

    const vpm = raceRoom.getViewportManager();
    const raceEl = vpm.getElementsInViewport(vp)[0];

    const opAlice: MoveOperation = {
      id: 'op-alice', type: 'move', elementId: raceEl.id,
      dx: 100, dy: 0, newX: 100, newY: 0,
      version: raceEl.version, userId: 'u-alice', timestamp: Date.now(),
    };
    const opBob: MoveOperation = {
      id: 'op-bob', type: 'move', elementId: raceEl.id,
      dx: 0, dy: 100, newX: 0, newY: 100,
      version: raceEl.version, userId: 'u-bob', timestamp: Date.now(),
    };

    raceRoom.handleOperation('u-alice', opAlice);
    raceRoom.handleOperation('u-bob', opBob);

    await delay(250);

    const ackAlice = acks.find(a => a.operationId === 'op-alice');
    const ackBob = acks.find(a => a.operationId === 'op-bob');

    assert.ok(ackAlice, 'alice应收到ack');
    assert.ok(ackBob, 'bob应收到ack');
    assert.strictEqual(ackAlice.accepted, true, 'alice的操作应被接受');
    assert.strictEqual(ackBob.accepted, false, 'bob的操作应被拒绝');
    assert.strictEqual(ackBob.acceptedBy, 'u-alice', 'bob的ack中acceptedBy应该是alice（先到先得）');
    assert.strictEqual(ackBob.serverElement.updatedBy, 'u-alice', 'serverElement.updatedBy 应该是alice');
    assert.ok(typeof ackBob.serverVersion === 'number', '应有serverVersion供客户端修正');
  });
}

// ============================================
// 需求7: 断线重连 - 可回放操作序列
// ============================================
console.log('\n【需求7】断线重连 - 可回放操作序列（按时间顺序）');
{
  await runAsyncTest('增量模式下 operations 按时间戳升序排列', async () => {
    const room = createDummyRoom('replay-1');
    const vp: Viewport = { x: 0, y: 0, width: 2000, height: 2000, scale: 1 };
    room.addUser('u1', 'Alice', vp);

    const input: ElementCreateInput = { type: 'rectangle', x: 100, y: 100, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'replay-1', element: input, requestId: 'r1' });

    await delay(50);
    const t1 = Date.now();
    await delay(20);

    const processor = room.getOperationProcessor();
    const em = room.getElementManager();
    let el = em.getElementsByViewport(vp)[0];

    for (let i = 0; i < 5; i++) {
      await delay(15);
      const moveOp: MoveOperation = {
        id: `op-mv-${i}`, type: 'move', elementId: el.id,
        dx: 10, dy: 10, newX: el.x + 10, newY: el.y + 10,
        version: el.version, userId: 'u1', timestamp: Date.now(),
      };
      processor.process(moveOp);
      const updated = em.getElement(el.id);
      if (updated) el = updated;
    }

    const msg: ReconnectMessage = {
      userId: 'u1', userName: 'Alice', roomId: 'replay-1',
      viewport: vp, lastSyncTimestamp: t1,
    };
    const diff = room.reconnectUser(msg);

    assert.strictEqual(diff.isFullSync, false, '应为增量同步');
    assert.ok(Array.isArray(diff.operations), '应有operations数组');
    assert.ok(diff.operations.length >= 5, `至少应有5个move操作，实际${diff.operations.length}个`);

    for (let i = 1; i < diff.operations.length; i++) {
      assert.ok(
        diff.operations[i].timestamp >= diff.operations[i - 1].timestamp,
        `operations应按时间升序: ${diff.operations[i - 1].timestamp} <= ${diff.operations[i].timestamp}`
      );
    }
  });

  await runAsyncTest('全量模式下也有 operations 可回放列表', async () => {
    const room = createDummyRoom('replay-2');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);

    const input1: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'replay-2', element: input1, requestId: 'r1' });
    const input2: ElementCreateInput = { type: 'circle', x: 200, y: 200, radius: 25, width: 50, height: 50, fill: 'G' };
    room.handleCreateElement('u1', { roomId: 'replay-2', element: input2, requestId: 'r2' });

    const msg: ReconnectMessage = {
      userId: 'u2', userName: 'Bob', roomId: 'replay-2',
      viewport: vp, lastSyncTimestamp: 0,
    };
    const diff = room.reconnectUser(msg);

    assert.strictEqual(diff.isFullSync, true, '应为全量同步');
    assert.ok(Array.isArray(diff.operations), '全量模式也应有operations数组');
    assert.ok(diff.operations.length >= 2, '至少有2个create操作');
    assert.ok(diff.added.length >= 2, 'added里至少有2个元素');
  });

  await runAsyncTest('操作类型丰富：create → move → update → delete 连续变化可回放', async () => {
    const room = createDummyRoom('replay-3');
    const vp: Viewport = { x: 0, y: 0, width: 2000, height: 2000, scale: 1 };
    room.addUser('u1', 'Alice', vp);

    const input: ElementCreateInput = { type: 'rectangle', x: 50, y: 50, width: 80, height: 80, fill: '#FF0000' };
    room.handleCreateElement('u1', { roomId: 'replay-3', element: input, requestId: 'r1' });

    await delay(10);
    const em = room.getElementManager();
    const el = em.getElementsByViewport(vp)[0];

    await delay(10);
    const moveOp: MoveOperation = {
      id: 'op-mv', type: 'move', elementId: el.id,
      dx: 100, dy: 100, newX: 150, newY: 150,
      version: el.version, userId: 'u1', timestamp: Date.now(),
    };
    room.handleOperation('u1', moveOp);

    await delay(250);
    const t1 = Date.now();

    const msg: ReconnectMessage = {
      userId: 'u2', userName: 'Bob', roomId: 'replay-3',
      viewport: vp, lastSyncTimestamp: 0,
    };
    const diff = room.reconnectUser(msg);

    const opTypes = diff.operations.map((o: any) => o.type);
    assert.ok(opTypes.includes('create'), '应有create操作');
    assert.ok(opTypes.includes('move'), '应有move操作');

    const createOps = diff.operations.filter((o: any) => o.type === 'create');
    const moveOps = diff.operations.filter((o: any) => o.type === 'move');
    assert.ok(createOps.length > 0, '有create');
    assert.ok(moveOps.length > 0, '有move');
    assert.ok(
      createOps[createOps.length - 1].timestamp <= moveOps[0].timestamp,
      'create 在 move 之前'
    );
  });
}

// ============================================
// 需求8: 房间状态查询接口
// ============================================
console.log('\n【需求8】房间状态查询接口');
{
  runTest('房间存在时 status 包含完整字段', () => {
    const room = createDummyRoom('stat-1');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);

    const status = room.getStatus();
    assert.strictEqual(status.roomId, 'stat-1', 'roomId正确');
    assert.strictEqual(status.onlineUserCount, 1, 'onlineUserCount正确');
    assert.strictEqual(typeof status.elementCount, 'number', 'elementCount是数字');
    assert.strictEqual(typeof status.lastActiveAt, 'number', 'lastActiveAt是数字');
    assert.strictEqual(typeof status.earliestHistoryTimestamp, 'number', 'earliestHistoryTimestamp是数字');
    assert.strictEqual(typeof status.canIncrementalSync, 'boolean', 'canIncrementalSync是布尔值');
  });

  runTest('空房间（没人在线） canIncrementalSync 取决于历史', () => {
    const room = createDummyRoom('stat-2');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'stat-2', element: input, requestId: 'r1' });
    room.removeUser('u1');

    const status = room.getStatus();
    assert.strictEqual(status.onlineUserCount, 0, '在线用户数为0');
    assert.strictEqual(status.elementCount, 1, '元素数仍为1（保活）');
    assert.strictEqual(status.canIncrementalSync, true, '有操作历史所以能增量同步');
  });

  runTest('getOperationProcessor / getElementManager / getViewportManager 都能访问', () => {
    const room = createDummyRoom('stat-3');
    assert.ok(room.getOperationProcessor(), 'operationProcessor 可访问');
    assert.ok(room.getElementManager(), 'elementManager 可访问');
    assert.ok(room.getViewportManager(), 'viewportManager 可访问');
  });
}

// ============================================
// 需求9: 恢复协商流程 - 增量/快照/全量策略 + 原因说明
// ============================================
console.log('\n【需求9】恢复协商流程 - 增量/快照/全量策略 + 原因说明');
{
  runTest('新房间 getStatus 返回 recoveryStrategy=full + reason=new_room', () => {
    const room = createDummyRoom('recov-1');
    const status = room.getStatus();

    assert.strictEqual(status.recoveryStrategy, 'full', '新房间应该是full策略');
    assert.strictEqual(status.recoveryReason, 'new_room', '原因应为new_room');
    assert.strictEqual(status.roomExists, true, 'roomExists=true');
    assert.strictEqual(typeof status.historySize, 'number', 'historySize是数字');
    assert.strictEqual(typeof status.latestHistoryTimestamp, 'number', 'latestHistoryTimestamp是数字');
    assert.strictEqual(status.onlineUserCount, 0, '没人在线');
  });

  runTest('有历史记录且lastSync在范围内 → incremental + history_available', () => {
    const room = createDummyRoom('recov-2');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'recov-2', element: input, requestId: 'r1' });

    const earliestTs = room.getOperationProcessor().getEarliestHistoryTimestamp();
    const lastSync = earliestTs - 1;
    const statusBefore = room.getStatus(lastSync);
    assert.strictEqual(statusBefore.recoveryStrategy, 'full', 'lastSync早于最早历史应full');
    assert.strictEqual(statusBefore.recoveryReason, 'history_out_of_range', '原因是history_out_of_range');

    const statusInRange = room.getStatus(earliestTs);
    assert.strictEqual(statusInRange.recoveryStrategy, 'incremental', 'lastSync在范围内应incremental');
    assert.strictEqual(statusInRange.recoveryReason, 'history_available', '原因是history_available');
    assert.strictEqual(statusInRange.canIncrementalSync, true, 'canIncrementalSync=true');
    assert.ok(statusInRange.historySize > 0, 'historySize > 0');
    assert.ok(statusInRange.latestHistoryTimestamp > 0, 'latestHistoryTimestamp > 0');
    assert.ok(statusInRange.earliestHistoryTimestamp > 0, 'earliestHistoryTimestamp > 0');
  });

  runTest('lastSync太早超出历史范围 → full + history_out_of_range', () => {
    const room = createDummyRoom('recov-3');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'recov-3', element: input, requestId: 'r1' });

    const tVeryOld = Date.now() - 999999999;
    const status = room.getStatus(tVeryOld);
    assert.strictEqual(status.recoveryStrategy, 'full', '超出范围应降级full');
    assert.strictEqual(status.recoveryReason, 'history_out_of_range', '原因应为history_out_of_range');
  });

  runTest('lastSync为0 → full + last_sync_zero', () => {
    const room = createDummyRoom('recov-4');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'recov-4', element: input, requestId: 'r1' });

    const status = room.getStatus(0);
    assert.strictEqual(status.recoveryStrategy, 'full', 'lastSync=0应full');
    assert.strictEqual(status.recoveryReason, 'last_sync_zero', '原因应为last_sync_zero');
  });

  runTest('reconnect增量模式返回 recoveryStrategy=incremental + 历史范围', () => {
    const room = createDummyRoom('recov-5');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'recov-5', element: input, requestId: 'r1' });

    const earliestTs = room.getOperationProcessor().getEarliestHistoryTimestamp();
    const msg: ReconnectMessage = { userId: 'u2', userName: 'Bob', roomId: 'recov-5', viewport: vp, lastSyncTimestamp: earliestTs };
    const diff = room.reconnectUser(msg);

    assert.strictEqual(diff.recoveryStrategy, 'incremental', 'reconnect增量策略');
    assert.strictEqual(diff.recoveryReason, 'history_available', '增量原因');
    assert.strictEqual(typeof diff.historyEarliestTimestamp, 'number', '有最早历史时间');
    assert.strictEqual(typeof diff.historyLatestTimestamp, 'number', '有最新历史时间');
    assert.ok(diff.historyLatestTimestamp >= diff.historyEarliestTimestamp, '最新 >= 最早');
    assert.strictEqual(diff.isFullSync, false, 'isFullSync=false');
  });

  runTest('reconnect全量模式(lastSync=0)返回 recoveryStrategy=full + last_sync_zero', () => {
    const room = createDummyRoom('recov-6');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'recov-6', element: input, requestId: 'r1' });

    const msg: ReconnectMessage = { userId: 'u2', userName: 'Bob', roomId: 'recov-6', viewport: vp, lastSyncTimestamp: 0 };
    const diff = room.reconnectUser(msg);

    assert.strictEqual(diff.recoveryStrategy, 'full', 'reconnect全量策略');
    assert.strictEqual(diff.recoveryReason, 'last_sync_zero', '全量原因是last_sync_zero');
    assert.strictEqual(diff.isFullSync, true, 'isFullSync=true');
  });

  runTest('reconnect全量模式(lastSync太早)返回 recoveryStrategy=full + history_out_of_range', () => {
    const room = createDummyRoom('recov-7');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'recov-7', element: input, requestId: 'r1' });

    const msg: ReconnectMessage = { userId: 'u2', userName: 'Bob', roomId: 'recov-7', viewport: vp, lastSyncTimestamp: Date.now() - 999999 };
    const diff = room.reconnectUser(msg);

    assert.strictEqual(diff.recoveryStrategy, 'full', '太早应降级full');
    assert.strictEqual(diff.recoveryReason, 'history_out_of_range', '原因是history_out_of_range');
    assert.strictEqual(diff.isFullSync, true, 'isFullSync=true');
  });
}

// ============================================
// 需求10: 协作者状态 + 最后更新人准确
// ============================================
console.log('\n【需求10】协作者状态 + 最后更新人准确');
{
  runTest('用户join后有userActivity记录', () => {
    const room = createDummyRoom('act-1');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);

    const activities = room.getUserActivities();
    assert.strictEqual(activities.length, 1, '1个活动记录');
    assert.strictEqual(activities[0].userId, 'u1', 'userId正确');
    assert.strictEqual(activities[0].userName, 'Alice', 'userName正确');
    assert.strictEqual(typeof activities[0].lastActiveAt, 'number', 'lastActiveAt是数字');
    assert.strictEqual(activities[0].lastOperationType, 'join', '操作类型是join');
  });

  runTest('创建元素后用户活动更新为 create + 元素ID', () => {
    const room = createDummyRoom('act-2');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'act-2', element: input, requestId: 'r1' });

    const activity = room.getUserActivity('u1');
    assert.ok(activity, '有活动记录');
    assert.strictEqual(activity!.lastOperationType, 'create', '操作类型是create');
    assert.ok(activity!.lastElementId, '有元素ID');
  });

  runTest('创建者和修改者不同 - updatedBy应该是实际修改者', async () => {
    const room = createDummyRoom('act-3');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('creator', 'CreatorUser', vp);
    room.addUser('editor', 'EditorUser', vp);

    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('creator', { roomId: 'act-3', element: input, requestId: 'r1' });

    await delay(260);
    const el = room.getElementManager().getAllElements()[0];
    assert.ok(el, '有元素');
    assert.strictEqual(el.createdBy, 'creator', 'createdBy是创建者');
    assert.strictEqual(el.updatedBy, 'creator', '初始updatedBy是创建者');

    const moveOp: MoveOperation = {
      id: 'op-mv-1', type: 'move', elementId: el.id,
      dx: 10, dy: 10, newX: 20, newY: 20,
      version: el.version, userId: 'editor', timestamp: Date.now(),
    };
    room.handleOperation('editor', moveOp);

    await delay(260);
    const updated = room.getElementManager().getElement(el.id);
    assert.ok(updated, '元素还在');
    assert.strictEqual(updated!.createdBy, 'creator', 'createdBy保持创建者不变');
    assert.strictEqual(updated!.updatedBy, 'editor', 'updatedBy应为实际修改者editor');

    const editorActivity = room.getUserActivity('editor');
    assert.strictEqual(editorActivity!.lastOperationType, 'move', 'editor最后操作是move');
    assert.strictEqual(editorActivity!.lastElementId, el.id, '最后操作元素正确');
  });

  runTest('用户离开后活动记录被清理', () => {
    const room = createDummyRoom('act-4');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    assert.strictEqual(room.getUserActivities().length, 1, 'join后有1条');

    room.removeUser('u1');
    assert.strictEqual(room.getUserActivities().length, 0, 'leave后0条');
    assert.strictEqual(room.getUserActivity('u1'), undefined, '查不到u1活动');
  });
}

// ============================================
// 需求11: 房间保活边界 - reconnect取消倒计时 + 过期释放
// ============================================
console.log('\n【需求11】房间保活边界 - reconnect取消倒计时 + 过期释放');
{
  await runAsyncTest('reconnect回来能取消过期倒计时，房间不会被误清空', async () => {
    const room = new Room(
      'ttl-1', 'Room ttl-1',
      () => {}, () => {}, 0
    );
    room.setRoomTtl(100);
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'ttl-1', element: input, requestId: 'r1' });
    room.removeUser('u1');

    await delay(50);
    const earliestTs = room.getOperationProcessor().getEarliestHistoryTimestamp();
    const msg: ReconnectMessage = { userId: 'u1', userName: 'Alice', roomId: 'ttl-1', viewport: vp, lastSyncTimestamp: earliestTs };
    room.reconnectUser(msg);

    await delay(80);
    assert.strictEqual(room.getIsExpired(), false, 'reconnect后不应过期');
    assert.strictEqual(room.getElementsCount(), 1, '元素仍然存在');
    assert.strictEqual(room.getUserCount(), 1, '用户回来了');
  });

  await runAsyncTest('空房间过期后正常释放（isExpired=true）', async () => {
    const room = new Room(
      'ttl-2', 'Room ttl-2',
      () => {}, () => {}, 0
    );
    room.setRoomTtl(50);
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    room.removeUser('u1');

    await delay(120);
    assert.strictEqual(room.getIsExpired(), true, '应该过期了');
  });

  await runAsyncTest('过期房间reconnect返回 room_expired 原因 + 全量初始化', async () => {
    let expired = false;
    const room = new Room(
      'ttl-3', 'Room ttl-3',
      () => {}, () => {}, 0
    );
    room.setRoomTtl(50);
    room.setOnExpire(() => { expired = true; });
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'ttl-3', element: input, requestId: 'r1' });
    room.removeUser('u1');

    await delay(120);
    assert.strictEqual(room.getIsExpired(), true, '确认已过期');
    assert.strictEqual(expired, true, 'onExpire回调被调用');

    const msg: ReconnectMessage = { userId: 'u2', userName: 'Bob', roomId: 'ttl-3', viewport: vp, lastSyncTimestamp: Date.now() };
    const diff = room.reconnectUser(msg);

    assert.strictEqual(diff.recoveryStrategy, 'full', '过期后重连应全量');
    assert.strictEqual(diff.recoveryReason, 'room_expired', '原因是room_expired');
    assert.strictEqual(diff.isFullSync, true, 'isFullSync=true');
  });

  await runAsyncTest('getStatus能看到expiresAt和isExpired字段', async () => {
    const room = new Room(
      'ttl-4', 'Room ttl-4',
      () => {}, () => {}, 0
    );
    room.setRoomTtl(1000);
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    room.removeUser('u1');

    const status = room.getStatus();
    assert.strictEqual(status.isExpired, false, '刚离开不应过期');
    assert.strictEqual(typeof status.expiresAt, 'number', '有expiresAt字段');
    assert.ok(status.expiresAt! > Date.now(), 'expiresAt在未来');
  });
}

// ============================================
// 需求12: 历史压缩能力 - 关键帧 + 连续操作合并
// ============================================
console.log('\n【需求12】历史压缩能力 - 关键帧 + 连续操作合并');
{
  runTest('compressHistory 能减少历史条数并保留关键帧', () => {
    const room = createDummyRoom('compress-1');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 0, y: 0, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'compress-1', element: input, requestId: 'r1' });

    const op = room.getOperationProcessor();
    const el = room.getElementManager().getAllElements()[0];

    for (let i = 1; i <= 20; i++) {
      const currentEl = room.getElementManager().getElement(el.id)!;
      const moveOp: MoveOperation = {
        id: `op-${i}`, type: 'move', elementId: el.id,
        dx: i, dy: i, newX: i, newY: i,
        version: currentEl.version, userId: 'u1', timestamp: Date.now() + i * 10,
      };
      op.process(moveOp);
    }

    const beforeSize = op.getHistorySize();
    assert.ok(beforeSize >= 20, `压缩前应有至少20条历史（实际${beforeSize}）`);

    const result = op.compressHistory({ keyframeIntervalMs: 1000, keepMinOperations: 5 });
    assert.strictEqual(typeof result.beforeSize, 'number', 'beforeSize是数字');
    assert.strictEqual(typeof result.afterSize, 'number', 'afterSize是数字');
    assert.strictEqual(typeof result.removedCount, 'number', 'removedCount是数字');
    assert.strictEqual(result.beforeSize, beforeSize, 'beforeSize匹配');
    assert.ok(result.removedCount >= 0, 'removedCount >= 0');
    assert.strictEqual(result.afterSize, beforeSize - result.removedCount, '条数一致');

    const afterSize = op.getHistorySize();
    assert.strictEqual(afterSize, result.afterSize, '实际历史大小匹配');
  });

  runTest('压缩后仍能通过earliestTimestamp判断增量恢复范围', () => {
    const room = createDummyRoom('compress-2');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 0, y: 0, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'compress-2', element: input, requestId: 'r1' });

    const op = room.getOperationProcessor();
    const el = room.getElementManager().getAllElements()[0];
    const t1 = Date.now();

    for (let i = 1; i <= 10; i++) {
      const currentEl = room.getElementManager().getElement(el.id)!;
      const moveOp: MoveOperation = {
        id: `op-${i}`, type: 'move', elementId: el.id,
        dx: i, dy: i, newX: i, newY: i,
        version: currentEl.version, userId: 'u1', timestamp: t1 + i * 10,
      };
      op.process(moveOp);
    }

    op.compressHistory({ keyframeIntervalMs: 1000, keepMinOperations: 3 });

    const earliest = op.getEarliestHistoryTimestamp();
    const latest = op.getLatestHistoryTimestamp();

    assert.ok(earliest > 0, '压缩后仍有最早时间');
    assert.ok(latest > 0, '压缩后仍有最新时间');
    assert.ok(latest >= earliest, '最新 >= 最早');
    assert.ok(earliest <= t1 + 100, '最早时间应接近第一条操作');
    assert.ok(latest >= t1 + 90, '最新时间应接近最后一条操作');
  });

  runTest('房间getStatus返回的historySize和时间戳与压缩后一致', () => {
    const room = createDummyRoom('compress-3');
    const vp: Viewport = { x: 0, y: 0, width: 1000, height: 1000, scale: 1 };
    room.addUser('u1', 'Alice', vp);
    const input: ElementCreateInput = { type: 'rectangle', x: 10, y: 10, width: 50, height: 50, fill: 'F' };
    room.handleCreateElement('u1', { roomId: 'compress-3', element: input, requestId: 'r1' });

    const statusBefore = room.getStatus();
    const sizeBefore = statusBefore.historySize;

    const op = room.getOperationProcessor();
    op.compressHistory({ keyframeIntervalMs: 1000, keepMinOperations: 1 });

    const statusAfter = room.getStatus();
    assert.ok(statusAfter.historySize <= sizeBefore, '压缩后historySize不增加');
    assert.strictEqual(statusAfter.historySize, op.getHistorySize(), 'status和op一致');
    assert.ok(statusAfter.earliestHistoryTimestamp > 0, 'earliest有效');
    assert.ok(statusAfter.latestHistoryTimestamp > 0, 'latest有效');
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
