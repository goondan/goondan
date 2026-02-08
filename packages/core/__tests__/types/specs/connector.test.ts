/**
 * Connector Spec 타입 테스트 (v1.0)
 * @see /docs/specs/connector.md
 * @see /docs/specs/resources.md - 6.6 Connector
 */
import { describe, it, expect } from 'vitest';
import type {
  ConnectorSpec,
  TriggerDeclaration,
  HttpTrigger,
  CronTrigger,
  CliTrigger,
  EventSchema,
  EventPropertyType,
  ConnectorResource,
} from '../../../src/types/specs/connector.js';

describe('ConnectorSpec 타입 (v1.0)', () => {
  describe('ConnectorSpec 인터페이스', () => {
    it('runtime, entry, triggers는 필수이다', () => {
      const spec: ConnectorSpec = {
        runtime: 'node',
        entry: './connectors/slack/index.ts',
        triggers: [
          { type: 'http', endpoint: { path: '/webhook/slack', method: 'POST' } },
        ],
      };

      expect(spec.runtime).toBe('node');
      expect(spec.entry).toBe('./connectors/slack/index.ts');
      expect(spec.triggers).toHaveLength(1);
    });

    it('events는 선택적이다', () => {
      const spec: ConnectorSpec = {
        runtime: 'node',
        entry: './connectors/cli/index.ts',
        triggers: [{ type: 'cli' }],
        events: [
          { name: 'user_input' },
        ],
      };

      expect(spec.events).toHaveLength(1);
      expect(spec.events?.[0]?.name).toBe('user_input');
    });
  });

  describe('TriggerDeclaration', () => {
    it('HTTP trigger를 정의할 수 있다', () => {
      const trigger: HttpTrigger = {
        type: 'http',
        endpoint: {
          path: '/webhook/slack/events',
          method: 'POST',
        },
      };

      expect(trigger.type).toBe('http');
      expect(trigger.endpoint.path).toBe('/webhook/slack/events');
      expect(trigger.endpoint.method).toBe('POST');
    });

    it('Cron trigger를 정의할 수 있다', () => {
      const trigger: CronTrigger = {
        type: 'cron',
        schedule: '0 9 * * MON-FRI',
      };

      expect(trigger.type).toBe('cron');
      expect(trigger.schedule).toBe('0 9 * * MON-FRI');
    });

    it('CLI trigger를 정의할 수 있다', () => {
      const trigger: CliTrigger = {
        type: 'cli',
      };

      expect(trigger.type).toBe('cli');
    });

    it('discriminated union으로 trigger 타입을 구분할 수 있다', () => {
      const triggers: TriggerDeclaration[] = [
        { type: 'http', endpoint: { path: '/webhook', method: 'POST' } },
        { type: 'cron', schedule: '* * * * *' },
        { type: 'cli' },
      ];

      expect(triggers).toHaveLength(3);
      expect(triggers[0]?.type).toBe('http');
      expect(triggers[1]?.type).toBe('cron');
      expect(triggers[2]?.type).toBe('cli');
    });
  });

  describe('EventSchema', () => {
    it('이벤트 이름만으로 정의할 수 있다', () => {
      const schema: EventSchema = {
        name: 'user_input',
      };

      expect(schema.name).toBe('user_input');
      expect(schema.properties).toBeUndefined();
    });

    it('이벤트 속성 타입을 정의할 수 있다', () => {
      const schema: EventSchema = {
        name: 'app_mention',
        properties: {
          channel_id: { type: 'string' },
          ts: { type: 'string' },
          thread_ts: { type: 'string', optional: true },
        },
      };

      expect(schema.name).toBe('app_mention');
      expect(schema.properties?.['channel_id']?.type).toBe('string');
      expect(schema.properties?.['thread_ts']?.optional).toBe(true);
    });

    it('EventPropertyType는 string, number, boolean 타입을 지원한다', () => {
      const stringProp: EventPropertyType = { type: 'string' };
      const numberProp: EventPropertyType = { type: 'number' };
      const boolProp: EventPropertyType = { type: 'boolean', optional: true };

      expect(stringProp.type).toBe('string');
      expect(numberProp.type).toBe('number');
      expect(boolProp.type).toBe('boolean');
      expect(boolProp.optional).toBe(true);
    });
  });

  describe('ConnectorResource 타입', () => {
    it('Slack Connector 리소스를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'slack' },
        spec: {
          runtime: 'node',
          entry: './connectors/slack/index.ts',
          triggers: [
            { type: 'http', endpoint: { path: '/webhook/slack/events', method: 'POST' } },
          ],
          events: [
            {
              name: 'app_mention',
              properties: {
                channel_id: { type: 'string' },
                ts: { type: 'string' },
                thread_ts: { type: 'string', optional: true },
              },
            },
            {
              name: 'message.im',
              properties: {
                channel_id: { type: 'string' },
                ts: { type: 'string' },
              },
            },
          ],
        },
      };

      expect(resource.kind).toBe('Connector');
      expect(resource.spec.runtime).toBe('node');
      expect(resource.spec.entry).toBe('./connectors/slack/index.ts');
      expect(resource.spec.triggers).toHaveLength(1);
      expect(resource.spec.events).toHaveLength(2);
    });

    it('CLI Connector 리소스를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'cli' },
        spec: {
          runtime: 'node',
          entry: './connectors/cli/index.ts',
          triggers: [{ type: 'cli' }],
          events: [{ name: 'user_input' }],
        },
      };

      expect(resource.kind).toBe('Connector');
      expect(resource.spec.triggers[0]?.type).toBe('cli');
    });

    it('Cron Connector 리소스를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'daily-reporter' },
        spec: {
          runtime: 'node',
          entry: './connectors/daily-reporter/index.ts',
          triggers: [{ type: 'cron', schedule: '0 9 * * MON-FRI' }],
          events: [
            {
              name: 'daily_report',
              properties: {
                scheduled_at: { type: 'string' },
              },
            },
          ],
        },
      };

      expect(resource.kind).toBe('Connector');
      expect(resource.spec.triggers[0]?.type).toBe('cron');
    });

    it('여러 trigger를 가진 Connector를 정의할 수 있다', () => {
      const resource: ConnectorResource = {
        apiVersion: 'agents.example.io/v1alpha1',
        kind: 'Connector',
        metadata: { name: 'multi-trigger' },
        spec: {
          runtime: 'node',
          entry: './connectors/multi/index.ts',
          triggers: [
            { type: 'http', endpoint: { path: '/webhook', method: 'POST' } },
            { type: 'cron', schedule: '*/5 * * * *' },
          ],
        },
      };

      expect(resource.spec.triggers).toHaveLength(2);
    });
  });
});
