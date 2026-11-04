#!/usr/bin/env node
// Startet den Assistenten. Danach im Browser öffnen: http://localhost:3000

import { createApp } from './src/app.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Der Assistent braucht Node.js 20 oder neuer (du hast ${process.versions.node}). Lade die LTS-Version von https://nodejs.org`);
  process.exit(1);
}

const app = createApp();
process.env.TZ = app.stores.config.data.timezone;

try {
  await app.listen();
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${app.port} ist schon belegt – läuft der Assistent vielleicht schon? Öffne http://localhost:${app.port}\n`);
  } else console.error(err);
  process.exit(1);
}

app.planner.start();
const cleaned = app.todos.cleanup();

console.log('');
console.log('  Assistent läuft.');
console.log(`  Im Browser öffnen:  http://localhost:${app.port}`);
for (const u of app.lanUrls()) console.log(`  Im WLAN (iPhone):   ${u}`);
if (!app.stores.secrets.data.passwordHash) {
  console.log('');
  console.log(`  Einrichtungscode: ${app.setupCode}`);
  console.log('  (nur nötig, wenn du die Einrichtung nicht direkt auf diesem Rechner machst)');
}
if (cleaned) console.log(`  ${cleaned} alte erledigte To-dos aufgeräumt.`);
console.log('');
console.log('  Beenden mit Ctrl+C');
console.log('');

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
