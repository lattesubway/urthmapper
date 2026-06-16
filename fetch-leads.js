#!/usr/bin/env node
/**
 * Legacy CLI entry — delegates to scrape-leads.js (live county GIS pipeline)
 * Usage: node fetch-leads.js [--county NAME] [--output FILE] [--export-app]
 */

const { spawn } = require('child_process');
const path = require('path');

if (require.main === module) {
  const args = process.argv.slice(2);
  const child = spawn(process.execPath, [path.join(__dirname, 'scrape-leads.js'), ...args], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

module.exports = require('./scrape-leads.js');