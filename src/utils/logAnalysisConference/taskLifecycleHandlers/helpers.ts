// src/utils/logAnalysis/taskLifecycleHandlers/helpers.ts

import { ConferenceLogAnalysisResult, OverallAnalysis, getInitialOverallAnalysis } from '../../../types/logAnalysis';

export const ensureOverallAnalysis = (results: ConferenceLogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};