// src/utils/logAnalysisConference/conferenceAnalysisMerger.utils.ts
import {
    OverallAnalysis,
    GoogleSearchAnalysis,
    PlaywrightAnalysis,
    GeminiApiAnalysis,
    BatchProcessingAnalysis,
    FileOutputAnalysis,
    ValidationStats
} from '../../types/logAnalysis'; // Ensure this path is correct based on your project structure

export function mergeOverallAnalysisCounters(target: OverallAnalysis, source: OverallAnalysis): void {
    target.totalConferencesInput += source.totalConferencesInput;
    // processedConferencesCount is recalculated at the end of aggregation
    target.completedTasks += source.completedTasks;
    target.failedOrCrashedTasks += source.failedOrCrashedTasks;
    target.processingTasks += source.processingTasks;
    target.skippedTasks += source.skippedTasks;
    target.successfulExtractions += source.successfulExtractions;
}

export function mergeGoogleSearchAnalysis(target: GoogleSearchAnalysis, source: GoogleSearchAnalysis): void {
    target.totalRequests += source.totalRequests;
    target.successfulSearches += source.successfulSearches;
    target.failedSearches += source.failedSearches;
    target.skippedSearches += source.skippedSearches;
    target.quotaErrors += source.quotaErrors;
    for (const key in source.keyUsage) target.keyUsage[key] = (target.keyUsage[key] || 0) + source.keyUsage[key];
    for (const type in source.errorsByType) target.errorsByType[type] = (target.errorsByType[type] || 0) + source.errorsByType[type];
    target.attemptIssues += source.attemptIssues;
    for (const key in source.attemptIssueDetails) target.attemptIssueDetails[key] = (target.attemptIssueDetails[key] || 0) + source.attemptIssueDetails[key];
    target.apiKeyLimitsReached += source.apiKeyLimitsReached;
    for (const key in source.keySpecificLimitsReached) target.keySpecificLimitsReached[key] = (target.keySpecificLimitsReached[key] || 0) + source.keySpecificLimitsReached[key];
    if (source.apiKeysProvidedCount > target.apiKeysProvidedCount) target.apiKeysProvidedCount = source.apiKeysProvidedCount;
    target.allKeysExhaustedEvents_GetNextKey += source.allKeysExhaustedEvents_GetNextKey;
    target.allKeysExhaustedEvents_StatusCheck += source.allKeysExhaustedEvents_StatusCheck;
    target.apiKeyRotationsSuccess += source.apiKeyRotationsSuccess;
    target.apiKeyRotationsFailed += source.apiKeyRotationsFailed;
    target.successfulSearchesWithNoItems += source.successfulSearchesWithNoItems;
    target.malformedResultItems += source.malformedResultItems;
}

export function mergePlaywrightAnalysis(target: PlaywrightAnalysis, source: PlaywrightAnalysis): void {
    target.setupAttempts += source.setupAttempts;
    if (source.setupSuccess !== null) target.setupSuccess = source.setupSuccess; // Overwrite if source has a definitive status
    if (source.setupError) target.setupError = (target.setupError ? target.setupError + "; " : "") + source.setupError;
    target.contextErrors += source.contextErrors;
    target.htmlSaveAttempts += source.htmlSaveAttempts;
    target.successfulSaveInitiations += source.successfulSaveInitiations;
    target.failedSaves += source.failedSaves;
    target.skippedSaves += source.skippedSaves;
    target.linkProcessing.totalLinksAttempted += source.linkProcessing.totalLinksAttempted;
    target.linkProcessing.successfulAccess += source.linkProcessing.successfulAccess;
    target.linkProcessing.failedAccess += source.linkProcessing.failedAccess;
    target.linkProcessing.redirects += source.linkProcessing.redirects;
    target.otherFailures += source.otherFailures;
    for (const type in source.errorsByType) target.errorsByType[type] = (target.errorsByType[type] || 0) + source.errorsByType[type];
}

export function mergeGeminiApiAnalysis(target: GeminiApiAnalysis, source: GeminiApiAnalysis): void {
    // --- General Stats ---
    target.totalCalls += source.totalCalls;
    target.successfulCalls += source.successfulCalls;
    target.failedCalls += source.failedCalls;
    for (const type in source.callsByType) {
        target.callsByType[type] = (target.callsByType[type] || 0) + source.callsByType[type];
    }
    for (const model in source.callsByModel) {
        target.callsByModel[model] = (target.callsByModel[model] || 0) + source.callsByModel[model];
    }

    target.totalRetries += source.totalRetries;
    for (const type in source.retriesByType) {
        target.retriesByType[type] = (target.retriesByType[type] || 0) + source.retriesByType[type];
    }
    for (const model in source.retriesByModel) {
        target.retriesByModel[model] = (target.retriesByModel[model] || 0) + source.retriesByModel[model];
    }

    // Model Usage by API Type
    for (const apiType in source.modelUsageByApiType) {
        if (!target.modelUsageByApiType[apiType]) {
            target.modelUsageByApiType[apiType] = {};
        }
        for (const modelName in source.modelUsageByApiType[apiType]) {
            if (!target.modelUsageByApiType[apiType][modelName]) {
                target.modelUsageByApiType[apiType][modelName] = { calls: 0, retries: 0, successes: 0, failures: 0, tokens: 0, safetyBlocks: 0 };
            }
            const tModelUsage = target.modelUsageByApiType[apiType][modelName];
            const sModelUsage = source.modelUsageByApiType[apiType][modelName];
            tModelUsage.calls += sModelUsage.calls;
            tModelUsage.retries += sModelUsage.retries;
            tModelUsage.successes += sModelUsage.successes;
            tModelUsage.failures += sModelUsage.failures;
            tModelUsage.tokens += sModelUsage.tokens;
            tModelUsage.safetyBlocks += sModelUsage.safetyBlocks;
        }
    }

    // --- Primary Model Stats ---
    target.primaryModelStats.attempts += source.primaryModelStats.attempts;
    target.primaryModelStats.successes += source.primaryModelStats.successes;
    target.primaryModelStats.failures += source.primaryModelStats.failures;
    target.primaryModelStats.preparationFailures += source.primaryModelStats.preparationFailures;
    target.primaryModelStats.skippedOrNotConfigured += source.primaryModelStats.skippedOrNotConfigured;

    // --- Fallback Model Stats ---
    target.fallbackModelStats.attempts += source.fallbackModelStats.attempts;
    target.fallbackModelStats.successes += source.fallbackModelStats.successes;
    target.fallbackModelStats.failures += source.fallbackModelStats.failures;
    target.fallbackModelStats.preparationFailures += source.fallbackModelStats.preparationFailures;
    target.fallbackModelStats.notConfiguredWhenNeeded += source.fallbackModelStats.notConfiguredWhenNeeded;

    // --- Other General Stats ---
    target.totalTokens += source.totalTokens;
    target.blockedBySafety += source.blockedBySafety;
    target.rateLimitWaits += source.rateLimitWaits;
    target.intermediateErrors += source.intermediateErrors;
    for (const type in source.errorsByType) {
        target.errorsByType[type] = (target.errorsByType[type] || 0) + source.errorsByType[type];
    }

    // --- Service & Client Initialization ---
    const tServiceInit = target.serviceInitialization;
    const sServiceInit = source.serviceInitialization;
    tServiceInit.starts += sServiceInit.starts;
    tServiceInit.completes += sServiceInit.completes;
    tServiceInit.failures += sServiceInit.failures;
    tServiceInit.lazyAttempts += sServiceInit.lazyAttempts;
    tServiceInit.criticallyUninitialized += sServiceInit.criticallyUninitialized;
    tServiceInit.clientInitAttempts += sServiceInit.clientInitAttempts;
    tServiceInit.clientGenAiSuccesses += sServiceInit.clientGenAiSuccesses;
    tServiceInit.clientCacheManagerSuccesses += sServiceInit.clientCacheManagerSuccesses;
    tServiceInit.clientInitFailures += sServiceInit.clientInitFailures;
    tServiceInit.noApiKeysConfigured += sServiceInit.noApiKeysConfigured;
    tServiceInit.noClientsInitializedOverall += sServiceInit.noClientsInitializedOverall;

    target.apiCallSetupFailures += source.apiCallSetupFailures;

    // --- Model Preparation (from GeminiModelOrchestratorService) ---
    const tModelPrep = target.modelPreparationStats;
    const sModelPrep = source.modelPreparationStats;
    tModelPrep.attempts += sModelPrep.attempts;
    tModelPrep.successes += sModelPrep.successes;
    tModelPrep.failures += sModelPrep.failures;
    tModelPrep.criticalFailures += sModelPrep.criticalFailures;

    // --- API Key Management (from GeminiClientManagerService) ---
    const tApiKeyMgmt = target.apiKeyManagement;
    const sApiKeyMgmt = source.apiKeyManagement;
    tApiKeyMgmt.unhandledApiTypeSelections += sApiKeyMgmt.unhandledApiTypeSelections;
    tApiKeyMgmt.noKeysAvailableSelections += sApiKeyMgmt.noKeysAvailableSelections;
    tApiKeyMgmt.indexOutOfBoundsSelections += sApiKeyMgmt.indexOutOfBoundsSelections;

    // --- Rate Limiter Setup (from GeminiRateLimiterService) ---
    const tRateLimitSetup = target.rateLimiterSetup;
    const sRateLimitSetup = source.rateLimiterSetup;
    tRateLimitSetup.creationAttempts += sRateLimitSetup.creationAttempts;
    tRateLimitSetup.creationSuccesses += sRateLimitSetup.creationSuccesses;
    tRateLimitSetup.creationFailures += sRateLimitSetup.creationFailures;

    // --- Few-Shot Preparation ---
    const tFewShot = target.fewShotPreparation;
    const sFewShot = source.fewShotPreparation;
    tFewShot.attempts += sFewShot.attempts;
    tFewShot.successes += sFewShot.successes;
    tFewShot.failures.oddPartsCount += sFewShot.failures.oddPartsCount;
    tFewShot.failures.processingError += sFewShot.failures.processingError;
    tFewShot.warnings.missingInput += sFewShot.warnings.missingInput;
    tFewShot.warnings.missingOutput += sFewShot.warnings.missingOutput;
    tFewShot.warnings.emptyResult += sFewShot.warnings.emptyResult;
    tFewShot.configuredButNoData += sFewShot.configuredButNoData;
    tFewShot.disabledByConfig += sFewShot.disabledByConfig;

    // --- Request Payload Logging ---
    const tPayloadLog = target.requestPayloadLogging;
    const sPayloadLog = source.requestPayloadLogging;
    tPayloadLog.successes += sPayloadLog.successes;
    tPayloadLog.failures += sPayloadLog.failures;

    // --- Generate Content (model.generateContent() calls) ---
    const tGenContent = target.generateContentInternal;
    const sGenContent = source.generateContentInternal;
    tGenContent.attempts += sGenContent.attempts;
    tGenContent.successes += sGenContent.successes;
    // if (sGenContent.failures) { // Assuming failures is a number
    //     tGenContent.failures = (tGenContent.failures || 0) + sGenContent.failures;
    // }

    // --- Cache Specifics ---
    const tCacheDecision = target.cacheDecisionStats;
    const sCacheDecision = source.cacheDecisionStats;
    tCacheDecision.cacheUsageAttempts += sCacheDecision.cacheUsageAttempts;
    tCacheDecision.cacheExplicitlyDisabled += sCacheDecision.cacheExplicitlyDisabled;

    target.cacheContextHits += source.cacheContextHits;
    target.cacheContextAttempts += source.cacheContextAttempts;
    target.cacheContextCreationSuccess += source.cacheContextCreationSuccess;
    target.cacheContextRetrievalSuccess += source.cacheContextRetrievalSuccess;
    target.cacheContextMisses += source.cacheContextMisses;
    target.cacheContextCreationFailed += source.cacheContextCreationFailed;
    target.cacheContextInvalidations += source.cacheContextInvalidations;
    target.cacheContextRetrievalFailures += source.cacheContextRetrievalFailures;
    target.cacheMapLoadAttempts += source.cacheMapLoadAttempts;
    target.cacheMapLoadFailures += source.cacheMapLoadFailures;

    if (source.cacheMapLoadSuccess === true) {
        target.cacheMapLoadSuccess = true;
    } else if (target.cacheMapLoadSuccess === null && source.cacheMapLoadSuccess === false) {
        target.cacheMapLoadSuccess = false;
    }

    target.cacheMapWriteAttempts += source.cacheMapWriteAttempts;
    target.cacheMapWriteSuccessCount += source.cacheMapWriteSuccessCount;
    target.cacheMapWriteFailures += source.cacheMapWriteFailures;
    target.cacheManagerCreateFailures += source.cacheManagerCreateFailures;

    // --- Response Processing ---
    const tRespProc = target.responseProcessingStats;
    const sRespProc = source.responseProcessingStats;
    tRespProc.markdownStripped += sRespProc.markdownStripped;
    tRespProc.jsonValidationsSucceededInternal += sRespProc.jsonValidationsSucceededInternal;
    tRespProc.jsonValidationFailedInternal += sRespProc.jsonValidationFailedInternal;
    tRespProc.jsonCleaningSuccessesPublic += sRespProc.jsonCleaningSuccessesPublic;
    tRespProc.emptyAfterProcessingInternal += sRespProc.emptyAfterProcessingInternal;
    tRespProc.publicMethodFinishes += sRespProc.publicMethodFinishes;
    tRespProc.trailingCommasFixed += sRespProc.trailingCommasFixed;
    tRespProc.blockedBySafetyInResponseHandler += sRespProc.blockedBySafetyInResponseHandler;
    tRespProc.responseFileWrites += sRespProc.responseFileWrites;
    tRespProc.responseFileWriteFailures += sRespProc.responseFileWriteFailures;

    // --- Config Errors ---
    const tConfigErr = target.configErrors;
    const sConfigErr = source.configErrors;
    tConfigErr.modelListMissing += sConfigErr.modelListMissing;
    tConfigErr.apiTypeConfigMissing += sConfigErr.apiTypeConfigMissing;

    // --- Fallback Logic & Deprecated ---
    const tFallback = target.fallbackLogic;
    const sFallback = source.fallbackLogic;
    tFallback.attemptsWithFallbackModel += sFallback.attemptsWithFallbackModel;
    tFallback.successWithFallbackModel += sFallback.successWithFallbackModel;
    tFallback.primaryModelFailuresLeadingToFallback += sFallback.primaryModelFailuresLeadingToFallback;
    tFallback.noFallbackConfigured += sFallback.noFallbackConfigured;
    tFallback.failedAfterFallbackAttempts += sFallback.failedAfterFallbackAttempts;

    target.serviceInitializationFailures += source.serviceInitializationFailures; // Deprecated
}

export function mergeBatchProcessingAnalysis(target: BatchProcessingAnalysis, source: BatchProcessingAnalysis): void {
    target.totalBatchesAttempted += source.totalBatchesAttempted;
    target.successfulBatches += source.successfulBatches;
    target.failedBatches += source.failedBatches;
    target.apiFailures += source.apiFailures;
    target.fileSystemFailures += source.fileSystemFailures;
    target.logicRejections += source.logicRejections;
    if (source.aggregatedResultsCount !== null) target.aggregatedResultsCount = (target.aggregatedResultsCount || 0) + source.aggregatedResultsCount;
    target.determineApiFailures += source.determineApiFailures;
    target.extractApiFailures += source.extractApiFailures;
    target.cfpApiFailures += source.cfpApiFailures;
    target.apiResponseParseFailures += source.apiResponseParseFailures;
}



export function mergeFileOutputAnalysis(target: FileOutputAnalysis, source: FileOutputAnalysis): void {
    target.jsonlRecordsSuccessfullyWritten += source.jsonlRecordsSuccessfullyWritten;
    target.jsonlWriteErrors += source.jsonlWriteErrors;

    // Logic for csvFileGenerated: if any source is true, target becomes true.
    // If target is initially null, and all sources are false or null, it remains null.
    // If target is initially false, and all sources are false or null, it remains false.
    if (source.csvFileGenerated === true) {
        target.csvFileGenerated = true;
    }
    // Optional: if you want a 'false' from source to override a 'null' in target
    // else if (target.csvFileGenerated === null && source.csvFileGenerated === false) {
    //     target.csvFileGenerated = false;
    // }


    target.csvRecordsAttempted += source.csvRecordsAttempted;
    target.csvRecordsSuccessfullyWritten += source.csvRecordsSuccessfullyWritten;
    target.csvWriteErrors += source.csvWriteErrors;
    target.csvOrphanedSuccessRecords += source.csvOrphanedSuccessRecords;
    target.csvPipelineFailures += source.csvPipelineFailures;

    // Merge csvOtherErrors if it exists in the source
    if (source.csvOtherErrors !== undefined) {
        target.csvOtherErrors = (target.csvOtherErrors || 0) + source.csvOtherErrors;
    }
}

export function mergeValidationStats(target: ValidationStats, source: ValidationStats): void {
    // --- Validation Warnings ---
    target.totalValidationWarnings += source.totalValidationWarnings;
    for (const field in source.warningsByField) {
        target.warningsByField[field] = (target.warningsByField[field] || 0) + source.warningsByField[field];
    }
    target.warningsBySeverity.Low += source.warningsBySeverity.Low;
    target.warningsBySeverity.Medium += source.warningsBySeverity.Medium;
    target.warningsBySeverity.High += source.warningsBySeverity.High;
    for (const msg in source.warningsByInsightMessage) {
        target.warningsByInsightMessage[msg] = (target.warningsByInsightMessage[msg] || 0) + source.warningsByInsightMessage[msg];
    }

    // --- Normalizations ---
    target.totalNormalizationsApplied += source.totalNormalizationsApplied;
    for (const field in source.normalizationsByField) {
        target.normalizationsByField[field] = (target.normalizationsByField[field] || 0) + source.normalizationsByField[field];
    }
    for (const reason in source.normalizationsByReason) {
        target.normalizationsByReason[reason] = (target.normalizationsByReason[reason] || 0) + source.normalizationsByReason[reason];
    }

    // --- Data Corrections (Optional) ---
    if (source.totalDataCorrections !== undefined) {
        target.totalDataCorrections = (target.totalDataCorrections || 0) + source.totalDataCorrections;
    }

    if (source.correctionsByField) {
        if (!target.correctionsByField) {
            target.correctionsByField = {};
        }
        for (const field in source.correctionsByField) {
            // Ensure source.correctionsByField[field] is a number before adding
            const sourceValue = source.correctionsByField[field];
            if (typeof sourceValue === 'number') {
                 target.correctionsByField[field] = (target.correctionsByField[field] || 0) + sourceValue;
            }
        }
    }
}