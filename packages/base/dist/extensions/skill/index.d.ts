import type { ExtensionApi, JsonObject } from '@goondan/core';
interface SkillEntry extends JsonObject {
    name: string;
    skillPath: string;
    dir: string;
}
interface SkillExtensionState {
    catalog: SkillEntry[];
    rootDir: string;
}
interface SkillExtensionConfig extends JsonObject {
    rootDir?: string;
}
export declare function register(api: ExtensionApi<SkillExtensionState, SkillExtensionConfig>): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map