import type { JsonObject, ObjectRefLike } from '@goondan/core';
interface CliConnectorOptions {
    runtime: {
        handleEvent: (event: {
            swarmRef: ObjectRefLike;
            instanceKey: string;
            agentName?: string;
            input: string;
            origin?: JsonObject;
            auth?: JsonObject;
            metadata?: JsonObject;
        }) => Promise<void>;
    };
    connectorConfig: JsonObject;
    logger?: Console;
}
export declare function createCliConnector(options: CliConnectorOptions): {
    handleEvent: (payload: JsonObject) => Promise<void>;
    postMessage: (input: {
        text: string;
    }) => Promise<{
        ok: true;
    }>;
};
export {};
//# sourceMappingURL=index.d.ts.map