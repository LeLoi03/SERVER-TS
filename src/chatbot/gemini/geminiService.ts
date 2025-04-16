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

    private getModel(systemInstruction?: string, tools?: Tool[]): GenerativeModel {
        return this.genAI.getGenerativeModel({
            model: this.modelName,
            ...(systemInstruction && { systemInstruction: { role: "model", parts: [{ text: systemInstruction }] } }),
            ...(tools && tools.length > 0 && { tools: tools }),
        });
    }

    async generateTurn(
        promptOrResponseParts: string | Part[],
        history: HistoryItem[],
        generationConfig: GenerationConfig,
        systemInstruction?: string,
        tools?: Tool[]
    ): Promise<GeminiInteractionResult> {
        const model = this.getModel(systemInstruction, tools);

        // --- LOG HISTORY BEFORE MAPPING ---
        logToFile(`[GeminiService] Received history with ${history.length} items before mapping.`);
        // --- END LOG ---

        const effectiveHistory: Content[] = history.map(item => ({
            role: item.role,
            parts: item.parts
        }));

        // --- LOG HISTORY AFTER MAPPING (Ready for API) ---
        logToFile(`[GeminiService] Mapped to effectiveHistory (SDK Content[]) with ${effectiveHistory.length} items.`);
        if (effectiveHistory.length > 0) {
             logToFile(`[GeminiService] Last item role in effectiveHistory: ${effectiveHistory[effectiveHistory.length - 1].role}`);
             // Optional detailed log:
             // logToFile(`[GeminiService] effectiveHistory content: ${JSON.stringify(effectiveHistory, null, 2)}`);
        }
        // --- END LOG ---


        logToFile(`Calling generateContent for model: ${this.modelName}`);
        // logToFile(`History content: ${JSON.stringify(effectiveHistory)}`); // Careful logging potentially large data
        logToFile(`Generation Config: ${JSON.stringify(generationConfig)}`);

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

        try {
            let contentRequest: string | Part[];
            let currentTurnRole: 'user' | 'function' = 'user'; // Default to user

            if (typeof promptOrResponseParts === 'string') {
                logToFile(`User Prompt: ${promptOrResponseParts}`);
                contentRequest = promptOrResponseParts; // User's text input
                currentTurnRole = 'user';
            } else {
                logToFile(`Function Response Parts provided: ${JSON.stringify(promptOrResponseParts)}`);
                contentRequest = promptOrResponseParts;
                currentTurnRole = 'function'; // This turn contains the function response
            }

            // --- LOG FINAL CONTENT BEING SENT ---
            const contentsToSend: Content[] = [
                ...effectiveHistory,
                { role: currentTurnRole, parts: Array.isArray(contentRequest) ? contentRequest : [{ text: contentRequest }] }
            ];
            logToFile(`[GeminiService] Sending total ${contentsToSend.length} Content items to API.`);
            logToFile(`  - Current turn role: ${currentTurnRole}`);
             // Optional detailed log:
             // logToFile(`[GeminiService] Full 'contents' payload: ${JSON.stringify(contentsToSend, null, 2)}`);
            // --- END LOG ---


            const result: GenerateContentResult = await model.generateContent({
                contents: contentsToSend, // Use the constructed array
                generationConfig: generationConfig,
            });

            // ... (rest of the response processing logic remains the same) ...
             const response = result.response;
            const finishReason = response.candidates?.[0]?.finishReason;
            const firstCandidateContent = response.candidates?.[0]?.content;

            logToFile(`Model Finish Reason: ${finishReason}`);

            const functionCallPart = firstCandidateContent?.parts.find(part => part.functionCall);

            if (functionCallPart?.functionCall) {
                logToFile(`Model requested function call: ${functionCallPart.functionCall.name}`);
                logToFile(`Arguments: ${JSON.stringify(functionCallPart.functionCall.args)}`);
                return {
                    status: "requires_function_call",
                    functionCall: functionCallPart.functionCall
                };
            } else if (finishReason === FinishReason.STOP || finishReason === FinishReason.MAX_TOKENS || finishReason === FinishReason.OTHER || finishReason === FinishReason.FINISH_REASON_UNSPECIFIED) {
                 const responseText = response.text();
                 if (responseText) {
                     logToFile(`Model generated final text response: ${responseText.substring(0, 200)}...`);
                     return {
                         status: "final_text",
                         text: responseText
                     };
                 } else {
                      logToFile(`Warning: Model stopped (Reason: ${finishReason}) but produced no text and no function call.`);
                      return { status: "error", errorMessage: `Model stopped (Reason: ${finishReason}) without providing text or a function call.` };
                 }
            } else {
                 logToFile(`Model stopped due to an issue. Finish Reason: ${finishReason}. Full response: ${JSON.stringify(response)}`);
                 let errorMessage = `Model generation stopped unexpectedly. Reason: ${finishReason || 'Unknown'}`;
                 if(finishReason === FinishReason.SAFETY){ errorMessage = "Model stopped due to safety concerns."; }
                 else if (finishReason === FinishReason.RECITATION){ errorMessage = "Model stopped due to recitation policy."; }
                 else if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL){ errorMessage = "Model attempted a function call but it was malformed."; }
                 return { status: "error", errorMessage: errorMessage };
            }


        } catch (error: any) {
            logToFile(`Error in generateTurn: ${error.message}, Stack: ${error.stack}`);
            return { status: "error", errorMessage: error.message || "Failed to generate content." };
        }
    }
}