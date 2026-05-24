const fs = require('fs');

function pin(deps) {
  if (!deps) return;
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('^')) {
      try {
        const pkg = JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, 'utf8'));
        deps[name] = pkg.version;
      } catch (e) {
        // keep original if can't read
      }
    }
  }
}

const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pin(root.devDependencies);
pin(root.peerDependencies);
fs.writeFileSync('package.json', JSON.stringify(root, null, 2) + '\n');

const docs = JSON.parse(fs.readFileSync('packages/docs/package.json', 'utf8'));
pin(docs.dependencies);
fs.writeFileSync('packages/docs/package.json', JSON.stringify(docs, null, 2) + '\n');

console.log('Pinned versions');
