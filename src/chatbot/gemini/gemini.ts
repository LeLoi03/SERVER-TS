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
    FunctionCall
} from "@google/generative-ai";
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { ChatHistoryItem } from '../shared/types';
import { GeminiInteractionResult } from '../shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * A service class for interacting with the Google Gemini API.
 * Handles both one-shot content generation and streaming responses,
 * including integration with function calling.
 */
export class Gemini {
    private genAI: GoogleGenerativeAI;
    private modelName: string;

    /**
     * Constructs a new Gemini service instance.
     * @param {string} apiKey - Your Google Gemini API key.
     * @param {string} modelName - The name of the Gemini model to use (e.g., 'gemini-pro', 'gemini-1.5-pro-latest').
     * @throws {Error} If the API Key is not provided.
     */
    constructor(apiKey: string, modelName: string) {
        if (!apiKey) {
            logToFile(`[GeminiService] Error: API Key is not set during initialization.`);
            throw new Error("API Key is not set.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelName = modelName;
        logToFile(`[GeminiService] Initialized for model: ${modelName}`);
    }

    /**
     * Retrieves a GenerativeModel instance with optional system instructions and tools.
     * @param {string} [systemInstruction] - An optional system instruction for the model.
     * @param {Tool[]} [tools] - An optional array of tools (function declarations) for the model to use.
     * @returns {GenerativeModel} An instance of the GenerativeModel.
     */
    private getModel(systemInstruction?: string, tools?: Tool[]): GenerativeModel {
        // Construct system instruction part only if provided
        // SDK now recommends 'system' role for system instructions
        const systemInstructionPart = systemInstruction
            ? { role: "system", parts: [{ text: systemInstruction }] }
            : undefined;

        const modelOptions: any = {
            model: this.modelName,
        };

        if (systemInstructionPart) {
            modelOptions.systemInstruction = systemInstructionPart;
            // THÊM DÒNG LOG NÀY ĐỂ KIỂM TRA
            logToFile(`[GeminiService:getModel] Actual System Instruction being set for model: "${systemInstructionPart.parts[0].text.substring(0, 200)}..."`);
        }
        // Conditionally add tools
        if (tools && tools.length > 0) {
            modelOptions.tools = tools;
        }

        return this.genAI.getGenerativeModel(modelOptions);
    }

    /**
     * Generates a single content turn (non-streaming) from the Gemini model.
     * This method handles history, a new input turn (user text or function response),
     * and processes the model's response for text or function calls.
     *
     * @param {string | Part[]} nextTurnInput - The content for the current turn.
     *                                          Can be a string (user prompt) or an array of `Part` (function response).
     * @param {ChatHistoryItem[]} history - The conversation history as an array of `ChatHistoryItem`.
     * @param {GenerationConfig} generationConfig - Configuration for the generation process (e.g., temperature, max output tokens).
     * @param {string} [systemInstruction] - Optional system instruction for the model.
     * @param {Tool[]} [tools] - Optional array of tools (function declarations) for the model to use.
     * @returns {Promise<GeminiInteractionResult>} A Promise that resolves with the result of the interaction,
     *                                             indicating a final text response, a required function call, or an error.
     */
    async generateTurn(
        nextTurnInput: string | Part[],
        history: ChatHistoryItem[],
        generationConfig: GenerationConfig,
        systemInstruction?: string,
        tools?: Tool[]
    ): Promise<GeminiInteractionResult> {

        const model = this.getModel(systemInstruction, tools);

        logToFile(`[GeminiService:generateTurn] Received history with ${history.length} items before mapping.`);

        // Map history to the SDK's `Content` format
        const effectiveHistory: Content[] = history.map(item => ({
            role: item.role,
            parts: item.parts // Assuming item.parts is already compatible with SDK Part[]
        }));

        logToFile(`[GeminiService:generateTurn] Mapped to effectiveHistory (SDK Content[]) with ${effectiveHistory.length} items.`);
        if (effectiveHistory.length > 0) {
            logToFile(`[GeminiService:generateTurn] Last item role in effectiveHistory: ${effectiveHistory[effectiveHistory.length - 1].role}`);
        }

        logToFile(`[GeminiService:generateTurn] Calling generateContent for model: ${this.modelName}`);
        logToFile(`[GeminiService:generateTurn] Generation Config: ${JSON.stringify(generationConfig)}`);
        // Log tools if provided
        if (tools && tools.length > 0) {
            const toolNames = tools.map(t => {
                if ('functionDeclarations' in t && t.functionDeclarations) {
                    return t.functionDeclarations.map(fd => fd.name);
                } else if ('codeExecution' in t) {
                    return '[CodeExecutionTool]';
                } else if ('googleSearchRetrieval' in t) { return '[GoogleSearchRetrievalTool]'; }
                return '[UnknownToolType]';
            }).flat();
            logToFile(`[GeminiService:generateTurn] Tools provided: ${JSON.stringify(toolNames)}`);
        } else {
            logToFile(`[GeminiService:generateTurn] No tools provided.`);
        }

        // Prepare the content for the *next* turn based on nextTurnInput
        let nextTurnContent: Content | null = null;

        if (typeof nextTurnInput === 'string') {
            // It's a user text prompt
            if (nextTurnInput.trim()) { // Check if string is not empty/whitespace
                logToFile(`[GeminiService:generateTurn] Preparing next turn with user prompt.`);
                nextTurnContent = { role: 'user', parts: [{ text: nextTurnInput }] };
            } else {
                logToFile(`[GeminiService:generateTurn] Received empty string as nextTurnInput, skipping adding a user turn.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            // It's parts, likely a function response. Check if the array is not empty.
            logToFile(`[GeminiService:generateTurn] Preparing next turn with Function Response Parts.`);
            // Assume function responses should have the 'function' role for the API
            nextTurnContent = { role: 'function', parts: nextTurnInput };
        } else {
            // Input is an empty array or some other unexpected type. Log and skip adding this turn.
            logToFile(`[GeminiService:generateTurn] Received empty array or unexpected type as nextTurnInput, skipping adding this turn.`);
        }

        // Construct the final 'contents' array for the API call
        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
            // Only add the next turn if it was validly created
            contentsToSend.push(nextTurnContent);
        } else if (effectiveHistory.length === 0) {
            // Edge case: If history is empty AND nextTurnInput was also empty/invalid,
            // we cannot send an empty contents array to the API.
            logToFile(`[GeminiService:generateTurn] Error: Cannot generate content with empty history and no valid input for the next turn.`);
            return { status: "error", errorMessage: "Cannot generate content: No history or valid input provided." };
        }

        logToFile(`[GeminiService:generateTurn] Sending total ${contentsToSend.length} Content items to API.`);
        if (nextTurnContent) {
            logToFile(`  - Added next turn role: ${nextTurnContent.role}`);
        } else {
            logToFile(`  - No valid next turn added, sending only history.`);
        }
        // Optional detailed log:
        // logToFile(`[GeminiService:generateTurn] Full 'contents' payload: ${JSON.stringify(contentsToSend, null, 2)}`);


        try {
            // Use the constructed contentsToSend array
            const result: GenerateContentResult = await model.generateContent({
                contents: contentsToSend,
                generationConfig: generationConfig,
                // Safety settings can be added here if needed
            });

            const response = result.response;
            if (!response) {
                logToFile(`[GeminiService:generateTurn] Error: API returned no response object.`);
                return { status: "error", errorMessage: "API returned no response." };
            }

            const finishReason = response.candidates?.[0]?.finishReason;
            const firstCandidateContent = response.candidates?.[0]?.content;

            logToFile(`[GeminiService:generateTurn] Model Finish Reason: ${finishReason}`);

            // Check for function calls first
            const functionCallPart = firstCandidateContent?.parts?.find(part => part.functionCall);

            if (functionCallPart?.functionCall) {
                logToFile(`[GeminiService:generateTurn] Model requested function call: ${functionCallPart.functionCall.name}`);
                logToFile(`[GeminiService:generateTurn] Arguments: ${JSON.stringify(functionCallPart.functionCall.args)}`);
                return {
                    status: "requires_function_call",
                    functionCall: functionCallPart.functionCall
                };
            }

            // Check for text response if no function call
            const responseText = response.text();
            if (responseText) {
                logToFile(`[GeminiService:generateTurn] Model generated final text response: ${responseText.substring(0, 100)}...`);
                return {
                    status: "final_text",
                    text: responseText
                };
            }

            // If no function call and no text, analyze the finish reason
            logToFile(`[GeminiService:generateTurn] Warning: Model finished (Reason: ${finishReason}) but produced no text and no function call.`);
            let errorMessage = `Model generation stopped unexpectedly. Reason: ${finishReason || 'Unknown'}`;
            switch (finishReason) {
                case FinishReason.SAFETY:
                    errorMessage = "Model stopped due to safety concerns.";
                    break;
                case FinishReason.RECITATION:
                    errorMessage = "Model stopped due to recitation policy.";
                    break;
                case FinishReason.MAX_TOKENS:
                    errorMessage = "Model stopped because the maximum output token limit was reached.";
                    // If response.text() was empty, then the partial text was probably not useful.
                    break;
                case FinishReason.OTHER:
                default:
                    errorMessage = `Model stopped for unspecified or other reason: ${finishReason || 'Unknown'}`;
                    break;
            }
            return { status: "error", errorMessage: errorMessage };

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`[GeminiService:generateTurn] Error during content generation: ${errorMessage}, Stack: ${errorStack}`);
            return { status: "error", errorMessage: errorMessage || "Failed to generate content." };
        }
    }

    /**
     * Generates content from the Gemini model as a stream.
     * This method handles history, a new input turn, and intelligently processes
     * the first chunk of the stream to identify immediate function calls versus
     * continuous text generation.
     *
     * @param {string | Part[]} nextTurnInput - The content for the current turn.
     *                                          Can be a string (user prompt) or an array of `Part` (function response).
     * @param {ChatHistoryItem[]} history - The conversation history as an array of `ChatHistoryItem`.
     * @param {GenerationConfig} generationConfig - Configuration for the generation process.
     * @param {string} [systemInstruction] - Optional system instruction for the model.
     * @param {Tool[]} [tools] - Optional array of tools (function declarations) for the model to use.
     * @returns {Promise<{ stream?: AsyncGenerator<EnhancedGenerateContentResponse>; error?: string; functionCalls?: FunctionCall }>}
     *          A Promise that resolves with either an `AsyncGenerator` for streaming text, an `error` message,
     *          or a `FunctionCall` if the model immediately requests one.
     */
    async generateStream(
        nextTurnInput: string | Part[],
        history: ChatHistoryItem[],
        generationConfig: GenerationConfig,
        systemInstruction?: string,
        tools?: Tool[]
    ): Promise<{ stream?: AsyncGenerator<EnhancedGenerateContentResponse>; error?: string; functionCalls?: FunctionCall }> {

        // console.log(systemInstruction); 
        const model = this.getModel(systemInstruction, tools);

        logToFile(`[GeminiService:generateStream] Received history with ${history.length} items before mapping.`);

        // Map history to the SDK's `Content` format
        const effectiveHistory: Content[] = history.map(item => ({
            role: item.role,
            parts: item.parts
        }));

        logToFile(`[GeminiService:generateStream] Mapped history (SDK Content[]) with ${effectiveHistory.length} items.`);

        if (effectiveHistory.length > 0) {
            logToFile(`[GeminiService:generateStream] Last item role in effectiveHistory: ${effectiveHistory[effectiveHistory.length - 1].role}`);
        }

        logToFile(`[GeminiService:generateStream] Calling generateContentStream for model: ${this.modelName}`);
        logToFile(`[GeminiService:generateStream] Generation Config: ${JSON.stringify(generationConfig)}`);
        // Log tools if provided
        if (tools && tools.length > 0) {
            const toolNames = tools.map(t => {
                if ('functionDeclarations' in t && t.functionDeclarations) {
                    return t.functionDeclarations.map(fd => fd.name);
                } else if ('codeExecution' in t) {
                    return '[CodeExecutionTool]';
                } else if ('googleSearchRetrieval' in t) { return '[GoogleSearchRetrievalTool]'; }
                return '[UnknownToolType]';
            }).flat();
            logToFile(`[GeminiService:generateStream] Tools provided: ${JSON.stringify(toolNames)}`);
        } else {
            logToFile(`[GeminiService:generateStream] No tools provided.`);
        }

        // Prepare the content for the *next* turn based on nextTurnInput
        let nextTurnContent: Content | null = null;

        if (typeof nextTurnInput === 'string') {
            if (nextTurnInput.trim()) {
                logToFile(`[GeminiService:generateStream] Preparing next turn with user prompt.`);
                nextTurnContent = { role: 'user', parts: [{ text: nextTurnInput }] };
            } else {
                logToFile(`[GeminiService:generateStream] Received empty string as nextTurnInput, skipping adding a user turn.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            logToFile(`[GeminiService:generateStream] Preparing next turn with Function Response Parts.`);
            nextTurnContent = { role: 'function', parts: nextTurnInput };
        } else {
            logToFile(`[GeminiService:generateStream] Received empty array or unexpected type as nextTurnInput, skipping adding this turn.`);
        }

        // Construct the final 'contents' array for the API call
        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
            contentsToSend.push(nextTurnContent);
        } else if (effectiveHistory.length === 0) {
            // If history is empty AND nextTurnInput was also empty/invalid,
            // we cannot send an empty contents array to the API.
            logToFile(`[GeminiService:generateStream] Error: Cannot generate content with empty history and no valid input.`);
            return { error: "Cannot generate content: No history or valid input provided." };
        }

        logToFile(`[GeminiService:generateStream] Preparing stream request with ${contentsToSend.length} Content items.`);
        if (nextTurnContent) {
            logToFile(`  - Added next turn role: ${nextTurnContent.role}`);
        } else {
            logToFile(`  - No valid next turn added, sending only history.`);
        }
        // Optional detailed log:
        // logToFile(`[GeminiService:generateStream] Full 'contents' payload: ${JSON.stringify(contentsToSend, null, 2)}`);


        try {
            // Use generateContentStream
            const streamResult = await model.generateContentStream({
                contents: contentsToSend,
                generationConfig: generationConfig,
            });

            // IMPORTANT: Handling Function Calls with Streams
            // The stream needs to be partially consumed to check for an initial function call.
            // We'll iterate *once* to see if the *first* chunk contains a function call.
            // If it does, we return the function call immediately and *don't* return the stream.
            // If it doesn't, we return a new stream generator that includes the first chunk.

            const iterator = streamResult.stream[Symbol.asyncIterator]();
            const firstChunkResult = await iterator.next();

            if (firstChunkResult.done) {
                // Stream finished immediately (e.g., error, safety block before any content)
                logToFile(`[GeminiService:generateStream] Stream finished on first chunk. Checking aggregated response.`);
                let aggregatedResponse;
                try {
                    aggregatedResponse = await streamResult.response; // Wait for the promise to get aggregated info
                    const finishReason = aggregatedResponse?.candidates?.[0]?.finishReason;
                    logToFile(`[GeminiService:generateStream] Aggregated response finish reason: ${finishReason}`);
                    // Construct error message based on aggregated response
                    let errorMessage = `Stream ended unexpectedly. Reason: ${finishReason || 'Unknown'}`;
                    if (finishReason === FinishReason.SAFETY) { errorMessage = "Content blocked due to safety concerns."; }
                    else if (finishReason === FinishReason.MAX_TOKENS) { errorMessage = "Stream stopped because the maximum output token limit was reached."; }
                    else if (finishReason === FinishReason.RECITATION) { errorMessage = "Stream stopped due to recitation policy."; }
                    // Add other specific reasons if needed
                    return { error: errorMessage };
                } catch (aggError: unknown) { // Catch as unknown
                    const { message: aggErrMsg } = getErrorMessageAndStack(aggError);
                    logToFile(`[GeminiService:generateStream] Error getting aggregated response after immediate stream end: ${aggErrMsg}`);
                    return { error: "Stream ended unexpectedly without providing data." };
                }
            }

            // Check the first chunk for a function call
            const firstChunk = firstChunkResult.value; // This is an EnhancedGenerateContentResponse
            const functionCalls = firstChunk.functionCalls(); // Use helper method from SDK

            if (functionCalls && functionCalls.length > 0) {
                logToFile(`[GeminiService:generateStream] Received function call in first chunk: ${functionCalls[0].name}. Aborting stream and returning function call.`);
                // We found a function call, return it and *discard* the rest of the stream for now.
                // The caller will need to call the service again after executing the function.
                return { functionCalls: functionCalls[0] };
            }

            // No function call in the first chunk, proceed with streaming text
            logToFile(`[GeminiService:generateStream] No function call in first chunk. Returning stream generator.`);
            // Return a *new* async generator that yields the first chunk
            // and then continues with the rest of the original stream.
            async function* combinedStream(): AsyncGenerator<EnhancedGenerateContentResponse> {
                // Yield the first chunk we already consumed
                yield firstChunk;
                // Continue yielding from the rest of the original iterator
                for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
                    yield chunk;
                }
            }

            return { stream: combinedStream() }; // Return the new generator

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`[GeminiService:generateStream] Error initiating stream: ${errorMessage}, Stack: ${errorStack}`);
            return { error: errorMessage || "Failed to initiate content stream." };
        }
    }
}