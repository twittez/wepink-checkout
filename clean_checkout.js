const fs = require('fs');

const filepath = 'C:\\Users\\luanl\\.gemini\\antigravity\\scratch\\tiktok-product-clone\\checkout.js';
let content = fs.readFileSync(filepath, 'utf8');

// Use regex to match console.error('[Cartão] Erro:', err); followed by any character up to function showPixSuccess
const regex = /console\.error\('\[Cartão\] Erro:', err\);[\s\S]*?(?=function showPixSuccess)/;

if (regex.test(content)) {
  const match = content.match(regex)[0];
  console.log('Match found:\n', match);
  const replacement = `console.error('[Cartão] Erro:', err);
      showToast('❌ Erro de conexão. Tente novamente.');
    }
    return;
  }
});

\n`;
  content = content.replace(regex, replacement);
  fs.writeFileSync(filepath, content, 'utf8');
  console.log('✓ SUCCESS: Repaired with regex.');
} else {
  console.log('✗ ERROR: Regex did not match.');
}
