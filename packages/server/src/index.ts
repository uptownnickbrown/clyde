#!/usr/bin/env node
// clyde — run from a project root (or pass one): `clyde .`
// One process = one project, Jupyter-style.
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from './server.js';

const args = process.argv.slice(2);
const freshSession = args.includes('--new');
const rootArg = args.find((a) => !a.startsWith('--'));
const projectRoot = path.resolve(rootArg ?? process.cwd());
if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  console.error(`Not a directory: ${projectRoot}`);
  process.exit(1);
}
const port = Number(process.env.CLYDE_PORT ?? 4100);
void startServer(projectRoot, port, freshSession);
