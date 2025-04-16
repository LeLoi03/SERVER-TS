// // shared/types.ts
// export interface DatabaseConfig {
//     user?: string;
//     host?: string;
//     database?: string;
//     password?: string;
//     port?: number;
// }

// export interface TextMessageResponse {
//     type: 'text';
//     message: string;
//     thought?: string; // Add thought
// }

// export interface ChartMessageResponse {
//     type: 'chart';
//     echartsConfig: any;
//     sqlQuery: string;
//     sqlResult: any[]; //IMPORTANT:  This should be here
//     description: string;
//     thought?: string; // Add thought
//     message?: string;
// }

// export interface InternalNavigationResponse {
//     type: 'navigation';
//     navigationType: 'internal';
//     path: string;
//     message: string;
//     thought?: string; // Add thought

// }

// export interface ExternalNavigationResponse {
//     type: 'navigation';
//     navigationType: 'external';
//     url: string;
//     message: string;
//     thought?: string; // Add thought


// }

// export interface ErrorResponse {
//     type: 'error'; // Add type
//     message: string;
//     thought?: string;
// }
// // Union of response
// export type ChatResponse =
//     | TextMessageResponse
//     | ChartMessageResponse
//     | InternalNavigationResponse
//     | ExternalNavigationResponse
//     | ErrorResponse;


// export type HistoryItem =
// { role: "user" | "model"; parts: [{ text: string }]; type?: 'text' | 'chart' | 'error' | 'navigation' }

// export type ChatHistoryType = HistoryItem[];

// // ChatRequest is also shared
// export interface ChatRequest {
//     userInput?: string;
//     history?: ChatHistoryType;
// }



// src/shared/types.ts (Example)
import { FunctionCall, Part } from "@google/generative-ai"; // Import necessary types

// Ensure HistoryItem part can hold various types
export interface HistoryItem {
    role: "user" | "model" | "function"; // Add 'function' role
    parts: Part[]; // Use the SDK's Part type directly
    // Removed 'type' field if it was specific to your old structure
}

// ChatResponse might just return the final outcome
export interface ChatResponse {
    type: "text" | "error";
    message: string;
    thought?: string; // Optional field for internal reasoning/steps
}

// You might want an intermediate response type if handleUserInput needs more info
export interface GeminiInteractionResult {
    status: "requires_function_call" | "final_text" | "error";
    functionCall?: FunctionCall; // Present if status is 'requires_function_call'
    text?: string; // Present if status is 'final_text'
    errorMessage?: string; // Present if status is 'error'
}

// Define the structure for a single step in the thought process
export interface ThoughtStep {
    step: string;       // The identifier (e.g., 'thinking', 'function_call')
    message: string;    // The descriptive message for that step
    timestamp: string;  // ISO timestamp when the step occurred
    details?: any;      // Optional: Any extra data (like function args)
}

export interface StatusUpdate {
    type: 'status';
    step: string;
    message: string;
    details?: any; // Optional details relevant to the step (e.g., function name/args)
    thoughts?: ThoughtStep[]; // Add the thought process history

}

export interface ResultUpdate {
    type: 'result';
    message: string;
    thoughts?: ThoughtStep[]; // Add the thought process history
}

export interface ErrorUpdate {
    type: 'error';
    message: string;
    step?: string; // The step where the error might have occurred
    thought?: string; // Optional: keep if used elsewhere, or remove
    thoughts?: ThoughtStep[]; // Add the thought process history leading to the error
}