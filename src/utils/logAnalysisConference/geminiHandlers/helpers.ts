// src/utils/logAnalysis/geminiHandlers/helpers.ts

/**
 * This file contains shared helper functions used across various Gemini log event handlers.
 * Centralizing them here promotes code reuse and adheres to the DRY principle.
 */

import { ConferenceLogAnalysisResult, GeminiApiAnalysis, getInitialGeminiApiAnalysis, getInitialOverallAnalysis, OverallAnalysis } from '../../../types/logAnalysis';

export const ensureGeminiApiAnalysis = (results: ConferenceLogAnalysisResult): GeminiApiAnalysis => {
    if (!results.geminiApi) {
        results.geminiApi = getInitialGeminiApiAnalysis();
    }
    return results.geminiApi;
};

export const ensureOverallAnalysis = (results: ConferenceLogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall;
};

const ensureNestedObject = (obj: any, path: string[], defaultValueFactory: () => any = () => ({})): any => {
    if (!obj || typeof obj !== 'object') {
        if (path.length > 0 && path[0] === 'geminiApi' && (!obj || typeof obj !== 'object')) {
            obj = {};
        } else {
            return defaultValueFactory();
        }
    }
    let current = obj;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (i === path.length - 1) {
            if (current[key] === undefined) {
                current[key] = defaultValueFactory();
            }
        } else {
            if (current[key] === undefined || typeof current[key] !== 'object' || current[key] === null) {
                current[key] = {};
            }
        }
        current = current[key];
    }
    return current;
};

const ensureModelUsageStatsEntry = (geminiApi: GeminiApiAnalysis, apiType: string, modelIdentifier: string) => {
    return ensureNestedObject(
        geminiApi.modelUsageByApiType,
        [apiType, modelIdentifier],
        () => ({ calls: 0, retries: 0, successes: 0, failures: 0, tokens: 0, safetyBlocks: 0 })
    );
};

export const updateModelUsageStats = (
    logEntry: any,
    geminiApi: GeminiApiAnalysis,
    updateType: 'call' | 'retry' | 'success_attempt' | 'failure_attempt'
) => {
    const apiType = logEntry.apiType;
    const modelName = logEntry.modelUsed || logEntry.modelBeingRetried || logEntry.modelName || logEntry.primaryModelNameSpecified || logEntry.modelForPrep || logEntry.generationModelName;
    const crawlModel = logEntry.crawlModel || logEntry.crawlModelUsed || logEntry.initialCrawlModelType || logEntry.effectiveCrawlModelType;

    if (!apiType || !modelName || !crawlModel) {
        return;
    }

    const modelIdentifier = `${modelName} (${crawlModel})`;
    const stats = ensureModelUsageStatsEntry(geminiApi, apiType, modelIdentifier);

    switch (updateType) {
        case 'call':
            stats.calls++;
            break;
        case 'retry':
            stats.retries++;
            break;
        case 'success_attempt':
            stats.successes++;
            const tokenCount = logEntry.tokens || logEntry.metaData?.totalTokenCount;
            if (tokenCount) {
                stats.tokens += Number(tokenCount) || 0;
                geminiApi.totalTokens += Number(tokenCount) || 0;
            }
            break;
        case 'failure_attempt':
            stats.failures++;
            const errorForSafetyCheck = logEntry.finalError || logEntry.err || logEntry.reason || logEntry.msg || logEntry.errorDetails;
            const isSafetyBlockEvent = logEntry.event === 'gemini_api_response_blocked' || logEntry.event === 'retry_attempt_error_safety_blocked';
            const isSafetyBlockReason = (typeof errorForSafetyCheck === 'object' && errorForSafetyCheck !== null &&
                ((errorForSafetyCheck as any).finishReason === 'SAFETY' || (errorForSafetyCheck as any).blockReason || String(errorForSafetyCheck).toLowerCase().includes("safety")));
            if (isSafetyBlockEvent || isSafetyBlockReason) {
                stats.safetyBlocks++;
            }
            break;
    }
};