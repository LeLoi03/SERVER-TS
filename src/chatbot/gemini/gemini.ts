// src/chatbot/gemini/gemini.ts
import {
    GoogleGenerativeAI,
    GenerationConfig,
    GenerativeModel,
    Tool,
    Content,
    Part,
    GenerateContentResult,
    EnhancedGenerateContentResponse,
    FinishReason,
    FunctionCall,
    ModelParams
    // Role // You might need to import Role if you use it explicitly below
} from "@google/generative-ai";
import logToFile from '../../utils/logger'; // Adjust path if needed
import { HistoryItem } from '../shared/types'; // Adjust path if needed
import { GeminiInteractionResult } from '../shared/types'; // Adjust path if needed

const LOG_PREFIX = "[GeminiService]";

export class Gemini {
    private genAI: GoogleGenerativeAI;
    private modelName: string;

    constructor(apiKey: string, modelName: string) {
        if (!apiKey) {
            logToFile(`${LOG_PREFIX} Error: API Key is missing or empty.`);
            throw new Error("API Key is not set for GeminiService.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelName = modelName;
        logToFile(`${LOG_PREFIX} Initialized for model: ${modelName}`);
    }

    /**
     * Gets a configured GenerativeModel instance.
     * @param systemInstruction Optional system instruction (string, single Part, or array of strings/Parts).
     * @param tools Optional list of tools (FunctionDeclarations).
     * @returns Configured GenerativeModel.
     */
    private getModel(
        systemInstructionInput?: string | Part | (string | Part)[],
        tools?: Tool[]
    ): GenerativeModel {

        let systemInstructionForModel: string | Part | Content | undefined;

        if (typeof systemInstructionInput === 'string' || systemInstructionInput === undefined) {
            systemInstructionForModel = systemInstructionInput;
        } else if (!Array.isArray(systemInstructionInput) && typeof systemInstructionInput === 'object' && systemInstructionInput !== null) {
            // Optional: Add stricter check if this object is definitely a Part
            // e.g., if ('text' in systemInstructionInput || 'inlineData' in systemInstructionInput) { ... }
            systemInstructionForModel = systemInstructionInput;
        } else if (Array.isArray(systemInstructionInput)) {
            const parts: Part[] = [];
            for (const item of systemInstructionInput) {
                if (typeof item === 'string') {
                    parts.push({ text: item });
                } else if (typeof item === 'object' && item !== null) {
                    // Basic check if it looks like a Part object
                    if ('text' in item || 'inlineData' in item || 'functionCall' in item || 'functionResponse' in item) {
                        parts.push(item);
                    } else {
                        logToFile(`${LOG_PREFIX} getModel Warning: Invalid object found in systemInstruction array. Ignoring.`);
                    }
                }
            }
            if (parts.length > 0) {
                // --- *** SỬA ĐỔI Ở ĐÂY *** ---
                // Luôn thêm role: 'system' một cách tường minh
                systemInstructionForModel = { role: 'system', parts: parts };
                // --- *** KẾT THÚC SỬA ĐỔI *** ---
            } else {
                systemInstructionForModel = undefined;
            }
        } else {
            logToFile(`${LOG_PREFIX} getModel Warning: Unexpected type for systemInstructionInput. Ignoring.`);
            systemInstructionForModel = undefined;
        }

        const modelParams: ModelParams = {
            model: this.modelName,
        };
        if (systemInstructionForModel) {
            modelParams.systemInstruction = systemInstructionForModel;
        }
        if (tools && tools.length > 0) {
            modelParams.tools = tools;
        }

        return this.genAI.getGenerativeModel(modelParams);
    }


    /**
     * Maps internal HistoryItem[] to the SDK's Content[] format.
     * Ensures roles are valid ('user', 'model', 'function', 'tool').
     */
    private mapHistoryToContent(history: HistoryItem[]): Content[] {
        const validRoles = ['user', 'model', 'function', 'tool']; // 'tool' is alias for 'function' role response
        return history
            .map((item, index) => {
                // Basic validation/mapping for roles if needed
                // Assuming HistoryItem.role directly maps ('function' for function response)
                const role = item.role === 'function' ? 'function' : item.role; // Ensure 'function' role is used for responses
                if (!validRoles.includes(role)) {
                    logToFile(`${LOG_PREFIX} Warning: History item at index ${index} has invalid role '${item.role}'. Skipping.`);
                    return null; // Skip invalid items
                }
                // Ensure parts are valid Part objects
                if (!Array.isArray(item.parts) || item.parts.length === 0) {
                    logToFile(`${LOG_PREFIX} Warning: History item at index ${index} (Role: ${role}) has missing or empty 'parts'. Skipping.`);
                    return null;
                }
                // Add more validation on part structure if necessary
                return { role, parts: item.parts };
            })
            .filter((item): item is Content => item !== null); // Filter out null items
    }

    /**
     * Generates content for a single turn (non-streaming).
     *
     * @param nextTurnInput Content for the next turn (user text or function response parts).
     * @param history Previous conversation history.
     * @param generationConfig Configuration for generation.
     * @param systemInstruction Optional system instructions.
     * @param tools Optional tools (function declarations).
     * @returns A promise resolving to the interaction result.
     */
    async generateTurn(
        nextTurnInput: string | Part[],
        history: HistoryItem[],
        generationConfig: GenerationConfig,
        systemInstruction?: string | Part | (string | Part)[], // Accept complex type
        tools?: Tool[]
    ): Promise<GeminiInteractionResult> {

        const model = this.getModel(systemInstruction, tools);
        logToFile(`${LOG_PREFIX} generateTurn: Processing ${history.length} history items.`);

        // 1. Map history
        const effectiveHistory: Content[] = this.mapHistoryToContent(history);
        logToFile(`${LOG_PREFIX} generateTurn: Mapped to ${effectiveHistory.length} valid Content items.`);
        if (effectiveHistory.length > 0) {
            logToFile(`${LOG_PREFIX} generateTurn: Last history item role: ${effectiveHistory[effectiveHistory.length - 1].role}`);
        }

        // 2. Prepare content for the *next* turn
        let nextTurnContent: Content | null = null;
        if (typeof nextTurnInput === 'string') {
            const trimmedInput = nextTurnInput.trim();
            if (trimmedInput) {
                logToFile(`${LOG_PREFIX} generateTurn: Preparing next turn with user text.`);
                nextTurnContent = { role: 'user', parts: [{ text: trimmedInput }] };
            } else {
                logToFile(`${LOG_PREFIX} generateTurn: Received empty string as nextTurnInput, skipping.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            logToFile(`${LOG_PREFIX} generateTurn: Preparing next turn with function response parts.`);
            // Ensure the input parts are valid (basic check)
            if (nextTurnInput.every(p => typeof p === 'object' && p !== null)) {
                nextTurnContent = { role: 'function', parts: nextTurnInput }; // Use 'function' role for function responses
            } else {
                logToFile(`${LOG_PREFIX} generateTurn: Error: nextTurnInput (Part[]) contains invalid parts.`);
                return { status: "error", errorMessage: "Invalid function response parts provided." };
            }
        } else {
            logToFile(`${LOG_PREFIX} generateTurn: Received empty array or unexpected type as nextTurnInput, skipping.`);
        }

        // 3. Construct final 'contents' payload
        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
            contentsToSend.push(nextTurnContent);
        }

        // 4. Validate payload size
        if (contentsToSend.length === 0) {
            logToFile(`${LOG_PREFIX} generateTurn: Error: Cannot generate content with empty effective history and no valid next turn input.`);
            return { status: "error", errorMessage: "Cannot generate content: No history or valid input provided." };
        }

        logToFile(`${LOG_PREFIX} generateTurn: Sending ${contentsToSend.length} Content items to API.`);
        if (nextTurnContent) {
            logToFile(`${LOG_PREFIX}   - Final turn role: ${nextTurnContent.role}`);
        } else {
            logToFile(`${LOG_PREFIX}   - Sending only mapped history.`);
        }
        // Detailed log (optional, can be verbose)
        // logToFile(`${LOG_PREFIX} generateTurn: Contents Payload: ${JSON.stringify(contentsToSend)}`);


        // 5. Call API
        try {
            const result: GenerateContentResult = await model.generateContent({
                contents: contentsToSend,
                generationConfig: generationConfig,
                // safetySettings can be added here
            });

            const response = result.response;
            if (!response) {
                logToFile(`${LOG_PREFIX} generateTurn Error: API returned no response object.`);
                return { status: "error", errorMessage: "API returned no response." };
            }

            // Check for function call using response.functionCalls() helper
            const functionCalls = response.functionCalls(); // Returns FunctionCall[] or undefined
            if (functionCalls && functionCalls.length > 0) {
                logToFile(`${LOG_PREFIX} generateTurn: Model requested function call: ${functionCalls[0].name}`);
                logToFile(`${LOG_PREFIX}   Arguments: ${JSON.stringify(functionCalls[0].args)}`);
                return {
                    status: "requires_function_call",
                    functionCall: functionCalls[0] // Return the first one
                };
            }

            // Check for text response using response.text() helper
            const responseText = response.text();
            if (responseText) { // Handles null/undefined/empty string check
                logToFile(`${LOG_PREFIX} generateTurn: Model generated final text response. Length: ${responseText.length}`);
                return {
                    status: "final_text",
                    text: responseText
                };
            }

            // If no function call and no text, analyze finish reason
            const finishReason = response.candidates?.[0]?.finishReason;
            logToFile(`${LOG_PREFIX} generateTurn Warning: Model finished (Reason: ${finishReason}) but produced no text or function call.`);
            let errorMessage = `Model generation stopped unexpectedly. Reason: ${finishReason || 'Unknown'}`;
            switch (finishReason) {
                case FinishReason.SAFETY: errorMessage = "Model stopped due to safety concerns."; break;
                case FinishReason.RECITATION: errorMessage = "Model stopped due to recitation policy."; break;
                case FinishReason.MAX_TOKENS: errorMessage = "Model stopped because the maximum output token limit was reached."; break;
                // Add other specific reasons if needed
            }
            return { status: "error", errorMessage: errorMessage };

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${LOG_PREFIX} generateTurn Error: ${errorMsg}\nStack: ${error.stack}`);
            return { status: "error", errorMessage: `Failed to generate content: ${errorMsg}` };
        }
    }


    /**
     * Generates content as a stream. Handles potential function calls in the first chunk.
     *
     * @param nextTurnInput Content for the next turn (user text or function response parts).
     * @param history Previous conversation history.
     * @param generationConfig Configuration for generation.
     * @param systemInstruction Optional system instructions.
     * @param tools Optional tools (function declarations).
     * @returns A promise resolving to an object containing either the stream or an error/function call.
     */
    async generateStream(
        nextTurnInput: string | Part[],
        history: HistoryItem[],
        generationConfig: GenerationConfig,
        systemInstruction?: string | Part | (string | Part)[], // Accept complex type
        tools?: Tool[]
    ): Promise<{ stream?: AsyncGenerator<EnhancedGenerateContentResponse>; error?: string; functionCalls?: FunctionCall }> { // Corrected return type - single FC

        const model = this.getModel(systemInstruction, tools);
        logToFile(`${LOG_PREFIX} generateStream: Processing ${history.length} history items.`);

        // 1. Map history
        const effectiveHistory: Content[] = this.mapHistoryToContent(history);
        logToFile(`${LOG_PREFIX} generateStream: Mapped to ${effectiveHistory.length} valid Content items.`);

        // 2. Prepare content for the *next* turn (same logic as generateTurn)
        let nextTurnContent: Content | null = null;
        if (typeof nextTurnInput === 'string') {
            const trimmedInput = nextTurnInput.trim();
            if (trimmedInput) {
                logToFile(`${LOG_PREFIX} generateStream: Preparing next turn with user text.`);
                nextTurnContent = { role: 'user', parts: [{ text: trimmedInput }] };
            } else {
                logToFile(`${LOG_PREFIX} generateStream: Received empty string as nextTurnInput, skipping.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            logToFile(`${LOG_PREFIX} generateStream: Preparing next turn with function response parts.`);
            if (nextTurnInput.every(p => typeof p === 'object' && p !== null)) {
                nextTurnContent = { role: 'function', parts: nextTurnInput };
            } else {
                logToFile(`${LOG_PREFIX} generateStream: Error: nextTurnInput (Part[]) contains invalid parts.`);
                return { error: "Invalid function response parts provided." };
            }
        } else {
            logToFile(`${LOG_PREFIX} generateStream: Received empty array or unexpected type as nextTurnInput, skipping.`);
        }

        // 3. Construct final 'contents' payload
        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
            contentsToSend.push(nextTurnContent);
        }

        // 4. Validate payload size
        if (contentsToSend.length === 0) {
            logToFile(`${LOG_PREFIX} generateStream: Error: Cannot generate content stream with empty effective history and no valid next turn input.`);
            return { error: "Cannot generate content stream: No history or valid input provided." };
        }

        logToFile(`${LOG_PREFIX} generateStream: Sending ${contentsToSend.length} Content items to API.`);
        if (nextTurnContent) {
            logToFile(`${LOG_PREFIX}   - Final turn role: ${nextTurnContent.role}`);
        } else {
            logToFile(`${LOG_PREFIX}   - Sending only mapped history.`);
        }
        // logToFile(`${LOG_PREFIX} generateStream: Contents Payload: ${JSON.stringify(contentsToSend)}`);


        // 5. Call API and Handle Stream/Function Call
        try {
            const streamResult = await model.generateContentStream({
                contents: contentsToSend,
                generationConfig: generationConfig,
                // safetySettings can be added here
            });

            // --- Peek at the first chunk for function calls ---
            const iterator = streamResult.stream[Symbol.asyncIterator]();
            const firstChunkResult = await iterator.next();

            if (firstChunkResult.done) {
                // Stream ended immediately (error/safety/empty)
                logToFile(`${LOG_PREFIX} generateStream: Stream ended prematurely on first chunk.`);
                try {
                    const aggregatedResponse = await streamResult.response; // Attempt to get aggregated info
                    const finishReason = aggregatedResponse?.candidates?.[0]?.finishReason;
                    const safetyRatings = aggregatedResponse?.promptFeedback?.safetyRatings;
                    logToFile(`${LOG_PREFIX} generateStream: Aggregated response finish reason: ${finishReason}`);
                    if (safetyRatings) logToFile(`${LOG_PREFIX} generateStream: Safety Ratings: ${JSON.stringify(safetyRatings)}`);

                    let errorMessage = `Stream ended unexpectedly. Reason: ${finishReason || 'Unknown'}`;
                    if (finishReason === FinishReason.SAFETY || aggregatedResponse?.promptFeedback?.blockReason) {
                        errorMessage = `Content generation blocked. Reason: ${aggregatedResponse?.promptFeedback?.blockReason || 'Safety concern'}.`;
                    } else if (finishReason === FinishReason.MAX_TOKENS) {
                        errorMessage = "Model stopped because the maximum output token limit was reached.";
                    }
                    // Add other reasons if necessary
                    return { error: errorMessage };
                } catch (aggError: any) {
                    logToFile(`${LOG_PREFIX} generateStream: Error getting aggregated response after immediate stream end: ${aggError.message}`);
                    return { error: "Stream ended unexpectedly without providing data." };
                }
            }

            // We have the first chunk, check for function calls
            const firstChunk = firstChunkResult.value; // This is EnhancedGenerateContentResponse
            const functionCalls = firstChunk.functionCalls(); // Helper checks parts for functionCall

            if (functionCalls && functionCalls.length > 0) {
                logToFile(`${LOG_PREFIX} generateStream: Function call detected in first chunk: ${functionCalls[0].name}`);
                // Return the function call, *not* the stream
                return { functionCalls: functionCalls[0] }; // Corrected: return the single FC object
            }

            // --- No function call found, return the stream ---
            logToFile(`${LOG_PREFIX} generateStream: No function call in first chunk. Returning stream generator.`);

            // Create a new generator that includes the already-retrieved first chunk
            async function* combinedStream(): AsyncGenerator<EnhancedGenerateContentResponse> {
                yield firstChunk; // Yield the first chunk we already have
                // Continue iterating from where we left off
                for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
                    // Basic check within loop (optional but good practice)
                    if (!chunk) {
                        logToFile(`${LOG_PREFIX} generateStream Warning: Received null/undefined chunk during iteration.`);
                        continue;
                    }
                    yield chunk;
                }
            }

            return { stream: combinedStream() }; // Return the new generator

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${LOG_PREFIX} generateStream Error: Failed to initiate or process stream: ${errorMsg}\nStack: ${error.stack}`);
            return { error: `Failed to generate content stream: ${errorMsg}` };
        }
    }
}