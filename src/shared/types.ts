// shared/types.ts
export interface DatabaseConfig {
    user?: string;
    host?: string;
    database?: string;
    password?: string;
    port?: number;
}

export interface TextMessageResponse {
    type: 'text';
    message: string;
    thought?: string; // Add thought
}

export interface ChartMessageResponse {
    type: 'chart';
    echartsConfig: any;
    sqlQuery: string;
    sqlResult: any[]; //IMPORTANT:  This should be here
    description: string;
    thought?: string; // Add thought
    message?: string;
}

export interface InternalNavigationResponse {
    type: 'navigation';
    navigationType: 'internal';
    path: string;
    message: string;
    thought?: string; // Add thought

}

export interface ExternalNavigationResponse {
    type: 'navigation';
    navigationType: 'external';
    url: string;
    message: string;
    thought?: string; // Add thought


}

export interface ErrorResponse {
    type: 'error'; // Add type
    message: string;
    thought?: string;
}
// Union of response
export type ChatResponse =
    | TextMessageResponse
    | ChartMessageResponse
    | InternalNavigationResponse
    | ExternalNavigationResponse
    | ErrorResponse;


export type HistoryItem =
{ role: "user" | "model"; parts: [{ text: string }]; type?: 'text' | 'chart' | 'error' | 'navigation' }

export type ChatHistoryType = HistoryItem[];

// ChatRequest is also shared
export interface ChatRequest {
    userInput?: string;
    history?: ChatHistoryType;
}