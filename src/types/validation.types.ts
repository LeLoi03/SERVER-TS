// src/types/validation.types.ts

/**
 * Provides an insight into data quality issues or transformations during processing.
 * Used for logging and reporting potential data discrepancies.
 */
export interface DataQualityInsight {
    /** ISO timestamp when the insight was generated. */
    timestamp: string;
    /** The name of the field affected by the insight (e.g., 'location', 'conferenceDates'). */
    field: string;
    /** Optional: The original value of the field before any changes or warnings. */
    originalValue?: any;
    /** The current value of the field (e.g., after normalization or the value causing the warning). */
    currentValue: any;
    /**
     * The type of insight.
     * - 'ValidationWarning': Data did not meet expected criteria, but was kept or loosely processed.
     * - 'NormalizationApplied': Data was transformed or standardized.
     * - 'DataCorrection': Data was actively corrected based on specific rules.
     */
    insightType: 'ValidationWarning' | 'NormalizationApplied' | 'DataCorrection';
    /** Optional: Severity of the insight, primarily for 'ValidationWarning'. */
    severity?: 'Low' | 'Medium' | 'High';
    /** A detailed description of the insight. */
    message: string;
    /** Optional: Additional details about the insight. */
    details?: {
        /** E.g., "KeptAsIs", "NormalizedToDefault", "RemovedCharacters". */
        actionTaken?: string;
        /** The value after normalization, if `insightType` is 'NormalizationApplied'. */
        normalizedTo?: any;
        /** The specific rule that was violated, if applicable (e.g., "YEAR_REGEX", "VALID_CONTINENTS"). */
        ruleViolated?: string;
    };
}

/**
 * Aggregated statistics on data validation and normalization.
 */
export interface ValidationStats {
    // --- Validation Warnings ---
    /** Total number of validation warnings recorded. */
    totalValidationWarnings: number;
    /** Breakdown of validation warnings by affected field name. */
    warningsByField: { [fieldName: string]: number };
    /** Breakdown of validation warnings by severity level. */
    warningsBySeverity: {
        Low: number;
        Medium: number;
        High: number;
    };
    /** Breakdown of validation warnings by their specific message/type. */
    warningsByInsightMessage: { [message: string]: number };

    // --- Normalizations ---
    /** Total number of data normalizations applied. */
    totalNormalizationsApplied: number;
    /** Breakdown of normalizations by affected field name. */
    normalizationsByField: { [fieldName: string]: number };
    /** Breakdown of normalizations by the reason/message for normalization. */
    normalizationsByReason: { [reasonMessage: string]: number };

    // --- Data Corrections (Optional) ---
    /** Optional: Total number of data corrections applied. */
    totalDataCorrections?: number;
    /** Optional: Breakdown of data corrections by affected field name. */
    correctionsByField?: { [fieldName: string]: number };
}