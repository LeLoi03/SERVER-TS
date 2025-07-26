// src/config/gemini-api-type.config.ts
import { singleton } from 'tsyringe';
import fs from 'fs';
import { AppConfig, GeminiApiConfig, GeminiApiConfigs } from './types';
import { API_TYPE_CFP, API_TYPE_DETERMINE, API_TYPE_EXTRACT, CFP_INFORMATION_CSV_PATH, DETERMINE_LINKS_CSV_PATH, EXTRACT_INFORMATION_CSV_PATH } from './constants';
import { read_csv, createInputsOutputs } from '../utils/crawl/fewShotExamplesInit';
import { InputsOutputs } from '../types/crawl/crawl.types';
import { Type, Schema } from "@google/genai";

@singleton()
export class GeminiApiTypeConfig {
    public readonly apiConfigs: GeminiApiConfigs;
    public readonly websiteDescription?: string;

    // Tuned model names and fallbacks
    public readonly extractTunedModelNames: string[];
    public readonly extractTunedFallbackModelName?: string;
    public readonly extractNonTunedModelNames: string[];
    public readonly extractNonTunedFallbackModelName?: string;

    public readonly cfpTunedModelNames: string[];
    public readonly cfpTunedFallbackModelName?: string;
    public readonly cfpNonTunedModelNames: string[];
    public readonly cfpNonTunedFallbackModelName?: string;

    public readonly determineTunedModelNames: string[];
    public readonly determineTunedFallbackModelName?: string;
    public readonly determineNonTunedModelNames: string[];
    public readonly determineNonTunedFallbackModelName?: string;

    private initializationPromise: Promise<void> | null = null;

    constructor(private appConfig: AppConfig) {
        this.websiteDescription = appConfig.WEBSITE_DESCRIPTION;

        this.extractTunedModelNames = appConfig.GEMINI_EXTRACT_TUNED_MODEL_NAMES;
        this.extractTunedFallbackModelName = appConfig.GEMINI_EXTRACT_TUNED_FALLBACK_MODEL_NAME;
        this.extractNonTunedModelNames = appConfig.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES;
        this.extractNonTunedFallbackModelName = appConfig.GEMINI_EXTRACT_NON_TUNED_FALLBACK_MODEL_NAME;

        this.cfpTunedModelNames = appConfig.GEMINI_CFP_TUNED_MODEL_NAMES;
        this.cfpTunedFallbackModelName = appConfig.GEMINI_CFP_TUNED_FALLBACK_MODEL_NAME;
        this.cfpNonTunedModelNames = appConfig.GEMINI_CFP_NON_TUNED_MODEL_NAMES;
        this.cfpNonTunedFallbackModelName = appConfig.GEMINI_CFP_NON_TUNED_FALLBACK_MODEL_NAME;

        this.determineTunedModelNames = appConfig.GEMINI_DETERMINE_TUNED_MODEL_NAMES;
        this.determineTunedFallbackModelName = appConfig.GEMINI_DETERMINE_TUNED_FALLBACK_MODEL_NAME;
        this.determineNonTunedModelNames = appConfig.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES;
        this.determineNonTunedFallbackModelName = appConfig.GEMINI_DETERMINE_NON_TUNED_FALLBACK_MODEL_NAME;

        this.apiConfigs = this.buildGeminiApiConfigs();
    }

    private buildGeminiApiConfigs(): GeminiApiConfigs {

        // *************** ĐIỀU CHỈNH CHÍNH BẮT ĐẦU TỪ ĐÂY ***************
        // 1. Tính toán các năm một cách tự động
        const currentYear = new Date().getFullYear();
        const year1 = currentYear - 1; // Năm trước
        const year2 = currentYear;     // Năm hiện tại
        const year3 = currentYear + 1; // Năm sau

        // 2. Lấy chuỗi mẫu từ config
        const determineSystemInstructionTemplate = this.appConfig.GEMINI_DETERMINE_SYSTEM_INSTRUCTION;

        // 3. Thay thế các placeholders bằng các năm đã tính toán
        const processedDetermineInstruction = determineSystemInstructionTemplate
            .replace(/\${year1}/g, String(year1))
            .replace(/\${year2}/g, String(year2))
            .replace(/\${year3}/g, String(year3))
            .trim();
        // *************** KẾT THÚC ĐIỀU CHỈNH ***************

        // console.log(processedDetermineInstruction);
        
        return {
            [API_TYPE_EXTRACT]: {
                generationConfig: {
                    temperature: this.appConfig.GEMINI_EXTRACT_TEMPERATURE,
                    maxOutputTokens: this.appConfig.GEMINI_EXTRACT_MAX_OUTPUT_TOKENS,
                },
                systemInstruction: this.appConfig.GEMINI_EXTRACT_SYSTEM_INSTRUCTION.trim(),
                systemInstructionPrefixForNonTunedModel: this.appConfig.GEMINI_EXTRACT_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL.trim(),
                allowCacheForNonTuned: this.appConfig.GEMINI_EXTRACT_ALLOW_CACHE_NON_TUNED,
                allowFewShotForNonTuned: this.appConfig.GEMINI_EXTRACT_ALLOW_FEWSHOT_NON_TUNED,
            },
            [API_TYPE_CFP]: {
                generationConfig: {
                    temperature: this.appConfig.GEMINI_CFP_TEMPERATURE,
                    topP: this.appConfig.GEMINI_CFP_TOP_P,
                    topK: this.appConfig.GEMINI_CFP_TOP_K,
                    maxOutputTokens: this.appConfig.GEMINI_CFP_MAX_OUTPUT_TOKENS,
                },
                responseSchema: { // Added from original code
                    type: Type.OBJECT,
                    properties: {
                        "summary": { type: Type.STRING, description: "A brief summary of the conference." },
                        "callForPapers": { type: Type.STRING, description: "The detailed Call for Papers information, including important dates, topics, submission guidelines." },
                    },
                    required: ["summary", "callForPapers"]
                } as Schema,
                systemInstruction: this.appConfig.GEMINI_CFP_SYSTEM_INSTRUCTION.trim(),
                systemInstructionPrefixForNonTunedModel: this.appConfig.GEMINI_CFP_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL.trim(),
                allowCacheForNonTuned: this.appConfig.GEMINI_CFP_ALLOW_CACHE_NON_TUNED,
                allowFewShotForNonTuned: this.appConfig.GEMINI_CFP_ALLOW_FEWSHOT_NON_TUNED,
            },
            [API_TYPE_DETERMINE]: {
                generationConfig: {
                    temperature: this.appConfig.GEMINI_DETERMINE_TEMPERATURE,
                    maxOutputTokens: this.appConfig.GEMINI_DETERMINE_MAX_OUTPUT_TOKENS,
                },
                responseSchema: { // Added from original code
                    type: Type.OBJECT,
                    properties: {
                        "Official Website": { type: Type.STRING, description: "The official website URL for the conference." },
                        "Call for papers link": { type: Type.STRING, description: "The direct link to the Call for Papers page." },
                        "Important dates link": { type: Type.STRING, description: "The direct link to the Important Dates page." }
                    },
                    required: ["Official Website", "Call for papers link", "Important dates link"]
                } as Schema,
                systemInstruction: processedDetermineInstruction,
                systemInstructionPrefixForNonTunedModel: this.appConfig.GEMINI_DETERMINE_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL.trim(),
                allowCacheForNonTuned: this.appConfig.GEMINI_DETERMINE_ALLOW_CACHE_NON_TUNED,
                allowFewShotForNonTuned: this.appConfig.GEMINI_DETERMINE_ALLOW_FEWSHOT_NON_TUNED,
            },
        };
    }

    public async initializeExamples(): Promise<void> {
        if (!this.initializationPromise) {
            console.log("🚀 Starting loading of API examples...");
            this.initializationPromise = (async () => {
                try {
                    const [determineExamples, extractExamples, cfpExamples] = await Promise.all([
                        this.loadSpecificExampleData(DETERMINE_LINKS_CSV_PATH, API_TYPE_DETERMINE),
                        this.loadSpecificExampleData(EXTRACT_INFORMATION_CSV_PATH, API_TYPE_EXTRACT),
                        this.loadSpecificExampleData(CFP_INFORMATION_CSV_PATH, API_TYPE_CFP),
                    ]);

                    this.assignExamplesToGeminiConfig(API_TYPE_DETERMINE, determineExamples);
                    this.assignExamplesToGeminiConfig(API_TYPE_EXTRACT, extractExamples);
                    this.assignExamplesToGeminiConfig(API_TYPE_CFP, cfpExamples);

                    const allApiTypes = [API_TYPE_DETERMINE, API_TYPE_EXTRACT, API_TYPE_CFP];
                    let allLoadedSuccessfully = true;
                    for (const apiType of allApiTypes) {
                        const config = this.apiConfigs[apiType];
                        if (config && config.allowFewShotForNonTuned && (!config.inputs || Object.keys(config.inputs).length === 0)) {
                            console.warn(`   ⚠️ WARNING: Examples for '${apiType}' (which allows few-shot for non-tuned models) were not loaded or are empty. This might affect model performance.`);
                            allLoadedSuccessfully = false;
                        }
                    }

                    if (allLoadedSuccessfully) {
                        console.log("✅ All required API examples loaded and integrated successfully.");
                    } else {
                        console.warn("⚠️ Some API examples may not have loaded correctly. Please review the logs above.");
                    }

                } catch (error) {
                    console.error("❌ Error during overall API examples loading process:", error);
                    this.initializationPromise = null;
                }
            })();
        } else {
            console.log("🔁 API examples loading already in progress or completed. Waiting for completion.");
        }
        await this.initializationPromise;
    }

    private async loadSpecificExampleData(filePath: string, apiType: string): Promise<InputsOutputs | null> {
        try {
            await fs.promises.access(filePath);
            console.log(`   - Preparing ${apiType} data from: ${filePath}`);
            const rawData = await read_csv(filePath);
            if (rawData.length === 0) {
                console.warn(`   - WARNING: No valid data found in ${filePath} for ${apiType}.`);
                return null;
            }
            return createInputsOutputs(rawData);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.error(`   - ERROR: CSV file not found for ${apiType}: ${filePath}`);
            } else {
                console.error(`   - ERROR: Failed to read/parse CSV for ${apiType} (${filePath}):`, error.message);
            }
            return null;
        }
    }

    private assignExamplesToGeminiConfig(apiType: string, examples: InputsOutputs | null): void {
        if (examples && this.apiConfigs[apiType]) {
            this.apiConfigs[apiType].inputs = examples.inputs;
            this.apiConfigs[apiType].outputs = examples.outputs;
            console.log(`   👍 Loaded ${Object.keys(examples.inputs).length} examples for ${apiType}.`);
        } else if (this.apiConfigs[apiType]) {
            console.log(`   👎 No examples loaded or config missing for ${apiType}.`);
        }
    }
}