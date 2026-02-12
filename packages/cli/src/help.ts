export function getMainHelp(): string {
  return [
    'Goondan CLI (gdn)',
    '',
    '사용법:',
    '  gdn <command> [subcommand] [options]',
    '',
    '명령어:',
    '  run                    Orchestrator 기동',
    '  restart                실행 중인 Orchestrator 재시작 신호',
    '  validate               Bundle 구성 검증',
    '  instance list/delete   인스턴스 조회/삭제',
    '  package add/install/publish  패키지 관리',
    '  doctor                 환경 진단',
    '',
    '전역 옵션:',
    '  --help, -h',
    '  --version, -V',
    '  --config <path>, -c',
    '  --state-root <path>',
    '  --json',
  ].join('\n');
}
