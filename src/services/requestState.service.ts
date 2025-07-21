// src/services/requestState.service.ts
import { scoped, Lifecycle } from 'tsyringe';

/**
 * Manages the state for a single crawl request.
 * It's scoped to the resolution, meaning a new instance is created
 * for each resolution from the container, effectively making it request-scoped
 * in the context of our controller.
 */
@scoped(Lifecycle.ContainerScoped) 
export class RequestStateService {
    private _recordFile: boolean = false;

    /**
     * Initializes the state for the current request.
     * @param recordFile - Whether to record JSONL and CSV output files. Defaults to false.
     */
    public init(recordFile?: boolean): void {
        this._recordFile = recordFile === true; // Ensure it's a strict boolean
    }

    /**
     * Checks if files should be recorded for the current request.
     * @returns {boolean} True if files should be recorded, false otherwise.
     */
    public shouldRecordFiles(): boolean {
        return this._recordFile;
    }
}