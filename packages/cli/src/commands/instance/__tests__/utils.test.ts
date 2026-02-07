/**
 * Instance utils 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  isSwarmEventRecord,
  isAgentEventRecord,
  readJsonlFile,
  countJsonlLines,
  findInstancePath,
  formatDate,
  formatStatus,
  determineInstanceStatus,
  countTurns,
  getInstanceInfo,
  getInstanceBasicInfo,
  getGoondanHomeSync,
} from "../utils.js";
import type { SwarmEventRecord, AgentEventRecord } from "../utils.js";

// ============================================================================
// Type Guard 테스트
// ============================================================================

describe("isSwarmEventRecord", () => {
  it("유효한 SwarmEventRecord를 인식한다", () => {
    const record = {
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "swarm.created",
      instanceId: "test-instance",
      instanceKey: "test-key",
      swarmName: "test-swarm",
    };

    expect(isSwarmEventRecord(record)).toBe(true);
  });

  it("null을 거부한다", () => {
    expect(isSwarmEventRecord(null)).toBe(false);
  });

  it("undefined를 거부한다", () => {
    expect(isSwarmEventRecord(undefined)).toBe(false);
  });

  it("type이 다르면 거부한다", () => {
    const record = {
      type: "agent.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "swarm.created",
      instanceId: "test-instance",
      swarmName: "test-swarm",
    };

    expect(isSwarmEventRecord(record)).toBe(false);
  });

  it("필수 필드가 누락되면 거부한다", () => {
    const record = {
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "swarm.created",
      // instanceId 누락
      swarmName: "test-swarm",
    };

    expect(isSwarmEventRecord(record)).toBe(false);
  });

  it("optional 필드(agentName, data)는 없어도 통과한다", () => {
    const record = {
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "agent.created",
      instanceId: "test-instance",
      instanceKey: "test-key",
      swarmName: "test-swarm",
    };

    expect(isSwarmEventRecord(record)).toBe(true);
  });
});

describe("isAgentEventRecord", () => {
  it("유효한 AgentEventRecord를 인식한다", () => {
    const record = {
      type: "agent.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "turn.completed",
      instanceId: "test-instance",
      instanceKey: "test-key",
      agentName: "test-agent",
    };

    expect(isAgentEventRecord(record)).toBe(true);
  });

  it("type이 다르면 거부한다", () => {
    const record = {
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "turn.completed",
      instanceId: "test-instance",
      agentName: "test-agent",
    };

    expect(isAgentEventRecord(record)).toBe(false);
  });

  it("agentName이 누락되면 거부한다", () => {
    const record = {
      type: "agent.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "turn.completed",
      instanceId: "test-instance",
    };

    expect(isAgentEventRecord(record)).toBe(false);
  });
});

// ============================================================================
// JSONL 유틸리티 테스트
// ============================================================================

describe("readJsonlFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("JSONL 파일을 파싱하고 타입 가드로 필터링한다", () => {
    const filePath = path.join(tmpDir, "events.jsonl");
    const records = [
      { type: "swarm.event", recordedAt: "2024-01-01T00:00:00.000Z", kind: "swarm.created", instanceId: "inst-1", instanceKey: "key-1", swarmName: "swarm-1" },
      { type: "swarm.event", recordedAt: "2024-01-01T00:01:00.000Z", kind: "swarm.started", instanceId: "inst-1", instanceKey: "key-1", swarmName: "swarm-1" },
    ];

    fs.writeFileSync(
      filePath,
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );

    const result = readJsonlFile(filePath, isSwarmEventRecord);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe("swarm.created");
    expect(result[1]?.kind).toBe("swarm.started");
  });

  it("존재하지 않는 파일은 빈 배열을 반환한다", () => {
    const result = readJsonlFile(
      path.join(tmpDir, "nonexistent.jsonl"),
      isSwarmEventRecord,
    );
    expect(result).toEqual([]);
  });

  it("잘못된 JSON 줄은 건너뛴다", () => {
    const filePath = path.join(tmpDir, "mixed.jsonl");
    const validLine = JSON.stringify({
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "swarm.created",
      instanceId: "inst-1",
      instanceKey: "key-1",
      swarmName: "swarm-1",
    });

    fs.writeFileSync(filePath, `${validLine}\ninvalid-json\n${validLine}\n`);

    const result = readJsonlFile(filePath, isSwarmEventRecord);
    expect(result).toHaveLength(2);
  });

  it("빈 줄은 무시한다", () => {
    const filePath = path.join(tmpDir, "empty-lines.jsonl");
    const validLine = JSON.stringify({
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "swarm.created",
      instanceId: "inst-1",
      instanceKey: "key-1",
      swarmName: "swarm-1",
    });

    fs.writeFileSync(filePath, `${validLine}\n\n\n${validLine}\n`);

    const result = readJsonlFile(filePath, isSwarmEventRecord);
    expect(result).toHaveLength(2);
  });

  it("타입 가드에 맞지 않는 레코드는 필터링한다", () => {
    const filePath = path.join(tmpDir, "mixed-types.jsonl");
    const swarmEvent = JSON.stringify({
      type: "swarm.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "swarm.created",
      instanceId: "inst-1",
      instanceKey: "key-1",
      swarmName: "swarm-1",
    });
    const agentEvent = JSON.stringify({
      type: "agent.event",
      recordedAt: "2024-01-01T00:00:00.000Z",
      kind: "turn.completed",
      instanceId: "inst-1",
      instanceKey: "key-1",
      agentName: "agent-1",
    });

    fs.writeFileSync(filePath, `${swarmEvent}\n${agentEvent}\n`);

    const swarmResults = readJsonlFile(filePath, isSwarmEventRecord);
    expect(swarmResults).toHaveLength(1);

    const agentResults = readJsonlFile(filePath, isAgentEventRecord);
    expect(agentResults).toHaveLength(1);
  });
});

describe("countJsonlLines", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("비어있지 않은 줄 수를 센다", () => {
    const filePath = path.join(tmpDir, "test.jsonl");
    fs.writeFileSync(filePath, "line1\nline2\n\nline3\n");

    expect(countJsonlLines(filePath)).toBe(3);
  });

  it("존재하지 않는 파일은 0을 반환한다", () => {
    expect(countJsonlLines(path.join(tmpDir, "nonexistent.jsonl"))).toBe(0);
  });
});

// ============================================================================
// Formatting 테스트
// ============================================================================

describe("formatDate", () => {
  it("날짜를 YYYY-MM-DD HH:mm:ss 형식으로 포매팅한다", () => {
    const date = new Date(2024, 0, 15, 9, 30, 45); // 2024-01-15 09:30:45

    expect(formatDate(date)).toBe("2024-01-15 09:30:45");
  });

  it("한 자리 수는 0으로 패딩한다", () => {
    const date = new Date(2024, 0, 1, 1, 2, 3); // 2024-01-01 01:02:03

    expect(formatDate(date)).toBe("2024-01-01 01:02:03");
  });
});

describe("formatStatus", () => {
  it("active 상태를 포매팅한다", () => {
    const result = formatStatus("active");
    expect(result).toContain("active");
  });

  it("idle 상태를 포매팅한다", () => {
    const result = formatStatus("idle");
    expect(result).toContain("idle");
  });

  it("completed 상태를 포매팅한다", () => {
    const result = formatStatus("completed");
    expect(result).toContain("completed");
  });
});

// ============================================================================
// Instance Status 테스트
// ============================================================================

describe("determineInstanceStatus", () => {
  it("swarm.stopped 이벤트는 completed 상태를 반환한다", () => {
    const event: SwarmEventRecord = {
      type: "swarm.event",
      recordedAt: new Date().toISOString(),
      kind: "swarm.stopped",
      instanceId: "test",
      instanceKey: "key",
      swarmName: "swarm",
    };

    expect(determineInstanceStatus(event)).toBe("completed");
  });

  it("최근 swarm.started 이벤트는 active 상태를 반환한다", () => {
    const event: SwarmEventRecord = {
      type: "swarm.event",
      recordedAt: new Date().toISOString(), // 현재 시간
      kind: "swarm.started",
      instanceId: "test",
      instanceKey: "key",
      swarmName: "swarm",
    };

    expect(determineInstanceStatus(event)).toBe("active");
  });

  it("오래된 swarm.started 이벤트는 idle 상태를 반환한다", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const event: SwarmEventRecord = {
      type: "swarm.event",
      recordedAt: tenMinutesAgo.toISOString(),
      kind: "swarm.started",
      instanceId: "test",
      instanceKey: "key",
      swarmName: "swarm",
    };

    expect(determineInstanceStatus(event)).toBe("idle");
  });

  it("기타 이벤트는 idle 상태를 반환한다", () => {
    const event: SwarmEventRecord = {
      type: "swarm.event",
      recordedAt: new Date().toISOString(),
      kind: "swarm.created",
      instanceId: "test",
      instanceKey: "key",
      swarmName: "swarm",
    };

    expect(determineInstanceStatus(event)).toBe("idle");
  });
});

// ============================================================================
// Instance Path 테스트
// ============================================================================

describe("findInstancePath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("존재하지 않는 instancesRoot는 null을 반환한다", () => {
    const result = findInstancePath(
      path.join(tmpDir, "nonexistent"),
      "test-id",
    );
    expect(result).toBeNull();
  });

  it("인스턴스를 찾으면 경로와 workspaceId를 반환한다", () => {
    const workspaceId = "abc123def456";
    const instanceId = "test-instance";
    const instancePath = path.join(tmpDir, workspaceId, instanceId);

    fs.mkdirSync(instancePath, { recursive: true });

    const result = findInstancePath(tmpDir, instanceId);
    expect(result).not.toBeNull();
    expect(result?.instancePath).toBe(instancePath);
    expect(result?.workspaceId).toBe(workspaceId);
  });

  it("인스턴스가 없으면 null을 반환한다", () => {
    const workspaceId = "abc123def456";
    fs.mkdirSync(path.join(tmpDir, workspaceId), { recursive: true });

    const result = findInstancePath(tmpDir, "nonexistent-id");
    expect(result).toBeNull();
  });
});

// ============================================================================
// Instance Info 테스트
// ============================================================================

describe("getInstanceInfo", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("swarm events가 있으면 InstanceInfo를 반환한다", () => {
    const instancePath = path.join(tmpDir, "test-instance");
    const eventsDir = path.join(instancePath, "swarm", "events");
    fs.mkdirSync(eventsDir, { recursive: true });

    const events = [
      {
        type: "swarm.event",
        recordedAt: "2024-01-01T00:00:00.000Z",
        kind: "swarm.created",
        instanceId: "test-instance",
        instanceKey: "test-key",
        swarmName: "my-swarm",
      },
      {
        type: "swarm.event",
        recordedAt: "2024-01-01T00:01:00.000Z",
        kind: "swarm.stopped",
        instanceId: "test-instance",
        instanceKey: "test-key",
        swarmName: "my-swarm",
      },
    ];

    fs.writeFileSync(
      path.join(eventsDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result = getInstanceInfo(instancePath, "test-instance", "ws-123");
    expect(result).not.toBeNull();
    expect(result?.instanceId).toBe("test-instance");
    expect(result?.swarmName).toBe("my-swarm");
    expect(result?.status).toBe("completed");
    expect(result?.workspaceId).toBe("ws-123");
  });

  it("swarm events가 없으면 null을 반환한다", () => {
    const instancePath = path.join(tmpDir, "empty-instance");
    fs.mkdirSync(instancePath, { recursive: true });

    const result = getInstanceInfo(instancePath, "empty-instance", "ws-123");
    expect(result).toBeNull();
  });
});

describe("getInstanceBasicInfo", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("기본 정보를 반환한다", () => {
    const instancePath = path.join(tmpDir, "test-instance");
    const eventsDir = path.join(instancePath, "swarm", "events");
    const agentDir = path.join(instancePath, "agents", "planner");
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    const events = [
      {
        type: "swarm.event",
        recordedAt: "2024-01-01T00:00:00.000Z",
        kind: "swarm.created",
        instanceId: "test-instance",
        instanceKey: "cli-12345",
        swarmName: "my-swarm",
      },
      {
        type: "swarm.event",
        recordedAt: "2024-01-01T01:00:00.000Z",
        kind: "swarm.started",
        instanceId: "test-instance",
        instanceKey: "cli-12345",
        swarmName: "my-swarm",
      },
    ];

    fs.writeFileSync(
      path.join(eventsDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    const result = getInstanceBasicInfo(instancePath);
    expect(result).not.toBeNull();
    expect(result?.swarmName).toBe("my-swarm");
    expect(result?.instanceKey).toBe("cli-12345");
    expect(result?.agentCount).toBe(1);
    expect(result?.lastEventTime).toBeInstanceOf(Date);
  });

  it("events가 없으면 null을 반환한다", () => {
    const instancePath = path.join(tmpDir, "empty");
    fs.mkdirSync(instancePath, { recursive: true });

    const result = getInstanceBasicInfo(instancePath);
    expect(result).toBeNull();
  });
});

// ============================================================================
// countTurns 테스트
// ============================================================================

describe("countTurns", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gdn-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("turn.completed 이벤트를 카운트한다", () => {
    const instancePath = path.join(tmpDir, "test-instance");
    const agentEventsDir = path.join(instancePath, "agents", "planner", "events");
    fs.mkdirSync(agentEventsDir, { recursive: true });

    const events = [
      { type: "agent.event", recordedAt: "2024-01-01T00:00:00.000Z", kind: "turn.started", instanceId: "inst", instanceKey: "key", agentName: "planner", turnId: "t1" },
      { type: "agent.event", recordedAt: "2024-01-01T00:01:00.000Z", kind: "turn.completed", instanceId: "inst", instanceKey: "key", agentName: "planner", turnId: "t1" },
      { type: "agent.event", recordedAt: "2024-01-01T00:02:00.000Z", kind: "turn.started", instanceId: "inst", instanceKey: "key", agentName: "planner", turnId: "t2" },
      { type: "agent.event", recordedAt: "2024-01-01T00:03:00.000Z", kind: "turn.completed", instanceId: "inst", instanceKey: "key", agentName: "planner", turnId: "t2" },
    ];

    fs.writeFileSync(
      path.join(agentEventsDir, "events.jsonl"),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );

    expect(countTurns(instancePath)).toBe(2);
  });

  it("agents 디렉터리가 없으면 0을 반환한다", () => {
    const instancePath = path.join(tmpDir, "empty");
    fs.mkdirSync(instancePath, { recursive: true });

    expect(countTurns(instancePath)).toBe(0);
  });
});

// ============================================================================
// getGoondanHomeSync 테스트
// ============================================================================

describe("getGoondanHomeSync", () => {
  it("stateRoot가 주어지면 해당 경로를 반환한다", () => {
    const result = getGoondanHomeSync("/custom/state/root");
    expect(result).toBe("/custom/state/root");
  });

  it("stateRoot가 없으면 기본 경로를 반환한다", () => {
    const originalEnv = process.env.GOONDAN_STATE_ROOT;
    delete process.env.GOONDAN_STATE_ROOT;

    try {
      const result = getGoondanHomeSync();
      expect(result).toBe(path.join(os.homedir(), ".goondan"));
    } finally {
      if (originalEnv !== undefined) {
        process.env.GOONDAN_STATE_ROOT = originalEnv;
      }
    }
  });

  it("환경 변수가 설정되면 해당 경로를 반환한다", () => {
    const originalEnv = process.env.GOONDAN_STATE_ROOT;
    process.env.GOONDAN_STATE_ROOT = "/env/state/root";

    try {
      const result = getGoondanHomeSync();
      expect(result).toBe("/env/state/root");
    } finally {
      if (originalEnv !== undefined) {
        process.env.GOONDAN_STATE_ROOT = originalEnv;
      } else {
        delete process.env.GOONDAN_STATE_ROOT;
      }
    }
  });
});
