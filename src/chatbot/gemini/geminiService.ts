// src/gemini/geminiService.ts
import {
    GoogleGenerativeAI,
    GenerationConfig,
    GenerativeModel,
    Tool,
    Content,
    Part,
    GenerateContentResult,
    FinishReason
} from "@google/generative-ai";
import logToFile from '../utils/logger';
import { HistoryItem } from '../shared/types';
import { GeminiInteractionResult } from '../shared/types';

export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private modelName: string;

    constructor(apiKey: string, modelName: string) {
        if (!apiKey) {
            throw new Error("API Key is not set.");
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelName = modelName;
        logToFile(`GeminiService initialized for model: ${modelName}`);
    }

    // getModel remains the same
    private getModel(systemInstruction?: string, tools?: Tool[]): GenerativeModel {
        // Construct system instruction part only if provided
        const systemInstructionPart = systemInstruction
            ? { role: "system", parts: [{ text: systemInstruction }] } // SDK now recommends 'system' role
            : undefined;

        return this.genAI.getGenerativeModel({
            model: this.modelName,
            // Conditionally add systemInstruction and tools
            ...(systemInstructionPart && { systemInstruction: systemInstructionPart }),
            ...(tools && tools.length > 0 && { tools: tools }),
        });
    }


    async generateTurn(
        // Renamed for clarity: This represents the parts for the *next* turn we are adding
        // This can be user input (as string) or function response (as Part[])
        nextTurnInput: string | Part[],
        history: HistoryItem[],
        generationConfig: GenerationConfig,
        systemInstruction?: string,
        tools?: Tool[]
    ): Promise<GeminiInteractionResult> {

        const model = this.getModel(systemInstruction, tools);

        logToFile(`[GeminiService] Received history with ${history.length} items before mapping.`);

        // Map history to the SDK's Content format
        const effectiveHistory: Content[] = history.map(item => ({
            // Ensure roles are compatible with the SDK's expected roles ('user', 'model', 'function')
            // If your HistoryItem uses different role names, map them here.
            role: item.role,
            parts: item.parts // Assuming item.parts is already compatible with SDK Part[]
        }));

        logToFile(`[GeminiService] Mapped to effectiveHistory (SDK Content[]) with ${effectiveHistory.length} items.`);
        if (effectiveHistory.length > 0) {
             logToFile(`[GeminiService] Last item role in effectiveHistory: ${effectiveHistory[effectiveHistory.length - 1].role}`);
        }

        logToFile(`Calling generateContent for model: ${this.modelName}`);
        logToFile(`Generation Config: ${JSON.stringify(generationConfig)}`);
        // Log tools (existing logic seems okay)
        if (tools) {
            const toolNames = tools.map(t => {
                if ('functionDeclarations' in t && t.functionDeclarations) {
                    return t.functionDeclarations.map(fd => fd.name);
                } else if ('codeExecution' in t) { return '[CodeExecutionTool]';
                } else if ('googleSearchRetrieval' in t) { return '[GoogleSearchRetrievalTool]'; }
                return '[UnknownToolType]';
            }).flat();
            logToFile(`Tools provided: ${JSON.stringify(toolNames)}`);
        }

        // --- *** MODIFICATION START *** ---
        // Prepare the content for the *next* turn based on nextTurnInput

        let nextTurnContent: Content | null = null;

        if (typeof nextTurnInput === 'string') {
            // It's a user text prompt
            if (nextTurnInput.trim()) { // Check if string is not empty/whitespace
                logToFile(`[GeminiService] Preparing next turn with user prompt: ${nextTurnInput}`);
                nextTurnContent = { role: 'user', parts: [{ text: nextTurnInput }] };
            } else {
                 logToFile(`[GeminiService] Received empty string as nextTurnInput, skipping adding a user turn.`);
            }
        } else if (Array.isArray(nextTurnInput) && nextTurnInput.length > 0) {
             // It's parts, likely a function response. Check if the array is not empty.
            logToFile(`[GeminiService] Preparing next turn with Function Response Parts: ${JSON.stringify(nextTurnInput)}`);
            // Assume function responses should have the 'function' role for the API
            nextTurnContent = { role: 'function', parts: nextTurnInput };
        } else {
             // Input is an empty array or some other unexpected type. Log and skip adding this turn.
             logToFile(`[GeminiService] Received empty array or unexpected type as nextTurnInput, skipping adding this turn.`);
        }


        // Construct the final 'contents' array for the API call
        const contentsToSend: Content[] = [...effectiveHistory];
        if (nextTurnContent) {
             // Only add the next turn if it was validly created
            contentsToSend.push(nextTurnContent);
        } else if (effectiveHistory.length === 0) {
             // Edge case: If history is empty AND nextTurnInput was also empty/invalid,
             // we cannot send an empty contents array to the API.
             logToFile(`[GeminiService] Error: Cannot generate content with empty history and no valid input for the next turn.`);
             return { status: "error", errorMessage: "Cannot generate content: No history or valid input provided." };
        }

        logToFile(`[GeminiService] Sending total ${contentsToSend.length} Content items to API.`);
        if (nextTurnContent) {
             logToFile(`  - Added next turn role: ${nextTurnContent.role}`);
        } else {
             logToFile(`  - No valid next turn added, sending only history.`);
        }
         // Optional detailed log:
         // logToFile(`[GeminiService] Full 'contents' payload: ${JSON.stringify(contentsToSend, null, 2)}`);
        // --- *** MODIFICATION END *** ---


        try {
            // Use the constructed contentsToSend array
            const result: GenerateContentResult = await model.generateContent({
                contents: contentsToSend,
                generationConfig: generationConfig,
                // Safety settings can be added here if needed
            });

            // --- Result processing logic remains the same ---
            const response = result.response;
            if (!response) { // Handle cases where response might be missing
                 logToFile(`Error in generateTurn: API returned no response object.`);
                 return { status: "error", errorMessage: "API returned no response." };
            }

            const finishReason = response.candidates?.[0]?.finishReason;
            const firstCandidateContent = response.candidates?.[0]?.content;

            logToFile(`Model Finish Reason: ${finishReason}`);

            // Check for function calls first
            const functionCallPart = firstCandidateContent?.parts?.find(part => part.functionCall); // Optional chaining

            if (functionCallPart?.functionCall) {
                logToFile(`Model requested function call: ${functionCallPart.functionCall.name}`);
                logToFile(`Arguments: ${JSON.stringify(functionCallPart.functionCall.args)}`);
                return {
                    status: "requires_function_call",
                    functionCall: functionCallPart.functionCall
                };
            }

            // Check for text response if no function call
             const responseText = response.text(); // response.text() handles candidate checking internally
             if (responseText) { // Check if text is not null/undefined/empty string
                logToFile(`Model generated final text response: ${responseText}...`);
                 return {
                     status: "final_text",
                     text: responseText
                 };
             }

            // If no function call and no text, analyze the finish reason
             logToFile(`Warning: Model finished (Reason: ${finishReason}) but produced no text and no function call.`);
             let errorMessage = `Model generation stopped unexpectedly. Reason: ${finishReason || 'Unknown'}`;
             switch(finishReason) {
                 case FinishReason.SAFETY:
                     errorMessage = "Model stopped due to safety concerns.";
                     break;
                 case FinishReason.RECITATION:
                     errorMessage = "Model stopped due to recitation policy.";
                     break;
                 case FinishReason.MAX_TOKENS:
                      errorMessage = "Model stopped because the maximum output token limit was reached.";
                      // For MAX_TOKENS, you might still have partial text in response.candidates[0].content.parts
                      // You could attempt to extract it, but response.text() likely handles this best.
                      // If response.text() was empty, then the partial text was probably not useful.
                      break;
                 // Add other specific reasons if needed
             }
             return { status: "error", errorMessage: errorMessage };


        } catch (error: any) {
            logToFile(`Error in generateTurn: ${error.message}, Stack: ${error.stack}`);
            // Check for specific GoogleGenerativeAI errors if possible
            return { status: "error", errorMessage: error.message || "Failed to generate content." };
        }
    }
}