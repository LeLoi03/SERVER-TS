// src/client/utils/eventHandlers/commonHandlers.ts
import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis';

export type LogEventHandler = (
    logEntry: any,
    results: LogAnalysisResult,
    confDetail: ConferenceAnalysisDetail | null,
    entryTimestampISO: string,
    logContext: object
) => void;
