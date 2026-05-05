#!/usr/bin/env node
// Uploads Localiza 2026 fleet images to Vercel Blob and prints a JSON map.
// Run: node --env-file=.env.local scripts/upload-localiza-images.mjs <source-dir>
import { put } from '@vercel/blob';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('Usage: node scripts/upload-localiza-images.mjs <source-dir>');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing BLOB_READ_WRITE_TOKEN. Run with: node --env-file=.env.local ...');
  process.exit(1);
}

const result = {};
const gamaDirs = readdirSync(sourceDir).filter((d) => statSync(join(sourceDir, d)).isDirectory());

for (const gamaDir of gamaDirs) {
  const gamaPath = join(sourceDir, gamaDir);
  const files = readdirSync(gamaPath).filter((f) => f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png'));
  for (const file of files) {
    const filePath = join(gamaPath, file);
    const data = readFileSync(filePath);
    const key = `${gamaDir}/${basename(file)}`;
    const blobPath = `rentacar/localiza-2026/${gamaDir}-${file}`;
    process.stderr.write(`Uploading ${key}... `);
    const blob = await put(blobPath, data, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.endsWith('.png') ? 'image/png' : 'image/jpeg',
    });
    process.stderr.write(`OK\n`);
    result[key] = blob.url;
  }
}

console.log(JSON.stringify(result, null, 2));
