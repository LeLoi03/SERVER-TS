// src/types/playwright.types.ts

/**
 * Comprehensive analysis of Playwright (web scraping) operations.
 */
export interface PlaywrightAnalysis {
    /** Number of attempts to set up the Playwright browser. */
    setupAttempts: number;
    /** Whether Playwright setup was ultimately successful (null if not attempted/finished). */
    setupSuccess: boolean | null;
    /** Error message or boolean indicating setup failure. */
    setupError: boolean | string | null;
    /** Number of errors occurring within the browser context. */
    contextErrors: number;
    /** Total number of attempts to save HTML content. */
    htmlSaveAttempts: number;
    /** Number of times HTML save operations were successfully initiated. */
    successfulSaveInitiations: number;
    /** Number of HTML save operations that failed. */
    failedSaves: number;
    /** Number of HTML save operations that were skipped. */
    skippedSaves: number;
    /** Breakdown of link processing statistics. */
    linkProcessing: {
        /** Total number of links attempted to be accessed and processed. */
        totalLinksAttempted: number;
        /** Number of links successfully accessed. */
        successfulAccess: number;
        /** Number of links that failed to be accessed. */
        failedAccess: number;
        /** Number of redirects encountered during link access. */
        redirects: number;
    };
    /** Count of other unclassified Playwright failures. */
    otherFailures: number;
    /** A map of error types to their counts, where keys are normalized error strings. */
    errorsByType: { [normalizedErrorKey: string]: number };
}