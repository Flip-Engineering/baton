#!/usr/bin/env node
import { serveResidentMcp } from '../src/resident-mcp-entry.mjs';

await serveResidentMcp({ claudeRoot: true });
