// src/utils/logAnalysis/validationHandlers/helpers.ts

/**
 * Contains shared helper functions for the validation handlers.
 */

import { ValidationStats, ConferenceLogAnalysisResult, getInitialValidationStats } from '../../../types/logAnalysis';

export const ensureValidationStats = (results: ConferenceLogAnalysisResult): ValidationStats => {
    if (!results.validationStats) {
        results.validationStats = getInitialValidationStats();
    }
    results.validationStats.warningsBySeverity = results.validationStats.warningsBySeverity || { Low: 0, Medium: 0, High: 0 };
    results.validationStats.warningsByInsightMessage = results.validationStats.warningsByInsightMessage || {};
    results.validationStats.normalizationsByReason = results.validationStats.normalizationsByReason || {};
    return results.validationStats;
};