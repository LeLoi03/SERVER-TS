// src/chatbot/gemini/gemini.ts

import {
    GoogleGenAI,
    GenerateContentConfig, // This is for the config object within GenerateContentParameters
    Tool,
    Content,
    Part,
    GenerateContentResponse,
    FinishReason,
    FunctionCall,
    // createUserContent, // SDK helper for string -> Content {role: 'user', parts: [{text: string}]}
    // createPartFromFunctionResponse, // SDK helper for FunctionResponse -> Part
} from '@google/genai'; // Your SDK import

import logToFile from '../../utils/logger';
import { ChatHistoryItem, GeminiInteractionResult } from '../shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

// Helper to construct Content for a user's turn if it's Part[]
function createUserContentFromParts(parts: Part[]): Content {
    return { role: 'user', parts: parts };
}

// Helper to construct Content for a function response.
function createFunctionResponseContent(functionResponseParts: Part[]): Content {
    // Assuming functionResponseParts are already correctly formatted FunctionResponsePart objects
    return { role: 'function', parts: functionResponseParts };
}


function cleanPart(part: Part): Part {
    if (part.text && typeof part.text === 'string' && part.text.trim() !== "") { // Chỉ trả về nếu text có nội dung
        return { text: part.text };
    }
    if (part.inlineData && typeof part.inlineData.mimeType === 'string' && typeof part.inlineData.data === 'string') {
        return { inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } };
    }
    // QUAN TRỌNG: Chỉ trả về fileData nếu có cả mimeType và fileUri
    if (part.fileData && typeof part.fileData.mimeType === 'string' && typeof part.fileData.fileUri === 'string') {
        return { fileData: { mimeType: part.fileData.mimeType, fileUri: part.fileData.fileUri } };
    }
    if (part.functionCall && typeof part.functionCall.name === 'string') {
        return { functionCall: part.functionCall };
    }
    if (part.functionResponse && typeof part.functionResponse.name === 'string') {
        return { functionResponse: part.functionResponse };
    }
    // console.warn("[GeminiService cleanPart] Part is empty or invalid after cleaning:", part);
    return {}; // Sẽ được lọc ra
}
/**
 * A service class for interacting with the Google Gemini API using the @google/genai SDK.
 * Handles both one-shot content generation and streaming responses,
 * including integration with function calling.
 */
export class Gemini {
    private ai: GoogleGenAI; // Instance of the SDK
    private modelId: string;

    constructor(apiKey: string, modelId: string) {
        if (!apiKey) {
            logToFile(`[GeminiService] Error: API Key is not set.`);
            throw new Error("API Key is not set.");
        }
        // Initialize the GoogleGenAI client
        this.ai = new GoogleGenAI({ apiKey }); // Pass apiKey in options object
        this.modelId = modelId;
        // logToFile(`[GeminiService] Initialized for model: ${this.modelId} using @google/genai SDK.`);
    }

    /**
    * Generates a single content turn (non-streaming) from the Gemini model.
    *
    * @param {string | Part[]} nextTurnInput - The content for the current turn.
    *        If string, it's a user text message.
    *        If Part[], it can be user's multimodal input or a function response.
    *        The caller (e.g., hostAgent handler) should ensure the Part[] structure is correct
    *        for its intended role (user vs function).
    * @param {ChatHistoryItem[]} history - The conversation history.
    * @param {GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }} generationAndSystemConfig - Configuration.
    * @returns {Promise<GeminiInteractionResult>} Result of the interaction.
    */
    async generateTurn(
        nextTurnInput: string | Part[],
        // history: ChatHistoryItem[] - Lịch sử các lượt TRƯỚC ĐÓ, không bao gồm nextTurnInput
        history: ChatHistoryItem[],
        generationAndSystemConfig: GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }
    ): Promise<GeminiInteractionResult> {

        const handlerIdForLog = `[GeminiService:generateTurn ${Date.now().toString().slice(-4)}]`;
        logToFile(`${handlerIdForLog} History items received: ${history.length}.`);

        const effectiveHistory: Content[] = history
            .map(item => {
                const cleanedParts = item.parts.map(cleanPart).filter(p => Object.keys(p).length > 0);
                // Nếu không có part nào hợp lệ sau khi clean, không tạo content item này
                if (cleanedParts.length === 0) {
                    logToFile(`[GeminiService] Warning: All parts for role ${item.role} (uuid: ${item.uuid}) became empty after cleaning. Original parts: ${JSON.stringify(item.parts)}. Skipping this history item.`);
                    return null; // Sẽ được lọc bỏ ở bước sau
                }
                return {
                    role: item.role,
                    parts: cleanedParts
                };
            })
            .filter(contentItem => contentItem !== null) as Content[]; // Lọc bỏ các item null

        const apiConfig: GenerateContentConfig = { ...generationAndSystemConfig };

        if (typeof generationAndSystemConfig.systemInstruction === 'string') {
            apiConfig.systemInstruction = { parts: [{ text: generationAndSystemConfig.systemInstruction }] };
        } else if (generationAndSystemConfig.systemInstruction) {
            apiConfig.systemInstruction = generationAndSystemConfig.systemInstruction;
        }


        // logToFile(`[GeminiService:generateTurn] Effective Generation Config: ${JSON.stringify(apiConfig)}`);

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

        let currentTurnContent: Content | null = null;
        if (typeof nextTurnInput === 'string') {
            if (nextTurnInput.trim()) {
                currentTurnContent = { role: 'user', parts: [{ text: nextTurnInput }] };
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            const cleanedInputParts = nextTurnInput.map(cleanPart).filter(p => Object.keys(p).length > 0);
            if (cleanedInputParts.length > 0) {
                if (cleanedInputParts.some(part => part.functionResponse)) {
                    currentTurnContent = createFunctionResponseContent(cleanedInputParts);
                } else {
                    currentTurnContent = createUserContentFromParts(cleanedInputParts);
                }
            } else {
                logToFile(`[GeminiService] Warning: nextTurnInput (Part[]) became empty after cleaning. Original: ${JSON.stringify(nextTurnInput)}`);
            }
        }


        const contentsToSend: Content[] = [...effectiveHistory];
        if (currentTurnContent) {
            contentsToSend.push(currentTurnContent);
        } else if (effectiveHistory.length === 0) {
            logToFile(`${handlerIdForLog} Error: No history and no valid current turn input.`);
            return { status: "error", errorMessage: "Cannot generate content: No history or valid input." };
        }

        if (contentsToSend.length === 0) {
            logToFile(`${handlerIdForLog} Error: No content to send.`);
            return { status: "error", errorMessage: "No content to send to the model." };
        }

        logToFile(`${handlerIdForLog} Sending ${contentsToSend.length} Content items. Model: ${this.modelId}`);
        // logToFile(`${handlerIdForLog} ContentsToSend: ${JSON.stringify(contentsToSend, null, 2)}`); // Log chi tiết nếu cần debug

        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({
                model: this.modelId,
                contents: contentsToSend,
                config: apiConfig, // Đã bao gồm systemInstruction và tools
            });

            const finishReason = response.candidates?.[0]?.finishReason;
            const functionCalls = response.functionCalls; // Mảng các FunctionCall

            logToFile(`${handlerIdForLog} Model Finish Reason: ${finishReason}`);

            if (functionCalls && functionCalls.length > 0) {
                logToFile(`${handlerIdForLog} Received ${functionCalls.length} functionCalls from API. Content: ${JSON.stringify(functionCalls)}`);
                if (functionCalls.length > 1) {
                    logToFile(`${handlerIdForLog} WARNING: Model returned multiple function calls, but only the first one will be processed by current HostAgent logic.`);
                }
                const fc = functionCalls[0]; // Chỉ xử lý cái đầu tiên theo logic HostAgent hiện tại
                logToFile(`${handlerIdForLog} Model requested function call: ${fc.name}. Args: ${JSON.stringify(fc.args)}`);
                return {
                    status: "requires_function_call",
                    functionCall: fc
                };
            }

            const responseText = response.text;
            const responseParts = response.candidates?.[0]?.content?.parts;

            if (responseText !== undefined && responseText !== null) {
                logToFile(`${handlerIdForLog} Model generated final text response (length: ${responseText.length}).`);
                return {
                    status: "final_text",
                    text: responseText,
                    parts: responseParts
                };
            } else if (responseParts && responseParts.length > 0) {
                logToFile(`${handlerIdForLog} Model generated parts but no single text response. Parts count: ${responseParts.length}`);
                const textSummaryFromParts = responseParts.find(p => p.text)?.text || "[Multimodal content]";
                return {
                    status: "final_text",
                    text: textSummaryFromParts,
                    parts: responseParts
                };
            }

            logToFile(`[GeminiService:generateTurn] Warning: No text and no function call. Reason: ${finishReason}`);
            let errorMessage = `Model generation stopped. Reason: ${finishReason || 'Unknown'}`;
            switch (finishReason) {
                case FinishReason.SAFETY:
                    errorMessage = "Model stopped due to safety concerns.";
                    if (response.promptFeedback?.blockReason) {
                        errorMessage += ` Prompt feedback: ${response.promptFeedback.blockReason}`;
                        if (response.promptFeedback.blockReasonMessage) errorMessage += ` - ${response.promptFeedback.blockReasonMessage}`;
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
    */
    async generateStream(
        nextTurnInput: string | Part[],
        // history: ChatHistoryItem[] - Lịch sử các lượt TRƯỚC ĐÓ, không bao gồm nextTurnInput
        history: ChatHistoryItem[],
        generationAndSystemConfig: GenerateContentConfig & { systemInstruction?: string | Content; tools?: Tool[] }
    ): Promise<{ stream?: AsyncGenerator<GenerateContentResponse>; error?: string; functionCall?: FunctionCall }> {
        const handlerIdForLog = `[GeminiService:generateStream ${Date.now().toString().slice(-4)}]`;
        logToFile(`${handlerIdForLog} History items received: ${history.length}.`);

        const effectiveHistory: Content[] = history
            .map(item => {
                const cleanedParts = item.parts.map(cleanPart).filter(p => Object.keys(p).length > 0);
                // Nếu không có part nào hợp lệ sau khi clean, không tạo content item này
                if (cleanedParts.length === 0) {
                    logToFile(`[GeminiService] Warning: All parts for role ${item.role} (uuid: ${item.uuid}) became empty after cleaning. Original parts: ${JSON.stringify(item.parts)}. Skipping this history item.`);
                    return null; // Sẽ được lọc bỏ ở bước sau
                }
                return {
                    role: item.role,
                    parts: cleanedParts
                };
            })
            .filter(contentItem => contentItem !== null) as Content[]; // Lọc bỏ các item null

        const apiConfig: GenerateContentConfig = { ...generationAndSystemConfig };
        if (typeof generationAndSystemConfig.systemInstruction === 'string') {
            apiConfig.systemInstruction = { parts: [{ text: generationAndSystemConfig.systemInstruction }] };
        } else if (generationAndSystemConfig.systemInstruction) {
            apiConfig.systemInstruction = generationAndSystemConfig.systemInstruction;
        }

        // logToFile(`[GeminiService:generateStream] Effective Generation Config: ${JSON.stringify(apiConfig)}`);
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

        let currentTurnContent: Content | null = null;
        if (typeof nextTurnInput === 'string') {
            if (nextTurnInput.trim()) {
                currentTurnContent = { role: 'user', parts: [{ text: nextTurnInput }] };
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
            const cleanedInputParts = nextTurnInput.map(cleanPart).filter(p => Object.keys(p).length > 0);
            if (cleanedInputParts.length > 0) {
                if (cleanedInputParts.some(part => part.functionResponse)) {
                    currentTurnContent = createFunctionResponseContent(cleanedInputParts);
                } else {
                    currentTurnContent = createUserContentFromParts(cleanedInputParts);
                }
            } else {
                logToFile(`[GeminiService] Warning: nextTurnInput (Part[]) became empty after cleaning. Original: ${JSON.stringify(nextTurnInput)}`);
            }
        }


        const contentsToSend: Content[] = [...effectiveHistory];
        if (currentTurnContent) {
            contentsToSend.push(currentTurnContent);
        } else if (effectiveHistory.length === 0) {
            logToFile(`${handlerIdForLog} Error: No history and no valid current turn input.`);
            return { error: "Cannot generate stream: No history or valid input." };
        }

        if (contentsToSend.length === 0) {
            logToFile(`${handlerIdForLog} Error: No content to send for streaming.`);
            return { error: "No content to send to the model for streaming." };
        }

        logToFile(`${handlerIdForLog} Sending ${contentsToSend.length} Content items for stream. Model: ${this.modelId}`);
        logToFile(`${handlerIdForLog} ContentsToSend (first 2 items): ${JSON.stringify(contentsToSend.slice(0, 2), null, 2)}`);
        if (contentsToSend.length > 2) logToFile(`${handlerIdForLog} ContentsToSend (last 2 items): ${JSON.stringify(contentsToSend.slice(-2), null, 2)}`);

        try {
            const streamGenerator = await this.ai.models.generateContentStream({
                model: this.modelId,
                contents: contentsToSend,
                config: apiConfig,
            });

            const iterator = streamGenerator[Symbol.asyncIterator]();
            const firstChunkResult = await iterator.next();

            if (firstChunkResult.done) {
                logToFile(`[GeminiService:generateStream] Stream finished on first chunk or was empty.`);
                const finalResponseAfterEmptyStream = firstChunkResult.value; // This is GenerateContentResponse | undefined
                if (finalResponseAfterEmptyStream) {
                    const finishReason = finalResponseAfterEmptyStream.candidates?.[0]?.finishReason;
                    logToFile(`[GeminiService:generateStream] Stream was a single chunk. Finish Reason: ${finishReason}`);
                    const functionCalls = finalResponseAfterEmptyStream.functionCalls;
                    if (functionCalls && functionCalls.length > 0) {
                        logToFile(`[GeminiService:generateStream] Function call in single chunk response: ${functionCalls[0].name}.`);
                        return { functionCall: functionCalls[0] };
                    }
                    const text = finalResponseAfterEmptyStream.text; // Direct property
                    if (text !== undefined && text !== null) {
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

            const firstChunk = firstChunkResult.value;
            const functionCallsInFirstChunk = firstChunk.functionCalls;

            if (functionCallsInFirstChunk && functionCallsInFirstChunk.length > 0) {
                logToFile(`${handlerIdForLog} First chunk with function call: ${JSON.stringify(firstChunk, null, 2)}`);
                logToFile(`${handlerIdForLog} Received ${functionCallsInFirstChunk.length} functionCalls from API in first chunk.`);
                if (functionCallsInFirstChunk.length > 1) {
                    logToFile(`${handlerIdForLog} WARNING: Model returned multiple function calls in first chunk, but only the first one will be processed by current HostAgent logic.`);
                }
                return { functionCall: functionCallsInFirstChunk[0] }; // Chỉ xử lý cái đầu tiên
            }

            logToFile(`${handlerIdForLog} No function call in first chunk. Returning combined stream.`);
            async function* combinedStream(): AsyncGenerator<GenerateContentResponse> {
                yield firstChunk;
                for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
                    yield chunk;
                }
            }
            return { stream: combinedStream() };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${handlerIdForLog} Error initiating stream: ${errorMessage}, Stack: ${errorStack}`);
            return { error: errorMessage || "Failed to initiate content stream." };
        }
    }
}