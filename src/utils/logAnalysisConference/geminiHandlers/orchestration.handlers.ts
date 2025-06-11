// src/utils/logAnalysis/geminiHandlers/orchestration.handlers.ts

/**
 * Handles events related to the orchestration logic, such as managing
 * primary and fallback models, and model preparation steps.
 */

import { LogEventHandler } from '../index';
import { addConferenceError } from '../helpers';
import { ensureGeminiApiAnalysis, updateModelUsageStats } from './helpers';

/**
 * Handles events from the API orchestrator, tracking primary/fallback model usage.
 */
export const handleOrchestrationEvent: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;
    const apiType = logEntry.apiType;

    const primaryModelNameFromLog = logEntry.primaryModelNameSpecified || logEntry.modelName || logEntry.modelUsed;
    const initialCrawlModelFromLog = logEntry.initialCrawlModelType || logEntry.crawlModel;
    const primaryModelId = primaryModelNameFromLog && initialCrawlModelFromLog
        ? `${primaryModelNameFromLog} (${initialCrawlModelFromLog})`
        : undefined;

    const fallbackModelNameFromLog = logEntry.fallbackModelNameSpecified || logEntry.modelName || logEntry.modelUsed;
    const fallbackCrawlModelFromLog = logEntry.fallbackEffectiveCrawlModelType || logEntry.crawlModel;
    const fallbackModelId = fallbackModelNameFromLog && fallbackCrawlModelFromLog
        ? `${fallbackModelNameFromLog} (${fallbackCrawlModelFromLog})`
        : undefined;

    if (event === 'gemini_orchestration_primary_start') {
        geminiApi.primaryModelStats.attempts++;
        const primaryCallLogEntry = { ...logEntry, modelName: primaryModelNameFromLog, crawlModel: initialCrawlModelFromLog };
        updateModelUsageStats(primaryCallLogEntry, geminiApi, 'call');
    } else if (event === 'gemini_orchestration_no_primary_model') {
        geminiApi.primaryModelStats.skippedOrNotConfigured++;
    } else if (event === 'gemini_orchestration_primary_success') {
        geminiApi.primaryModelStats.successes++;
    } else if (event === 'gemini_orchestration_primary_failed') {
        geminiApi.primaryModelStats.failures++;
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.errorDetails || "Primary model execution failed", {
                defaultMessage: "Primary model execution failed",
                keyPrefix: "gemini_primary_exec",
                sourceService: "GeminiApiOrchestratorService",
                errorType: (logEntry.errorDetails as any)?.errorType || "ThirdPartyAPI",
                context: { phase: 'primary_execution', modelIdentifier: primaryModelId, apiType }
            });
        }
    }
    else if (event === 'gemini_orchestration_fallback_start' || event === 'gemini_call_attempting_fallback_model') {
        geminiApi.fallbackModelStats.attempts++;
        const fallbackCallLogEntry = { ...logEntry, modelName: fallbackModelNameFromLog, crawlModel: fallbackCrawlModelFromLog };
        updateModelUsageStats(fallbackCallLogEntry, geminiApi, 'call');
    } else if (event === 'gemini_orchestration_no_fallback_model' || event === 'gemini_call_no_fallback_configured') {
        geminiApi.fallbackModelStats.notConfiguredWhenNeeded++;
    } else if (event === 'gemini_orchestration_fallback_success') {
        geminiApi.fallbackModelStats.successes++;
    } else if (event === 'gemini_orchestration_fallback_failed_after_retries') {
        geminiApi.fallbackModelStats.failures++;
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.errorDetails || "Fallback model execution failed after retries", {
                defaultMessage: "Fallback model execution failed after retries",
                keyPrefix: "gemini_fallback_exec",
                sourceService: "GeminiApiOrchestratorService",
                errorType: (logEntry.errorDetails as any)?.errorType || "ThirdPartyAPI",
                context: { phase: 'fallback_execution', modelIdentifier: fallbackModelId, apiType }
            });
        }
    }
};

/**
 * Handles events related to model preparation.
 */
export const handleModelPreparation: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;
    if (event === 'model_preparation_attempt') {
        geminiApi.modelPreparationStats.attempts++;
    } else if (event === 'model_preparation_complete') {
        geminiApi.modelPreparationStats.successes++;
        if (!logEntry.isAttemptAlreadyCounted) {
            geminiApi.modelPreparationStats.attempts++;
        }
    }
};