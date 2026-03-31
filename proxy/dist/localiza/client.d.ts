interface LocalizaConfig {
    endpoint: string;
    username: string;
    password: string;
    token: string;
    requestorId: string;
}
export declare function getConfig(): LocalizaConfig;
export declare function callLocalizaAPI(soapAction: string, xmlBody: string): Promise<Record<string, unknown>>;
export {};
