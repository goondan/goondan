/**
 * ToolContext Builder
 * @see /docs/specs/tool.md - 4.3 ToolContext 구조
 *
 * ToolContext를 안전하게 생성하기 위한 빌더 패턴 구현
 */

import type {
  ToolContext,
  ToolCatalogItem,
  SwarmInstance,
  Turn,
  Step,
  SwarmBundleApi,
  OAuthApi,
  EventBus,
  ToolAgentsApi,
} from './types.js';
import type { Resource } from '../types/resource.js';
import type { SwarmSpec, AgentSpec } from '../types/specs/index.js';

/**
 * ToolContext Builder
 *
 * 모든 필수 필드를 설정한 후 build()를 호출해야 합니다.
 */
export class ToolContextBuilder {
  private instance?: SwarmInstance;
  private swarm?: Resource<SwarmSpec>;
  private agent?: Resource<AgentSpec>;
  private turn?: Turn;
  private step?: Step;
  private toolCatalog?: ToolCatalogItem[];
  private swarmBundle?: SwarmBundleApi;
  private oauth?: OAuthApi;
  private events?: EventBus;
  private logger?: Console;
  private workdir?: string;
  private agents?: ToolAgentsApi;

  /**
   * SwarmInstance 설정
   */
  setInstance(instance: SwarmInstance): this {
    this.instance = instance;
    return this;
  }

  /**
   * Swarm 리소스 설정
   */
  setSwarm(swarm: Resource<SwarmSpec>): this {
    this.swarm = swarm;
    return this;
  }

  /**
   * Agent 리소스 설정
   */
  setAgent(agent: Resource<AgentSpec>): this {
    this.agent = agent;
    return this;
  }

  /**
   * Turn 설정
   */
  setTurn(turn: Turn): this {
    this.turn = turn;
    return this;
  }

  /**
   * Step 설정
   */
  setStep(step: Step): this {
    this.step = step;
    return this;
  }

  /**
   * Tool Catalog 설정
   */
  setToolCatalog(catalog: ToolCatalogItem[]): this {
    this.toolCatalog = catalog;
    return this;
  }

  /**
   * SwarmBundle API 설정
   */
  setSwarmBundleApi(api: SwarmBundleApi): this {
    this.swarmBundle = api;
    return this;
  }

  /**
   * OAuth API 설정
   */
  setOAuthApi(api: OAuthApi): this {
    this.oauth = api;
    return this;
  }

  /**
   * EventBus 설정
   */
  setEventBus(bus: EventBus): this {
    this.events = bus;
    return this;
  }

  /**
   * Logger 설정
   */
  setLogger(logger: Console): this {
    this.logger = logger;
    return this;
  }

  /**
   * Workdir 설정
   */
  setWorkdir(workdir: string): this {
    this.workdir = workdir;
    return this;
  }

  /**
   * Agents API 설정
   */
  setAgentsApi(agents: ToolAgentsApi): this {
    this.agents = agents;
    return this;
  }

  /**
   * ToolContext 생성
   *
   * @throws 필수 필드가 설정되지 않은 경우
   */
  build(): ToolContext {
    // 필수 필드 검증
    this.validateRequired('instance', this.instance);
    this.validateRequired('swarm', this.swarm);
    this.validateRequired('agent', this.agent);
    this.validateRequired('turn', this.turn);
    this.validateRequired('step', this.step);
    this.validateRequired('toolCatalog', this.toolCatalog);
    this.validateRequired('swarmBundle', this.swarmBundle);
    this.validateRequired('oauth', this.oauth);
    this.validateRequired('events', this.events);
    this.validateRequired('logger', this.logger);
    this.validateRequired('workdir', this.workdir);
    this.validateRequired('agents', this.agents);

    return {
      instance: this.instance,
      swarm: this.swarm,
      agent: this.agent,
      turn: this.turn,
      step: this.step,
      toolCatalog: this.toolCatalog,
      swarmBundle: this.swarmBundle,
      oauth: this.oauth,
      events: this.events,
      logger: this.logger,
      workdir: this.workdir,
      agents: this.agents,
    };
  }

  /**
   * 필수 필드 검증
   */
  private validateRequired<T>(name: string, value: T | undefined): asserts value is T {
    if (value === undefined) {
      throw new Error(`ToolContext build failed: '${name}' is required`);
    }
  }

  /**
   * 기존 컨텍스트에서 빌더 생성
   *
   * @param ctx - 기존 ToolContext
   * @returns 새 빌더
   */
  static from(ctx: ToolContext): ToolContextBuilder {
    return new ToolContextBuilder()
      .setInstance(ctx.instance)
      .setSwarm(ctx.swarm)
      .setAgent(ctx.agent)
      .setTurn(ctx.turn)
      .setStep(ctx.step)
      .setToolCatalog(ctx.toolCatalog)
      .setSwarmBundleApi(ctx.swarmBundle)
      .setOAuthApi(ctx.oauth)
      .setEventBus(ctx.events)
      .setLogger(ctx.logger)
      .setWorkdir(ctx.workdir)
      .setAgentsApi(ctx.agents);
  }

  /**
   * Tool Catalog만 변경한 새 컨텍스트 생성
   *
   * @param ctx - 기존 ToolContext
   * @param newCatalog - 새 Tool Catalog
   * @returns 새 ToolContext
   */
  static withToolCatalog(
    ctx: ToolContext,
    newCatalog: ToolCatalogItem[]
  ): ToolContext {
    return {
      ...ctx,
      toolCatalog: newCatalog,
    };
  }
}
