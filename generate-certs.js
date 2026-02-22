const fs = require('fs');
const path = require('path');

// Try using the selfsigned package
try {
  const selfsigned = require('selfsigned');
  
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const { private: privateKey, cert } = selfsigned.generate(attrs, { 
    days: 365,
    keySize: 2048,
    algorithm: 'sha256'
  });
  
  const certDir = path.join(__dirname, 'certs');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }
  
  fs.writeFileSync(path.join(certDir, 'key.pem'), privateKey);
  fs.writeFileSync(path.join(certDir, 'cert.pem'), cert);
  
  console.log('✅ Certificates generated successfully at certs/');
} catch (err) {
  console.log('selfsigned package not found. Installing...');
  const { execSync } = require('child_process');
  execSync('npm install selfsigned', { stdio: 'inherit' });
  console.log('Please run this script again');
}
