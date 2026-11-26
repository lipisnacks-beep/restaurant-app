/**
 * Boots an in-memory MongoDB on a fixed port and keeps running (keeper
 * process) so the dev server / E2E scripts can connect for local testing.
 * Writes the connection URI to /tmp/local_mongo_uri when ready.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';

async function main() {
  const mongod = await MongoMemoryServer.create({
    instance: { port: 27077, dbName: 'rms_local' },
  });
  const uri = mongod.getUri('rms_local');
  fs.writeFileSync('/tmp/local_mongo_uri', uri);
  console.log('local mongo ready:', uri);
  console.log('pid keeper alive');
  const stop = () => { mongod.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30); // keep alive
}
main().catch((e) => { console.error(e); process.exit(1); });
