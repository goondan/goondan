import type { JsonObject, ObjectRefLike } from '@goondan/core';
interface SlackConnectorOptions {
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
        oauth?: {
            withContext?: (context: {
                auth?: JsonObject;
            }) => {
                getAccessToken: (request: {
                    oauthAppRef: ObjectRefLike;
                    scopes?: string[];
                }) => Promise<JsonObject>;
            };
        };
    };
    connectorConfig: JsonObject;
    logger?: Console;
}
export declare function createSlackConnector(options: SlackConnectorOptions): {
    handleEvent: (payload: JsonObject) => Promise<void>;
    send: (input: {
        text: string;
        origin?: JsonObject;
        auth?: JsonObject;
    }) => Promise<JsonObject>;
};
export {};
//# sourceMappingURL=index.d.ts.map