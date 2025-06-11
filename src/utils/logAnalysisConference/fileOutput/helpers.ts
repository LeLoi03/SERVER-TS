// src/utils/logAnalysis/fileOutputHandlers/helpers.ts

import { ConferenceLogAnalysisResult, FileOutputAnalysis, getInitialFileOutputAnalysis, OverallAnalysis, getInitialOverallAnalysis } from '../../../types/logAnalysis';

export const ensureFileOutputAnalysis = (results: ConferenceLogAnalysisResult): FileOutputAnalysis => {
    if (!results.fileOutput) {
        results.fileOutput = getInitialFileOutputAnalysis();
    }
    return results.fileOutput as FileOutputAnalysis;
};

export const ensureOverallAnalysis = (results: ConferenceLogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};