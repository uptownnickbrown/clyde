#!/usr/bin/env node
// clyde — run from a project root (or pass one): `clyde .`
// One process = one project, Jupyter-style.
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from './server.js';

const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  console.error(`Not a directory: ${projectRoot}`);
  process.exit(1);
}
const port = Number(process.env.CLYDE_PORT ?? 4100);
void startServer(projectRoot, port);
