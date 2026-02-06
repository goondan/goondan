/**
 * src/ 하위의 YAML 파일을 dist/로 디렉토리 구조 유지하며 복사
 * tsc는 .yaml 파일을 복사하지 않으므로 빌드 후 실행
 */

import { readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

function copyYamlFiles(srcDir, dstDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);

    if (entry.isDirectory()) {
      copyYamlFiles(srcPath, dstPath);
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      mkdirSync(dirname(dstPath), { recursive: true });
      copyFileSync(srcPath, dstPath);
    }
  }
}

copyYamlFiles('src', 'dist');
