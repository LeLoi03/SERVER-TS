// src/utils/logAnalysis/validationHandlers/index.ts

/**
 * This file serves as the single entry point for all data validation and normalization event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import { handleNormalizationApplied } from './normalization.handlers';
import { handleValidationWarning } from './warning.handlers';

export const validationEventHandlers: { [key: string]: LogEventHandler } = {
    'validation_warning': handleValidationWarning,
    'normalization_applied': handleNormalizationApplied,
};