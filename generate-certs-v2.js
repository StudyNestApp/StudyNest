#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const certDir = path.join(__dirname, 'certs');

// Ensure certs directory exists
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

// Generate self-signed certificate using OpenSSL
const cmd = 'openssl';
const args = [
  'req',
  '-x509',
  '-newkey', 'rsa:2048',
  '-keyout', path.join(certDir, 'key.pem'),
  '-out', path.join(certDir, 'cert.pem'),
  '-days', '365',
  '-nodes',
  '-subj', '/CN=localhost'
];

console.log('Generating self-signed certificates...');
const result = spawnSync(cmd, args, { stdio: 'pipe' });

if (result.error) {
  console.error('❌ Error: OpenSSL not found. Please install it from https://slproweb.com/products/Win32OpenSSL.html');
  process.exit(1);
}

if (result.status === 0) {
  console.log('✅ Certificates generated successfully!');
  console.log(`   Key: ${path.join(certDir, 'key.pem')}`);
  console.log(`   Cert: ${path.join(certDir, 'cert.pem')}`);
} else {
  console.error('❌ Failed to generate certificates');
  console.error(result.stderr.toString());
  process.exit(1);
}
