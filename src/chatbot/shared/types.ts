// src/shared/types.ts
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

export interface ChatUpdate {
    type: 'partial_result';
    textChunk: string;

}
// --- Define Action Types ---
export interface NavigationAction {
    type: 'navigate';
    url: string; // The URL (internal path or full external URL)
}

// <<< NEW: Define OpenMapAction >>>
export interface OpenMapAction {
    type: 'openMap';
    location: string; // The location string to search on Google Maps
}

// --- Update ChatAction Union Type ---
export type ChatAction = NavigationAction | OpenMapAction; // <<< ADDED OpenMapAction

// --- ResultUpdate (No change needed here, already has optional 'action') ---
export interface ResultUpdate {
    type: 'result';
    message: string; // The text message to display
    thoughts?: ThoughtStep[];
    action?: ChatAction; // Now includes NavigationAction or OpenMapAction
}


export interface ErrorUpdate {
    type: 'error';
    message: string;
    step?: string; // The step where the error might have occurred
    thought?: string; // Optional: keep if used elsewhere, or remove
    thoughts?: ThoughtStep[]; // Add the thought process history leading to the error
}



export type PrebuiltVoice = "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede" | "Orus" | "Zephyr";
export type OutputModality = "text" | "audio" | "image";
export type Language = 'en' | 'vi' | 'zh';
export type ChatMode = 'live' | 'regular';
export interface LanguageOption {
    code: Language;
    name: string;
    flagCode: string;
}


export const AVAILABLE_LANGUAGES: LanguageOption[] = [
    { code: 'en', name: 'English', flagCode: 'gb' },
    { code: 'vi', name: 'Tiếng Việt', flagCode: 'vn' },
    { code: 'zh', name: '中文', flagCode: 'cn' },
    // Add other languages
];

export const DEFAULT_LANGUAGE: Language = 'vi';
export const DEFAULT_VOICE: PrebuiltVoice = 'Puck';
export const DEFAULT_MODALITY: OutputModality = 'audio';



// src/chabot/gemini/types.ts
import { Socket } from 'socket.io';

/**
 * Input context provided to each function handler.
 */
export interface FunctionHandlerInput {
    args: any; // Arguments provided by the LLM for the function call
    userToken: string | null; // Authentication token for the user
    language: Language; // Current language context
    handlerId: string; // Unique ID for the main request handler invocation
    socketId: string; // Socket ID for logging/tracking
    socket: Socket; // The Socket object for emitting status updates *during* execution
}

/**
 * Standardized output structure for all function handlers.
 */
export interface FunctionHandlerOutput {
    modelResponseContent: string; // Content to be sent back to the LLM in the function response
    frontendAction?: ChatAction; // Optional action to be executed by the frontend
}


// --- Define the return type ---
// --- Define the return type ---
export interface ApiCallResult {
    success: boolean;
    rawData: string; // Raw JSON string or error message string
    formattedData: string | null; // Formatted Markdown or null if transformation failed/not applicable
    errorMessage?: string; // Specific error message if success is false
}


export interface FollowItem {
    id: string; // Can be conferenceId or journalId depending on context
    // Add other fields if your API returns them (like title, acronym)
}