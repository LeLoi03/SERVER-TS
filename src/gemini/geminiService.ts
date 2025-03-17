// src/gemini/geminiService.ts
import { GoogleGenerativeAI, GenerationConfig } from "@google/generative-ai";
import logToFile from '../utils/logger';
import { HistoryItem } from '../shared/types'; // Shared type


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


    private getModelWithSystemInstruction(systemInstruction: string) {
        return this.genAI.getGenerativeModel({
            model: this.modelName,
            systemInstruction: systemInstruction,
        });
    }

    async startChatSession(history: HistoryItem[], generationConfig: GenerationConfig, systemInstruction?: string) {
        const model = systemInstruction
            ? this.getModelWithSystemInstruction(systemInstruction)
            : this.genAI.getGenerativeModel({ model: this.modelName }); // Default model

        return model.startChat({
            generationConfig, // Use the provided generationConfig
            history: history,
        });
    }

    async getResponse(userInput: string, history: HistoryItem[] = [], generationConfig: GenerationConfig, systemInstruction?: string): Promise<string> {
        const chat = await this.startChatSession(history, generationConfig, systemInstruction); // Pass config
        const result = await chat.sendMessage(userInput);
        logToFile(`Sent message to Gemini (${this.modelName}).`);
        return result.response.text();
    }

    // Method specifically for generateContent,  useful for image generation or when you don't need chat history
    async generateContent(parts: any[], generationConfig: GenerationConfig, systemInstruction?: string): Promise<string> {
        const model = systemInstruction
            ? this.getModelWithSystemInstruction(systemInstruction)
            : this.genAI.getGenerativeModel({ model: this.modelName });

        const result = await model.generateContent({
            contents: [{ role: "user", parts }],
            generationConfig, // Pass config here too
        });
        logToFile(`Sent content to Gemini (${this.modelName}).`);
        return result.response.text();
    }
}