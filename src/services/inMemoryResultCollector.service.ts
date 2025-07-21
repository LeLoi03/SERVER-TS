// src/services/inMemoryResultCollector.service.ts
import 'reflect-metadata';
import { scoped, Lifecycle } from 'tsyringe'; // Import thêm
import { InputRowData } from '../types/crawl';

/**
 * A simple singleton service to collect raw processing results in memory
 * for a single crawl request. This avoids circular dependencies by acting
 * as a neutral, shared data store.
 */
@scoped(Lifecycle.ResolutionScoped) // Thay đổi ở đây
export class InMemoryResultCollectorService {
    private results: InputRowData[] = [];

    /**
     * Adds a raw result record to the in-memory collection.
     * @param record The raw data record (InputRowData).
     */
    public add(record: InputRowData): void {
        this.results.push(record);
    }

    /**
     * Retrieves all collected results.
     * @returns An array of all collected records.
     */
    public get(): InputRowData[] {
        return this.results;
    }

    /**
     * Clears the collection, preparing it for a new request.
     */
    public clear(): void {
        this.results = [];
    }
}