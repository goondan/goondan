import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const SAMPLE_WORKSPACE = join(process.cwd(), 'sample-workspace');

interface EvolveUpdate {
  path: string;
  content: string;
}

interface EvolveInput {
  summary: string;
  updates: EvolveUpdate[];
}

export async function evolve(input: EvolveInput): Promise<string> {
  const { summary, updates } = input;

  if (!updates || updates.length === 0) {
    return '업데이트할 파일이 없습니다.';
  }

  const results: string[] = [];

  for (const update of updates) {
    const fullPath = join(SAMPLE_WORKSPACE, update.path);
    
    // 샘플 워크스페이스 외부 접근 차단
    if (!fullPath.startsWith(SAMPLE_WORKSPACE)) {
      results.push(`❌ ${update.path}: 접근 거부 (워크스페이스 외부)`);
      continue;
    }

    try {
      // 디렉토리 생성
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // 파일 쓰기
      writeFileSync(fullPath, update.content, 'utf-8');
      results.push(`✅ ${update.path}: 업데이트 완료`);
    } catch (error) {
      results.push(`❌ ${update.path}: ${error}`);
    }
  }

  const resultMessage = `📝 ${summary}\n\n${results.join('\n')}`;
  
  // 파일 업데이트 후 에이전트 재시작 트리거
  console.log('파일 업데이트 완료. 에이전트 재시작 요청...');
  setTimeout(() => {
    process.exit(0);
  }, 1000);

  return resultMessage;
}
