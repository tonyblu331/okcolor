const fs = require('fs');
let css = '/* Complex real-world CSS fixture */\n:root {\n';
const colors = [
  '#3498db', '#e74c3c', '#f1c40f', '#2ecc71', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#95a5a6', '#d35400',
  'rgb(255, 0, 0)', 'rgb(0, 255, 0)', 'rgb(0, 0, 255)',
  'hsl(200, 80%, 50%)', 'hsl(120, 60%, 40%)',
  'hwb(30 20% 10%)', 'hwb(150 30% 20%)',
  'red', 'blue', 'green', 'rebeccapurple',
];
for (let i = 0; i < 200; i++) {
  const c1 = colors[i % colors.length];
  css += `  --c${i}: ${c1};\n`;
}
css += '}\n\n';
for (let i = 0; i < 100; i++) {
  const c1 = colors[i % colors.length];
  const c2 = colors[(i + 3) % colors.length];
  const c3 = colors[(i + 5) % colors.length];
  css += `.c${i} {\n  color: ${c1};\n  background: ${c2};\n  border-color: ${c3};\n  box-shadow: 0 0 10px ${c1};\n}\n\n`;
}
for (let i = 0; i < 20; i++) {
  css += `.g${i} { background: linear-gradient(to right, ${colors[i%colors.length]}, ${colors[(i+1)%colors.length]}); }\n`;
}
css += '.special { color: var(--primary); width: calc(100% - 20px); }\n';
fs.writeFileSync('complex.css', css);
console.log('Created complex.css:', (css.length/1024).toFixed(2), 'KB');
