// src/utils/logAnalysis/index.ts

// Import all handlers from child files
import { taskLifecycleEventHandlers } from './taskLifecycleHandlers';
import { searchEventHandlers } from './searchHandlers';
import { playwrightEventHandlers } from './playwrightHandlers';
import { geminiEventHandlers } from './geminiHandlers'; // <<<< THAY ĐỔI QUAN TRỌNG
import { ConferenceLogAnalysisResult, ConferenceAnalysisDetail } from '../../types/logAnalysis';
import { batchProcessingEventHandlers } from './batchProcessingHandlers';
import { fileOutputEventHandlers } from './fileOutput';
import { validationEventHandlers } from './validationEventHandlers';
import { overallProcessEventHandlers } from './overallProcessHandlers';

export type LogEventHandler = (
  logEntry: any,
  results: ConferenceLogAnalysisResult,
  confDetail: ConferenceAnalysisDetail | null,
  entryTimestampISO: string,
) => void;


export const eventHandlerMap: Record<string, LogEventHandler> = {

  // --- Task Lifecycle ---
  ...taskLifecycleEventHandlers, // <<<< GỌN GÀNG

  // --- Search Events Group ---
  ...searchEventHandlers, // <<<< GỌN GÀNG

  // --- Playwright Events Group ---
  ...playwrightEventHandlers,

  // --- Gemini API Events Group ---
  ...geminiEventHandlers, // <<<< CỰC KỲ GỌN GÀNG

  // --- Batch Processing Events Group ---
  ...batchProcessingEventHandlers,

  // --- File Output (JSONL, CSV) ---
  ...fileOutputEventHandlers,

  // Validation & Normalization
  ...validationEventHandlers,

  // --- Overall Process ---
  ...overallProcessEventHandlers
};