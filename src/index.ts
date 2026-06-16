import { WhiteboardServer } from './server';

const PORT = parseInt(process.env.PORT || '8080', 10);
const WORKER_ID = parseInt(process.env.WORKER_ID || '0', 10);

const server = new WhiteboardServer(undefined, PORT, WORKER_ID);

console.log(`Whiteboard server starting on port ${PORT}`);
console.log(`Worker ID: ${WORKER_ID}`);
console.log('Press Ctrl+C to stop');

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  server.close();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

export { WhiteboardServer } from './server';
export { Room } from './room';
export { ElementManager, SnowflakeIdGenerator } from './element-manager';
export { QuadTree } from './quadtree';
export { OperationProcessor } from './operation-processor';
export { ViewportManager } from './viewport-manager';
export { OperationBatcher } from './operation-batcher';
export * from './types';
