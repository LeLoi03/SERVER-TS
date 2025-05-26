// src/chatbot/gemini/gemini.ts

import {
    GoogleGenAI,
    GenerateContentConfig,
    Tool,
    Content,
    Part,
    GenerateContentResponse,
    FinishReason,
    FunctionCall,
    // Import necessary helper functions from the new SDK
    // These are based on the provided library code listing
    createUserContent,
    // createModelContent, // Not directly used here, but good to know it exists
    createPartFromFunctionResponse, // If nextTurnInput (Part[]) is a direct function response
    // createPartFromText, // createUserContent handles string input
} from '@google/genai'; // Assuming '@google/genai' is the package name

import logToFile from '../../utils/logger';
import { ChatHistoryItem, GeminiInteractionResult } from '../shared/types'; // Keep existing types
import { getErrorMessageAndStack } from '../../utils/errorUtils';

// Helper to construct Content for a function response.
// The new SDK's createPartFromFunctionResponse creates a Part.
// We need to wrap this Part in a Content object with role 'function'.
function createFunctionResponseContent(functionResponseParts: Part[]): Content {
    // In the old SDK, nextTurnInput could be Part[] directly representing a function response.
    // In the new SDK, a function response to the model is typically a Content object
    // with role: 'tool' (or 'function' in some contexts, but 'tool' is common for providing execution results)
    // and parts containing FunctionResponse objects.
    // However, the user's existing `nextTurnInput: Part[]` for function responses
    // likely means these parts are already structured as `FunctionResponsePart`.
    // The prompt asks to preserve logic. The old code used `role: 'function'`.
    // The new SDK's `createPartFromFunctionResponse` is for creating a *single Part*
    // from a function's output. If `nextTurnInput` is an array of such parts,
    // we'll use role: 'function' as before.
    return { role: 'function', parts: functionResponseParts };
}


/**
 * A service class for interacting with the Google Gemini API using the new SDK.
 * Handles both one-shot content generation and streaming responses,
 * including integration with function calling.
 */
export class Gemini {
    private ai: GoogleGenAI;
    private modelId: string; // Changed from modelName to modelId for clarity with new SDK params

    /**
     * Constructs a new Gemini service instance.
     * @param {string} apiKey - Your Google Gemini API key.
     * @param {string} modelId - The ID of the Gemini model to use (e.g., 'gemini-1.5-pro-latest').
     * @throws {Error} If the API Key is not provided.
     */
    constructor(apiKey: string, modelId: string) {
        if (!apiKey) {
            logToFile(`[GeminiService] Error: API Key is not set during initialization.`);
            throw new Error("API Key is not set.");
        }
        this.ai = new GoogleGenAI({ apiKey });
        this.modelId = modelId;
        logToFile(`[GeminiService] Initialized for model: ${this.modelId} using new SDK.`);
    }

    /**
     * Generates a single content turn (non-streaming) from the Gemini model.
     *
     * @param {string | Part[]} nextTurnInput - The content for the current turn.
     * @param {ChatHistoryItem[]} history - The conversation history.
     * @param {GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }} generationAndSystemConfig - Configuration.
     * @returns {Promise<GeminiInteractionResult>} Result of the interaction.
     */
    async generateTurn(
        nextTurnInput: string | Part[],
        history: ChatHistoryItem[],
        generationAndSystemConfig: GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }
    ): Promise<GeminiInteractionResult> {

        logToFile(`[GeminiService:generateTurn] Received history with ${history.length} items before mapping.`);

        const effectiveHistory: Content[] = history.map(item => ({
            role: item.role,
            parts: item.parts
        }));

        logToFile(`[GeminiService:generateTurn] Mapped to effectiveHistory (SDK Content[]) with ${effectiveHistory.length} items.`);
        if (effectiveHistory.length > 0) {
            logToFile(`[GeminiService:generateTurn] Last item role in effectiveHistory: ${effectiveHistory[effectiveHistory.length - 1].role}`);
        }

        logToFile(`[GeminiService:generateTurn] Calling generateContent for model: ${this.modelId}`);

        const apiConfig: GenerateContentConfig = { ...generationAndSystemConfig };

        if (typeof generationAndSystemConfig.systemInstruction === 'string') {
            apiConfig.systemInstruction = { parts: [{ text: generationAndSystemConfig.systemInstruction }] };
            // The role for systemInstruction is often implicit or handled by the SDK when passing a Content object.
            // If a specific role like "system" is strictly needed and not added by the SDK, it would be:
            // apiConfig.systemInstruction = { role: "system", parts: [{ text: generationAndSystemConfig.systemInstruction }] };
            logToFile(`[GeminiService:generateTurn] System Instruction (string converted to Content): "${generationAndSystemConfig.systemInstruction.substring(0, 200)}..."`);
        } else if (generationAndSystemConfig.systemInstruction) {
            apiConfig.systemInstruction = generationAndSystemConfig.systemInstruction;
             const siText = (generationAndSystemConfig.systemInstruction as Content).parts?.[0]?.text || "[System Instruction Content has no text]";
            logToFile(`[GeminiService:generateTurn] System Instruction (Content object): "${siText.substring(0,200)}..."`);
        }


        logToFile(`[GeminiService:generateTurn] Effective Generation Config: ${JSON.stringify(apiConfig)}`);

        if (apiConfig.tools && apiConfig.tools.length > 0) {
            const toolNames = apiConfig.tools.map(t => {
                if (t.functionDeclarations) {
                    return t.functionDeclarations.map(fd => fd.name);
                } else if (t.codeExecution) {
                    return '[CodeExecutionTool]';
                } else if (t.googleSearchRetrieval) {
                     return '[GoogleSearchRetrievalTool]';
                } else if (t.googleSearch) {
                    return '[GoogleSearchTool]';
                }
                return '[UnknownToolType]';
            }).flat();
            logToFile(`[GeminiService:generateTurn] Tools provided: ${JSON.stringify(toolNames)}`);
        } else {
            logToFile(`[GeminiService:generateTurn] No tools provided.`);
        }

        let nextTurnContent: Content | null = null;
        if (typeof nextTurnInput === 'string') {
            if (nextTurnInput.trim()) {
                logToFile(`[GeminiService:generateTurn] Preparing next turn with user prompt.`);
                nextTurnContent = createUserContent(nextTurnInput); // Using SDK helper
            } else {
                logToFile(`[GeminiService:generateTurn] Received empty string as nextTurnInput, skipping adding a user turn.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            logToFile(`[GeminiService:generateTurn] Preparing next turn with Function Response Parts.`);
            nextTurnContent = createFunctionResponseContent(nextTurnInput);
        } else {
            logToFile(`[GeminiService:generateTurn] Received empty array or unexpected type as nextTurnInput, skipping adding this turn.`);
        }

        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
            contentsToSend.push(nextTurnContent);
        } else if (effectiveHistory.length === 0) {
            logToFile(`[GeminiService:generateTurn] Error: Cannot generate content with empty history and no valid input for the next turn.`);
            return { status: "error", errorMessage: "Cannot generate content: No history or valid input provided." };
        }

        logToFile(`[GeminiService:generateTurn] Sending total ${contentsToSend.length} Content items to API.`);
        if (nextTurnContent) {
            logToFile(`  - Added next turn role: ${nextTurnContent.role}`);
        } else {
            logToFile(`  - No valid next turn added, sending only history.`);
        }

        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({
                model: this.modelId,
                contents: contentsToSend,
                config: apiConfig,
            });

            const finishReason = response.candidates?.[0]?.finishReason;
            const functionCalls = response.functionCalls;

            logToFile(`[GeminiService:generateTurn] Model Finish Reason: ${finishReason}`);

            if (functionCalls && functionCalls.length > 0) {
                const fc = functionCalls[0];
                logToFile(`[GeminiService:generateTurn] Model requested function call: ${fc.name}`);
                logToFile(`[GeminiService:generateTurn] Arguments: ${JSON.stringify(fc.args)}`);
                return {
                    status: "requires_function_call",
                    functionCall: fc
                };
            }

            const responseText = response.text;
            if (responseText !== undefined) {
                logToFile(`[GeminiService:generateTurn] Model generated final text response: ${responseText.substring(0, 100)}...`);
                return {
                    status: "final_text",
                    text: responseText
                };
            }

            logToFile(`[GeminiService:generateTurn] Warning: Model finished (Reason: ${finishReason}) but produced no text and no function call.`);
            let errorMessage = `Model generation stopped unexpectedly. Reason: ${finishReason || 'Unknown'}`;
            switch (finishReason) {
                case FinishReason.SAFETY:
                    errorMessage = "Model stopped due to safety concerns.";
                    if (response.promptFeedback?.blockReason) {
                        errorMessage += ` Prompt feedback: ${response.promptFeedback.blockReason}`;
                         if(response.promptFeedback.blockReasonMessage) errorMessage += ` - ${response.promptFeedback.blockReasonMessage}`;
                    } else if (response.candidates?.[0]?.safetyRatings?.some(r => r.blocked)) {
                        errorMessage += ` Candidate blocked due to safety ratings.`;
                    }
                    break;
                case FinishReason.RECITATION:
                    errorMessage = "Model stopped due to recitation policy.";
                    break;
                case FinishReason.MAX_TOKENS:
                    errorMessage = "Model stopped because the maximum output token limit was reached.";
                    break;
                case FinishReason.OTHER:
                default:
                    errorMessage = `Model stopped for unspecified or other reason: ${finishReason || 'Unknown'}`;
                    break;
            }
            return { status: "error", errorMessage: errorMessage };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`[GeminiService:generateTurn] Error during content generation: ${errorMessage}, Stack: ${errorStack}`);
            return { status: "error", errorMessage: errorMessage || "Failed to generate content." };
        }
    }

    /**
     * Generates content from the Gemini model as a stream.
     *
     * @param {string | Part[]} nextTurnInput - The content for the current turn.
     * @param {ChatHistoryItem[]} history - The conversation history.
     * @param {GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }} generationAndSystemConfig - Configuration.
     * @returns {Promise<{ stream?: AsyncGenerator<GenerateContentResponse>; error?: string; functionCall?: FunctionCall }>}
     *          A Promise that resolves with either an `AsyncGenerator` for streaming text, an `error` message,
     *          or a `FunctionCall` if the model immediately requests one.
     *          Note: The new SDK's `functionCalls` getter on the response might simplify detection.
     *          If multiple function calls are possible in the first chunk, this returns the first one.
     */
    async generateStream(
        nextTurnInput: string | Part[],
        history: ChatHistoryItem[],
        generationAndSystemConfig: GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }
    ): Promise<{ stream?: AsyncGenerator<GenerateContentResponse>; error?: string; functionCall?: FunctionCall }> {

        logToFile(`[GeminiService:generateStream] Received history with ${history.length} items before mapping.`);
        const effectiveHistory: Content[] = history.map(item => ({
            role: item.role,
            parts: item.parts
        }));

        logToFile(`[GeminiService:generateStream] Mapped history (SDK Content[]) with ${effectiveHistory.length} items.`);
        if (effectiveHistory.length > 0) {
            logToFile(`[GeminiService:generateStream] Last item role in effectiveHistory: ${effectiveHistory[effectiveHistory.length - 1].role}`);
        }

        logToFile(`[GeminiService:generateStream] Calling generateContentStream for model: ${this.modelId}`);

        const apiConfig: GenerateContentConfig = { ...generationAndSystemConfig };
        if (typeof generationAndSystemConfig.systemInstruction === 'string') {
            apiConfig.systemInstruction = { parts: [{ text: generationAndSystemConfig.systemInstruction }] };
            logToFile(`[GeminiService:generateStream] System Instruction (string converted to Content): "${generationAndSystemConfig.systemInstruction.substring(0, 200)}..."`);
        } else if (generationAndSystemConfig.systemInstruction) {
            apiConfig.systemInstruction = generationAndSystemConfig.systemInstruction;
            const siText = (generationAndSystemConfig.systemInstruction as Content).parts?.[0]?.text || "[System Instruction Content has no text]";
            logToFile(`[GeminiService:generateStream] System Instruction (Content object): "${siText.substring(0,200)}..."`);
        }

        logToFile(`[GeminiService:generateStream] Effective Generation Config: ${JSON.stringify(apiConfig)}`);
        if (apiConfig.tools && apiConfig.tools.length > 0) {
            const toolNames = apiConfig.tools.map(t => {
                 if (t.functionDeclarations) { return t.functionDeclarations.map(fd => fd.name); }
                 else if (t.codeExecution) { return '[CodeExecutionTool]'; }
                 else if (t.googleSearchRetrieval) { return '[GoogleSearchRetrievalTool]'; }
                 else if (t.googleSearch) { return '[GoogleSearchTool]'; }
                 return '[UnknownToolType]';
            }).flat();
            logToFile(`[GeminiService:generateStream] Tools provided: ${JSON.stringify(toolNames)}`);
        } else {
            logToFile(`[GeminiService:generateStream] No tools provided.`);
        }

        let nextTurnContent: Content | null = null;
        if (typeof nextTurnInput === 'string') {
            if (nextTurnInput.trim()) {
                logToFile(`[GeminiService:generateStream] Preparing next turn with user prompt.`);
                nextTurnContent = createUserContent(nextTurnInput); // Using SDK helper
            } else {
                logToFile(`[GeminiService:generateStream] Received empty string as nextTurnInput, skipping adding a user turn.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            logToFile(`[GeminiService:generateStream] Preparing next turn with Function Response Parts.`);
            nextTurnContent = createFunctionResponseContent(nextTurnInput);
        } else {
            logToFile(`[GeminiService:generateStream] Received empty array or unexpected type as nextTurnInput, skipping adding this turn.`);
        }

        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
            contentsToSend.push(nextTurnContent);
        } else if (effectiveHistory.length === 0) {
            logToFile(`[GeminiService:generateStream] Error: Cannot generate content with empty history and no valid input.`);
            return { error: "Cannot generate content: No history or valid input provided." };
        }

        logToFile(`[GeminiService:generateStream] Preparing stream request with ${contentsToSend.length} Content items.`);
        if (nextTurnContent) {
            logToFile(`  - Added next turn role: ${nextTurnContent.role}`);
        } else {
            logToFile(`  - No valid next turn added, sending only history.`);
        }

        try {
            // generateContentStream now returns a Promise that resolves to the AsyncGenerator
            const streamGenerator = await this.ai.models.generateContentStream({
                model: this.modelId,
                contents: contentsToSend,
                config: apiConfig,
            });

            // Consume the first chunk to check for immediate function call
            const iterator = streamGenerator[Symbol.asyncIterator]();
            const firstChunkResult = await iterator.next();

            if (firstChunkResult.done) {
                logToFile(`[GeminiService:generateStream] Stream finished on first chunk or was empty.`);
                // Try to get the full response to understand why it finished early (e.g. safety)
                // The new SDK's generateContentStream might not have a separate '.response' promise
                // like the old one. The final aggregated response details (like finishReason)
                // might be part of the last chunk or implicitly handled when the stream ends.
                // If the stream is truly empty and `done` is true, it implies an issue like a safety block
                // or an immediate non-streaming response that wasn't text/function.
                // We need to check the `GenerateContentResponse` properties of the (empty) stream or handle this case.
                // For now, assume an error if the stream is done on the first pull without yielding value.
                // The `chats.ts` example doesn't explicitly show handling `streamResult.response` for the full response.
                // It processes chunks and the last chunk contains the final aggregated data.
                // If firstChunkResult.value is undefined and done is true, it's an issue.
                // If firstChunkResult.value is present even if done is true (last chunk), process it.

                const finalResponseAfterEmptyStream = firstChunkResult.value; // This would be the full response if stream had one chunk
                if (finalResponseAfterEmptyStream) {
                    const finishReason = finalResponseAfterEmptyStream.candidates?.[0]?.finishReason;
                    logToFile(`[GeminiService:generateStream] Stream was a single chunk. Finish Reason: ${finishReason}`);
                     const functionCalls = finalResponseAfterEmptyStream.functionCalls;
                    if (functionCalls && functionCalls.length > 0) {
                        logToFile(`[GeminiService:generateStream] Function call in single chunk response: ${functionCalls[0].name}.`);
                        return { functionCall: functionCalls[0] };
                    }
                    const text = finalResponseAfterEmptyStream.text;
                    if (text !== undefined) {
                        logToFile(`[GeminiService:generateStream] Text in single chunk response. Returning as stream.`);
                         async function* singleChunkStream(): AsyncGenerator<GenerateContentResponse> {
                            yield finalResponseAfterEmptyStream;
                        }
                        return { stream: singleChunkStream() };
                    }
                     let errorMessage = `Stream ended. Reason: ${finishReason || 'Unknown'}`;
                     if (finishReason === FinishReason.SAFETY) { errorMessage = "Content blocked due to safety concerns."; }
                     return { error: errorMessage };
                }

                logToFile(`[GeminiService:generateStream] Stream ended unexpectedly without yielding any data.`);
                return { error: "Stream ended unexpectedly without providing data." };
            }

            const firstChunk = firstChunkResult.value; // This is a GenerateContentResponse
            const functionCallsInFirstChunk = firstChunk.functionCalls;

            if (functionCallsInFirstChunk && functionCallsInFirstChunk.length > 0) {
                logToFile(`[GeminiService:generateStream] Received function call in first chunk: ${functionCallsInFirstChunk[0].name}. Returning function call.`);
                return { functionCall: functionCallsInFirstChunk[0] };
            }

            logToFile(`[GeminiService:generateStream] No function call in first chunk. Returning stream generator.`);
            async function* combinedStream(): AsyncGenerator<GenerateContentResponse> {
                yield firstChunk;
                // yield* streamGenerator; // This would re-iterate from the beginning if streamGenerator is directly iterable
                // We need to continue from the existing iterator
                for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
                    yield chunk;
                }
            }
            return { stream: combinedStream() };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`[GeminiService:generateStream] Error initiating stream: ${errorMessage}, Stack: ${errorStack}`);
            return { error: errorMessage || "Failed to initiate content stream." };
        }
    }
}