// src/utils/logAnalysis/overallProcessHandlers/helpers.ts

/**
 * Contains shared helper functions for the overall process handlers.
 */

import { ConferenceLogAnalysisResult, OverallAnalysis, getInitialOverallAnalysis } from '../../../types/logAnalysis';

export const ensureOverallAnalysis = (results: ConferenceLogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};