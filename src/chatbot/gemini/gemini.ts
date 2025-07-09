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
            
            throw new Error("API Key is not set.");
        }
        // Initialize the GoogleGenAI client
        this.ai = new GoogleGenAI({ apiKey }); // Pass apiKey in options object
        this.modelId = modelId;
        // 
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
        

        const effectiveHistory: Content[] = history
            .map(item => {
                const cleanedParts = item.parts.map(cleanPart).filter(p => Object.keys(p).length > 0);
                // Nếu không có part nào hợp lệ sau khi clean, không tạo content item này
                if (cleanedParts.length === 0) {
                    
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


        // 

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
            
        } else {
            
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
                
            }
        }


        const contentsToSend: Content[] = [...effectiveHistory];
        if (currentTurnContent) {
            contentsToSend.push(currentTurnContent);
        } else if (effectiveHistory.length === 0) {
            
            return { status: "error", errorMessage: "Cannot generate content: No history or valid input." };
        }

        if (contentsToSend.length === 0) {
            
            return { status: "error", errorMessage: "No content to send to the model." };
        }

        
        // 

        try {
            const response: GenerateContentResponse = await this.ai.models.generateContent({
                model: this.modelId,
                contents: contentsToSend,
                config: apiConfig, // Đã bao gồm systemInstruction và tools
            });

            const finishReason = response.candidates?.[0]?.finishReason;
            const functionCalls = response.functionCalls; // Mảng các FunctionCall

            

            if (functionCalls && functionCalls.length > 0) {
                
                if (functionCalls.length > 1) {
                    
                }
                const fc = functionCalls[0]; // Chỉ xử lý cái đầu tiên theo logic HostAgent hiện tại
                
                return {
                    status: "requires_function_call",
                    functionCall: fc
                };
            }

            const responseText = response.text;
            const responseParts = response.candidates?.[0]?.content?.parts;

            if (responseText !== undefined && responseText !== null) {
                
                return {
                    status: "final_text",
                    text: responseText,
                    parts: responseParts
                };
            } else if (responseParts && responseParts.length > 0) {
                
                const textSummaryFromParts = responseParts.find(p => p.text)?.text || "[Multimodal content]";
                return {
                    status: "final_text",
                    text: textSummaryFromParts,
                    parts: responseParts
                };
            }

            
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
        

        const effectiveHistory: Content[] = history
            .map(item => {
                const cleanedParts = item.parts.map(cleanPart).filter(p => Object.keys(p).length > 0);
                // Nếu không có part nào hợp lệ sau khi clean, không tạo content item này
                if (cleanedParts.length === 0) {
                    
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

        // 
        if (apiConfig.tools && apiConfig.tools.length > 0) {
            const toolNames = apiConfig.tools.map(t => {
                if (t.functionDeclarations) { return t.functionDeclarations.map(fd => fd.name); }
                else if (t.codeExecution) { return '[CodeExecutionTool]'; }
                else if (t.googleSearchRetrieval) { return '[GoogleSearchRetrievalTool]'; }
                else if (t.googleSearch) { return '[GoogleSearchTool]'; }
                return '[UnknownToolType]';
            }).flat();
            
        } else {
            
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
                
            }
        }


        const contentsToSend: Content[] = [...effectiveHistory];
        if (currentTurnContent) {
            contentsToSend.push(currentTurnContent);
        } else if (effectiveHistory.length === 0) {
            
            return { error: "Cannot generate stream: No history or valid input." };
        }

        if (contentsToSend.length === 0) {
            
            return { error: "No content to send to the model for streaming." };
        }

        
        // 
        // if (contentsToSend.length > 2) 

        try {
            const streamGenerator = await this.ai.models.generateContentStream({
                model: this.modelId,
                contents: contentsToSend,
                config: apiConfig,
            });

            const iterator = streamGenerator[Symbol.asyncIterator]();
            const firstChunkResult = await iterator.next();

            if (firstChunkResult.done) {
                
                const finalResponseAfterEmptyStream = firstChunkResult.value; // This is GenerateContentResponse | undefined
                if (finalResponseAfterEmptyStream) {
                    const finishReason = finalResponseAfterEmptyStream.candidates?.[0]?.finishReason;
                    
                    const functionCalls = finalResponseAfterEmptyStream.functionCalls;
                    if (functionCalls && functionCalls.length > 0) {
                        
                        return { functionCall: functionCalls[0] };
                    }
                    const text = finalResponseAfterEmptyStream.text; // Direct property
                    if (text !== undefined && text !== null) {
                        
                        async function* singleChunkStream(): AsyncGenerator<GenerateContentResponse> {
                            yield finalResponseAfterEmptyStream;
                        }
                        return { stream: singleChunkStream() };
                    }
                    let errorMessage = `Stream ended. Reason: ${finishReason || 'Unknown'}`;
                    if (finishReason === FinishReason.SAFETY) { errorMessage = "Content blocked due to safety concerns."; }
                    return { error: errorMessage };
                }

                
                return { error: "Stream ended unexpectedly without providing data." };
            }

            const firstChunk = firstChunkResult.value;
            const functionCallsInFirstChunk = firstChunk.functionCalls;

            if (functionCallsInFirstChunk && functionCallsInFirstChunk.length > 0) {
                
                
                if (functionCallsInFirstChunk.length > 1) {
                    
                }
                return { functionCall: functionCallsInFirstChunk[0] }; // Chỉ xử lý cái đầu tiên
            }

            
            async function* combinedStream(): AsyncGenerator<GenerateContentResponse> {
                yield firstChunk;
                for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
                    yield chunk;
                }
            }
            return { stream: combinedStream() };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            return { error: errorMessage || "Failed to initiate content stream." };
        }
    }
}